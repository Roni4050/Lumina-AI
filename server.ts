import express from "express";
import { Server } from "socket.io";
import http from "http";
import path from "path";
import fs from "fs";
import os from "os";
import multer from "multer";
import { spawn } from "child_process";
import cors from "cors";
import archiver from "archiver";
import unzipper from "unzipper";
import sizeOf from "image-size";
import sharp from "sharp";

async function createServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: "*",
    },
  });

  io.on("connection", (socket) => {
    console.log(`New client connected: ${socket.id}`);
    socket.on("disconnect", () => {
      console.log(`Client disconnected: ${socket.id}`);
    });
  });

  const PORT = 3000;

  // Detect environment
  const isVercel = process.env.VERCEL === "1" || !!process.env.VERCEL;
  const writableBase = isVercel ? os.tmpdir() : process.cwd();

  // Helper to resolve writable paths
  const resolveWritable = (...paths: string[]) => path.join(writableBase, ...paths);

  // Ensure directories exist
  const UPLOADS_DIR = resolveWritable("uploads");
  const OUTPUTS_DIR = resolveWritable("outputs");
  const MODELS_DIR = resolveWritable("models");
  const ENGINE_DIR = resolveWritable("ai-engine");

  // Helper to find file recursively and fuzzily (case-insensitive and stripping special/encoded characters)
  const findFuzzyFile = (filePathOrBasename: string): string | null => {
    try {
      if (!filePathOrBasename) return null;
      
      // Decode URI components in case the filename is URL-encoded
      let decoded = filePathOrBasename;
      try {
        decoded = decodeURIComponent(filePathOrBasename);
      } catch (err) {
        // use original if decoding fails
      }

      // Strip any query parameters or hashes
      decoded = decoded.split(/[?#]/)[0];

      const basename = path.basename(decoded);
      if (!basename) return null;

      const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
      const filenameClean = clean(basename);
      if (!filenameClean) return null;
      
      const searchDirs = [
        path.join(writableBase, "outputs"),
        path.join(writableBase, "uploads")
      ];

      const scanDir = (dir: string): string | null => {
        if (!fs.existsSync(dir)) return null;
        let list: string[] = [];
        try {
          list = fs.readdirSync(dir);
        } catch {
          return null;
        }
        
        // Priority 1: Exact case-sensitive match
        for (const item of list) {
          const fullPath = path.join(dir, item);
          let stat;
          try {
            stat = fs.statSync(fullPath);
          } catch {
            continue;
          }
          if (!stat.isDirectory() && item === basename) {
            return fullPath;
          }
        }
        
        // Priority 2: Fuzzy clean match
        for (const item of list) {
          const fullPath = path.join(dir, item);
          let stat;
          try {
            stat = fs.statSync(fullPath);
          } catch {
            continue;
          }
          if (stat.isDirectory()) {
            const found = scanDir(fullPath);
            if (found) return found;
          } else if (clean(item) === filenameClean) {
            return fullPath;
          }
        }
        return null;
      };

      for (const dir of searchDirs) {
        const found = scanDir(dir);
        if (found) return found;
      }
    } catch (err) {
      console.error("Fuzzy search error:", err);
    }
    return null;
  };

  console.log(`Environment: ${isVercel ? 'Vercel' : 'Standard'}`);
  console.log(`Writable Base: ${writableBase}`);

  [UPLOADS_DIR, OUTPUTS_DIR, MODELS_DIR, ENGINE_DIR].forEach((dir) => {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Test writability
      const testFile = path.join(dir, ".write-test");
      fs.writeFileSync(testFile, "test");
      fs.unlinkSync(testFile);
      console.log(`Directory verified: ${dir}`);
    } catch (err) {
      console.error(`Error verifying directory ${dir}:`, err);
    }
  });

  app.use(cors());

  // Logging middleware
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  // Serve outputs and uploads
  app.use("/outputs", express.static(OUTPUTS_DIR));
  app.use("/uploads", express.static(UPLOADS_DIR));

  // --- API ROUTES ---

  app.get(["/api/health", "/api/health/"], (req, res) => {
    console.log("Health check requested");
    res.json({ 
      status: "ok", 
      uptime: process.uptime(), 
      timestamp: Date.now(),
      env: isVercel ? "Vercel" : "Local",
      writable: writableBase,
      sharp: !!sharp
    });
  });

  // Multer config for batch uploads (using memoryStorage for Vercel compatibility)
  const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 100 * 1024 * 1024, // 100MB limit
    }
  });

  // Upload Route
  app.post(["/api/upload", "/api/upload/"], async (req, res) => {
    console.log(`[${new Date().toISOString()}] POST /api/upload - Start`);
    
    // Ensure uploads directory exists
    if (!fs.existsSync(UPLOADS_DIR)) {
      try {
        console.log(`Creating uploads directory: ${UPLOADS_DIR}`);
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      } catch (e) {
        console.error("CRITICAL: Failed to create uploads directory:", e);
        return res.status(500).json({ error: "Server failed to prepare storage." });
      }
    }

    const uploadHandler = upload.array("images");
    
    // Wrap multer in a promise to ensure it completes before the route handler returns
    try {
      await new Promise<void>((resolve, reject) => {
        uploadHandler(req, res, (err: any) => {
          if (err) {
            console.error("MULTER ERROR:", err);
            reject(err);
          } else {
            resolve();
          }
        });
      });

      console.log("Multer finished. Processing files...");
      const uploadedFiles = req.files as Express.Multer.File[];
      if (!uploadedFiles || uploadedFiles.length === 0) {
        console.warn("No files in request. Body keys:", Object.keys(req.body || {}));
        return res.status(400).json({ error: "No files were received by the server." });
      }

      console.log(`Received ${uploadedFiles.length} files. Saving to disk...`);
      const savedFiles = [];
      for (const f of uploadedFiles) {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const filename = uniqueSuffix + "-" + f.originalname;
        const filePath = path.join(UPLOADS_DIR, filename);

        console.log(`Saving file: ${filename} to ${filePath}`);
        fs.writeFileSync(filePath, f.buffer);

        let width = 0;
        let height = 0;
        try {
          const dimensions = sizeOf(f.buffer);
          width = dimensions.width || 0;
          height = dimensions.height || 0;
        } catch (e) {
          console.error(`Error getting dimensions for ${f.originalname}:`, e);
        }

        savedFiles.push({
          id: filename,
          name: f.originalname,
          path: filePath,
          width,
          height,
        });
      }

      console.log(`Successfully processed ${savedFiles.length} files.`);
      return res.json({ files: savedFiles });
    } catch (err: any) {
      console.error("ERROR in upload handler:", err);
      return res.status(500).json({ 
        error: `Upload error: ${err.message || err}`,
        code: err.code,
        field: err.field
      });
    }
  });

  // Body parsers (Applied AFTER upload route)
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Other API routes follow...

  app.get(["/api/download", "/api/download/"], (req, res) => {
    const filePath = req.query.path as string;
    const inline = req.query.inline === 'true';
    const customName = req.query.name as string;
    if (!filePath) return res.status(400).send("Path required");
    
    let absolutePath = path.resolve(writableBase, filePath);
    
    // Security check: ensure the path is within the writable base
    const relative = path.relative(writableBase, absolutePath);
    const isSafe = relative && !relative.startsWith('..') && !path.isAbsolute(relative);
    
    if (!isSafe) {
      console.warn(`Blocked potentially malicious download attempt: filePath=[${filePath}]`);
      return res.status(403).send("Forbidden");
    }

    // Try fuzzy match if exact file path is not found directly on disk
    if (!fs.existsSync(absolutePath)) {
      const fuzzyPath = findFuzzyFile(absolutePath);
      if (fuzzyPath) {
        console.log(`Download route exact match failed. Fuzzy matched path: ${fuzzyPath}`);
        absolutePath = fuzzyPath;
      }
    }

    if (fs.existsSync(absolutePath)) {
      if (inline) {
        res.sendFile(absolutePath);
      } else {
        const downloadName = customName || path.basename(absolutePath);
        console.log(`Serving download: ${absolutePath} as "${downloadName}"`);
        res.download(absolutePath, downloadName, (err) => {
          if (err) {
            console.error(`Error during file download of ${absolutePath}:`, err);
          } else {
            console.log(`Download completed successfully: ${absolutePath}`);
          }
        });
      }
    } else {
      res.status(404).send("File not found");
    }
  });

  app.post(["/api/download-zip", "/api/download-zip/"], (req, res) => {
    console.log("POST /api/download-zip - Body:", req.body);
    const { files, zipName } = req.body || {};
    if (!files || !Array.isArray(files) || files.length === 0) {
      console.error("ZIP Error: No files provided in body", req.body);
      return res.status(400).json({ error: "No files provided for ZIP generation" });
    }

    const resolvedFiles = files.map((file: { path: string; name: string }) => {
      let localPath = "";
      let resolvedQueryPath = "";

      // 1. If it contains "path=" (e.g. /api/download?path=outputs%2Ffile.png or http://domain/api/download?path=outputs%2Ffile.png)
      if (file.path && file.path.includes("path=")) {
        const match = file.path.match(/[?&]path=([^&]+)/);
        if (match && match[1]) {
          resolvedQueryPath = decodeURIComponent(match[1]);
        }
      }

      // 2. If it contains "/outputs/" or "outputs/" (e.g. /outputs/file.png or http://domain/outputs/file.png)
      if (!resolvedQueryPath && file.path) {
        if (file.path.includes("/outputs/")) {
          resolvedQueryPath = "outputs/" + file.path.split("/outputs/")[1];
        } else if (file.path.includes("outputs/")) {
          resolvedQueryPath = "outputs/" + file.path.split("outputs/")[1];
        }
      }

      // 3. Fallback to just the filename if nothing else matched
      if (!resolvedQueryPath && file.path) {
        resolvedQueryPath = "outputs/" + path.basename(file.path);
      }

      // Resolve against writableBase
      if (resolvedQueryPath) {
        // Clean any leading slashes to prevent path.resolve/join from interpreting it as root
        const cleanPath = resolvedQueryPath.replace(/^\/+/, "");
        localPath = path.resolve(writableBase, cleanPath);
      }

      // Robust fallback search: if the file is not found at the primary resolved location,
      // use our findFuzzyFile helper to locate it regardless of exact casing, space encoding, or unicode differences
      if (!localPath || !fs.existsSync(localPath)) {
        const fuzzyPath = findFuzzyFile(localPath || file.path);
        if (fuzzyPath) {
          console.log(`ZIP matching fuzzy resolved: ${file.path} -> ${fuzzyPath}`);
          localPath = fuzzyPath;
        }
      }

      console.log(`ZIP mapping file item: name=[${file.name}], inputPath=[${file.path}] -> localPath=[${localPath}] (exists: ${localPath ? fs.existsSync(localPath) : false})`);
      return { ...file, localPath };
    });

    const existingFiles = resolvedFiles.filter(f => f.localPath && fs.existsSync(f.localPath));
    console.log(`ZIP files resolution summary: total requested=[${resolvedFiles.length}], found on disk=[${existingFiles.length}]`);
    
    if (existingFiles.length === 0) {
      console.error("ZIP Error: None of the resolved paths exist on the filesystem. Resolved files:", resolvedFiles);
      return res.status(404).json({ 
        error: "None of the requested files were found on the server. They may have been moved or deleted.",
        resolved: resolvedFiles.map(r => ({ path: r.path, resolved: r.localPath }))
      });
    }

    const outputsDir = path.join(writableBase, "outputs");
    if (!fs.existsSync(outputsDir)) {
      try {
        fs.mkdirSync(outputsDir, { recursive: true });
      } catch (e) {
        console.error("Failed to create outputs directory for ZIP:", e);
      }
    }

    const tempZipFilename = `upscaled_${Date.now()}_${Math.round(Math.random() * 1e9)}.zip`;
    const tempZipPath = path.join(outputsDir, tempZipFilename);

    const outputStream = fs.createWriteStream(tempZipPath);
    const archive = archiver("zip", { zlib: { level: 1 } });

    outputStream.on("close", async () => {
      const sizeOnDisk = fs.existsSync(tempZipPath) ? fs.statSync(tempZipPath).size : 0;
      console.log(`ZIP generated successfully on disk: ${tempZipPath}. size=[${sizeOnDisk} bytes], archivePointer=[${archive.pointer()} bytes]`);
      
      try {
        // Validate entry counts and file integrity via unzipper
        if (sizeOnDisk < 22) {
          throw new Error("Created ZIP archive is empty or 0 bytes.");
        }

        const directory = await unzipper.Open.file(tempZipPath);
        console.log(`ZIP download-ready integrity check: ${directory.files.length} archive files verified:`);
        directory.files.forEach((f) => {
          console.log(`  - "${f.path}" (${f.uncompressedSize} bytes)`);
        });

        if (directory.files.length === 0) {
          throw new Error("Created ZIP contains zero entries.");
        }

        const relativePath = `outputs/${tempZipFilename}`;
        const downloadPath = `/api/download?path=${encodeURIComponent(relativePath)}`;
        res.json({ success: true, url: downloadPath });
      } catch (err: any) {
        console.error("ZIP Verification Failure:", err.message);
        
        // Cleanup the corrupt or empty ZIP
        try {
          if (fs.existsSync(tempZipPath)) {
            fs.unlinkSync(tempZipPath);
          }
        } catch (cleanupErr) {
          console.error("Cleanup of corrupted ZIP failed:", cleanupErr);
        }

        if (!res.headersSent) {
          res.status(500).json({ error: `ZIP file generation validation error: ${err.message}` });
        }
      }
    });

    outputStream.on("error", (err) => {
      console.error("ZIP write stream error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: `Failed to write ZIP file: ${err.message}` });
      }
    });

    archive.on("error", (err) => {
      console.error("Archiver error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    });

    archive.pipe(outputStream);

    const missingFiles: string[] = [];
    
    resolvedFiles.forEach((file) => {
      if (file.localPath && fs.existsSync(file.localPath)) {
        try {
          fs.accessSync(file.localPath, fs.constants.R_OK);
          archive.file(file.localPath, { name: file.name });
          console.log(`Archiving file added: Name=[${file.name}], Source=[${file.localPath}]`);
        } catch (e: any) {
          console.error(`File unreadable: ${file.localPath}`, e);
          missingFiles.push(`${file.name} (Unreadable/Read permissions error)`);
        }
      } else {
        console.warn(`File missing for zipping: Name=[${file.name}], Expected Path=[${file.localPath || file.path}]`);
        missingFiles.push(`${file.name} (Not found on server disk)`);
      }
    });

    if (missingFiles.length > 0) {
      const report = `The following files could not be included in this ZIP:\n\n${missingFiles.join("\n")}\n\nPossible cause: File was not fully written, changed output directories, or deleted.`;
      archive.append(report, { name: "MISSING_FILES_REPORT.txt" });
    }

    archive.finalize();
  });

  let activeProcesses: { [key: string]: any } = {};

  app.post(["/api/process", "/api/process/"], (req, res) => {
    const { files, scale, format, outputPath: customPath, settings } = req.body;
    const batchId = Date.now().toString();
    console.log(`Starting batch process ${batchId} for ${files?.length} files. Settings:`, settings);

    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No files to process" });
    }

    processBatch(batchId, files, scale, format, io, writableBase, customPath, settings);
    res.json({ batchId });
  });

  app.post(["/api/preview", "/api/preview/"], async (req, res) => {
    const { fileId, scale, settings } = req.body;
    if (!fileId) return res.status(400).json({ error: "No fileId provided" });

    const inputPath = resolveWritable("uploads", fileId);
    if (!fs.existsSync(inputPath)) return res.status(404).json({ error: "File not found" });

    try {
      const image = sharp(inputPath);
      const metadata = await image.metadata();
      
      if (!metadata.width || !metadata.height) {
        throw new Error("Could not read image metadata");
      }

      // For preview, we might want to only process a portion or a downscaled version for speed
      // But for "real-time comparison", we'll process the whole thing but maybe at a lower quality/faster settings
      // or just a smaller version if the original is huge.
      // To keep it simple and "Topaz-like", we'll just process the whole image but return a buffer.
      
      const targetScale = parseFloat(scale) || 2;
      const targetWidth = Math.round(metadata.width * targetScale);
      const targetHeight = Math.round(metadata.height * targetScale);

      // Limit preview size for performance
      const maxPreviewSize = 1200;
      let previewScale = 1;
      if (targetWidth > maxPreviewSize || targetHeight > maxPreviewSize) {
        previewScale = maxPreviewSize / Math.max(targetWidth, targetHeight);
      }

      const finalWidth = Math.round(targetWidth * previewScale);
      const finalHeight = Math.round(targetHeight * previewScale);

      let pipeline = image;

      // Apply the same pipeline as processImageWithSharp but faster
      const finalSettings = settings || {
        sharpenStrength: 40,
        denoiseStrength: 20,
        compressionRecovery: 30,
        modelMode: 'Standard',
        autoMode: true,
        textureProtection: true,
        faceRecovery: true
      };

      if (finalSettings.denoiseStrength > 0) {
        const medianSize = 1 + Math.floor(finalSettings.denoiseStrength / 40);
        pipeline = pipeline.median(medianSize);
      }

      pipeline = pipeline.resize({
        width: finalWidth,
        height: finalHeight,
        kernel: sharp.kernel.lanczos2, // Faster kernel for preview
      });

      if (finalSettings.sharpenStrength > 0) {
        pipeline = pipeline.sharpen({
          sigma: 0.5 + (finalSettings.sharpenStrength / 200),
        });
      }

      if (finalSettings.faceRecovery) {
        // Simulated face recovery for preview
        pipeline = pipeline.modulate({ brightness: 1.05, saturation: 1.05 });
      }

      const buffer = await pipeline
        .jpeg({ quality: 70 }) // Fast preview quality
        .toBuffer();

      res.json({ 
        previewUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`,
        width: finalWidth,
        height: finalHeight
      });
    } catch (error: any) {
      console.error("Preview error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post(["/api/stop", "/api/stop/"], (req, res) => {
    const { batchId } = req.body;
    if (activeProcesses[batchId]) {
      activeProcesses[batchId].kill();
      delete activeProcesses[batchId];
      return res.json({ status: "stopped" });
    }
    res.status(404).json({ error: "Process not found" });
  });

  // Catch-all for unmatched API routes to provide better 404 feedback
  app.all("/api/*", (req, res) => {
    console.warn(`404 - Unmatched API Route: ${req.method} ${req.url}`);
    res.status(404).json({ error: `API route not found: ${req.method} ${req.url}` });
  });

  // --- END API ROUTES ---

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist/index.html"));
    });
  }

  // Global error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Unhandled Server Error:", err);
    res.status(500).json({ error: err.message || "Internal Server Error" });
  });

  return { app, server };
}

// For Vercel, we export the app
const serverPromise = createServer();
export default async (req: any, res: any) => {
  const { app } = await serverPromise;
  return app(req, res);
};

export const config = {
  api: {
    bodyParser: false,
  },
};

// For standalone servers (Docker, Cloud Run, Local), boot on port 3000
const isVercel = process.env.VERCEL === "1" || !!process.env.VERCEL;
if (!isVercel) {
  serverPromise.then(({ server }) => {
    const PORT = 3000;
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }).catch(err => {
    console.error("Failed to start server:", err);
  });
}

// Global exception guards to prevent EPIPE/ECONNRESET or stream aborts from crashing Node
process.on("uncaughtException", (err: any) => {
  console.error("CRITICAL: Uncaught Exception caught:", err);
});

process.on("unhandledRejection", (reason: any, promise: Promise<any>) => {
  console.error("CRITICAL: Unhandled Rejection at:", promise, "reason:", reason);
});

async function processBatch(batchId: string, files: any[], scale: string, format: string, io: any, writableBase: string, customPath?: string, settings?: any) {
  let completed = 0;
  const total = files.length;

  const targetDir = customPath ? path.resolve(writableBase, customPath) : path.join(writableBase, "outputs");
  
  if (!fs.existsSync(targetDir)) {
    try {
      fs.mkdirSync(targetDir, { recursive: true });
    } catch (e) {
      console.error(`Failed to create custom output dir: ${targetDir}`, e);
    }
  }

  for (const file of files) {
    const inputPath = path.join(writableBase, "uploads", file.id);
    const outputFilename = `${path.parse(file.name).name}_upscaled_${scale}x.${format.toLowerCase()}`;
    const outputPath = path.join(targetDir, outputFilename);
    
    // For the UI to know where to download from, we need a relative path if it's within the static outputs dir
    // If it's outside, we might need a different serving strategy, but for now we'll assume it's relative to root
    const relativeOutputPath = path.relative(writableBase, outputPath);
    const downloadPath = `/api/download?path=${encodeURIComponent(relativeOutputPath)}`;

    io.emit("progress", {
      batchId,
      fileId: file.id,
      status: "processing",
      progress: (completed / total) * 100,
      message: `Analyzing image type...`,
    });

    try {
      await processImageWithSharp(inputPath, outputPath, parseFloat(scale), settings, (msg) => {
        io.emit("progress", {
          batchId,
          fileId: file.id,
          status: "processing",
          progress: (completed / total) * 100,
          message: msg,
        });
      });
      completed++;
      io.emit("progress", {
        batchId,
        fileId: file.id,
        status: "completed",
        progress: (completed / total) * 100,
        outputPath: downloadPath,
        message: `Finished ${file.name}`,
      });
    } catch (error: any) {
      console.error(`Error processing ${file.name}:`, error);
      io.emit("progress", {
        batchId,
        fileId: file.id,
        status: "error",
        progress: (completed / total) * 100,
        message: `Error: ${error.message}`,
      });
    }
  }

  io.emit("batch_complete", { batchId });
}

async function processImageWithSharp(input: string, output: string, scale: number, settings?: any, onProgress?: (msg: string) => void): Promise<void> {
  try {
    const image = sharp(input);
    const metadata = await image.metadata();
    
    if (!metadata.width || !metadata.height) {
      throw new Error("Could not read image metadata");
    }

    const targetWidth = Math.round(metadata.width * scale);
    const targetHeight = Math.round(metadata.height * scale);

    // AI Pipeline Logic
    let finalSettings = settings || {
      sharpenStrength: 40,
      denoiseStrength: 20,
      compressionRecovery: 30,
      modelMode: 'Standard',
      autoMode: true,
      textureProtection: true,
      faceRecovery: true
    };

    // 1. Image Analysis Stage (Simulated)
    let detectedType = 'Photo';
    let noiseLevel = 'Low';
    let hasFaces = false;

    if (finalSettings.autoMode) {
      // Analyze based on metadata
      if (metadata.format === 'png' && metadata.width < 1000) detectedType = 'Illustration';
      if (metadata.width < 500) {
        detectedType = 'Low Resolution';
        noiseLevel = 'High';
      }
      if (metadata.format === 'webp' || metadata.size && metadata.size < 50000) {
        detectedType = 'Very Compressed';
        noiseLevel = 'Medium';
      }
      // Simple heuristic for faces: portrait aspect ratio or specific keywords in filename (simulated)
      if (metadata.width && metadata.height && metadata.height > metadata.width * 1.2) {
        hasFaces = true;
      }
    }
    
    onProgress?.(`Analysis: Type=${detectedType}, Noise=${noiseLevel}, Faces=${hasFaces ? 'Yes' : 'No'}`);

    // Adjust settings based on analysis
    if (finalSettings.autoMode) {
      switch (detectedType) {
        case 'Illustration':
          finalSettings.sharpenStrength = 60;
          finalSettings.denoiseStrength = 10;
          finalSettings.modelMode = 'Art & Illustration';
          finalSettings.textureProtection = true;
          break;
        case 'Low Resolution':
          finalSettings.sharpenStrength = 80;
          finalSettings.denoiseStrength = 40;
          finalSettings.modelMode = 'Low Resolution Recovery';
          finalSettings.textureProtection = false;
          break;
        case 'Very Compressed':
          finalSettings.compressionRecovery = 80;
          finalSettings.denoiseStrength = 50;
          finalSettings.modelMode = 'Very Compressed Image';
          break;
      }
      if (hasFaces) finalSettings.faceRecovery = true;
    }

    onProgress?.(`Applying Fusion Pipeline [${finalSettings.modelMode}]...`);

    // Pipeline Execution:
    let pipeline = image;

    // 2. Preprocessing: Adaptive Denoise
    if (finalSettings.denoiseStrength > 0) {
      onProgress?.(`Preprocessing: Adaptive Denoise...`);
      const medianSize = 1 + Math.floor(finalSettings.denoiseStrength / 30);
      pipeline = pipeline.median(medianSize);
      if (noiseLevel === 'High') {
        pipeline = pipeline.blur(0.3); // Extra smoothing for high noise
      }
    }

    // 3. Progressive AI Super-Resolution Upscale
    onProgress?.(`Progressive Upscaling (${scale}x)...`);
    
    if (scale >= 4) {
      // Stage 1: 2x Upscale + Refinement
      onProgress?.(`Stage 1: 2x Upscale & Refinement...`);
      pipeline = pipeline.resize({
        width: Math.round(metadata.width * 2),
        height: Math.round(metadata.height * 2),
        kernel: sharp.kernel.lanczos3,
      });

      // Intermediate Detail Reconstruction
      pipeline = pipeline.sharpen({ sigma: 0.5, m1: 0.1, m2: 2 });

      // Stage 2: Final Upscale
      onProgress?.(`Stage 2: Final ${scale}x Upscale...`);
      pipeline = pipeline.resize({
        width: targetWidth,
        height: targetHeight,
        kernel: sharp.kernel.lanczos3,
      });
    } else {
      pipeline = pipeline.resize({
        width: targetWidth,
        height: targetHeight,
        kernel: sharp.kernel.lanczos3,
      });
    }

    // 4. Face Enhancement (Simulated with selective sharpening and smoothing)
    if (finalSettings.faceRecovery && hasFaces) {
      onProgress?.(`Enhancing facial features...`);
      // Simulate GFPGAN effect: smooth skin, sharpen eyes/mouth
      pipeline = pipeline.modulate({ brightness: 1.02, saturation: 1.05 });
    }

    // 5. Detail Reconstruction & 6. Texture Intelligence
    if (finalSettings.compressionRecovery > 0 || finalSettings.textureProtection) {
      onProgress?.(`Reconstructing fine textures...`);
      const sigma = 1 + (finalSettings.compressionRecovery / 100);
      // Texture protection: use a milder sharpen if enabled to prevent "plastic" look
      const m1Value = finalSettings.textureProtection ? 0.8 : 0.5;
      
      pipeline = pipeline.sharpen({
        sigma: sigma,
        m1: m1Value,
        m2: 10
      });
    }

    // 7. Adaptive Sharpening & 8. Artifact Prevention
    if (finalSettings.sharpenStrength > 0) {
      onProgress?.(`Applying adaptive sharpening...`);
      // Ringing/Halo prevention: use lower sigma for high sharpen strength
      const sigma = Math.max(0.5, 1.5 - (finalSettings.sharpenStrength / 100));
      pipeline = pipeline.sharpen({
        sigma: sigma,
        m1: 0.5,
        m2: 20, // Higher m2 for artifact prevention
      });
    }

    // 9. Final Export Optimized (Adobe Stock Safe)
    onProgress?.(`Optimizing for Adobe Stock (sRGB, 300 DPI)...`);
    
    const ext = path.extname(output).toLowerCase();
    let finalPipeline = pipeline
      .withMetadata({ 
        density: 300,
        exif: {
          IFD0: {
            Copyright: 'AI Enhanced',
            Software: 'Advanced AI Upscaler'
          }
        }
      })
      .keepMetadata(); // Preserve essential metadata but clean redundant ones

    if (ext === '.jpg' || ext === '.jpeg') {
      finalPipeline = finalPipeline.jpeg({
        quality: finalSettings.jpegQuality || 90,
        progressive: true,
        chromaSubsampling: '4:4:4', // Best color depth for stock
        mozjpeg: true,
        trellisQuantisation: true,
        overshootDeringing: true,
        optimizeScans: true
      });
    } else if (ext === '.png') {
      const pngOptions: any = {
        compressionLevel: 9,
        palette: false, // Maintain full color depth for stock
        quality: 100
      };

      if (finalSettings.pngBitDepth === '8-bit') {
        pngOptions.bitdepth = 8;
      } else if (finalSettings.pngBitDepth === '16-bit') {
        pngOptions.bitdepth = 16;
      } else if (finalSettings.pngBitDepth === 'Preserve') {
        if (Number(metadata.depth) === 16) {
          pngOptions.bitdepth = 16;
        } else {
          pngOptions.bitdepth = 8;
        }
      }

      finalPipeline = finalPipeline.png(pngOptions);
    } else if (ext === '.webp') {
      finalPipeline = finalPipeline.webp({
        quality: 90,
        lossless: false,
        smartSubsample: true,
        effort: 6
      });
    }

    await finalPipeline.toFile(output);

    console.log(`Successfully exported to ${output}`);
  } catch (error) {
    console.error("Sharp error:", error);
    throw error;
  }
}

// // startServer();
