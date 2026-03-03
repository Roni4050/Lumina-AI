import React, { useState, useCallback, useEffect, useRef } from 'react';
import { 
  Upload, 
  Image as ImageIcon, 
  Settings, 
  Play, 
  Square, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  X,
  ChevronRight,
  Download,
  Maximize2,
  Layers,
  FileArchive,
  RotateCcw,
  Sliders,
  Sparkles,
  Zap,
  Eye,
  EyeOff,
  Info,
  ZoomIn,
  ZoomOut,
  Move,
  MousePointer2,
  Split
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { io, Socket } from 'socket.io-client';

interface UploadedFile {
  id: string;
  name: string;
  path: string;
  previewUrl?: string;
  width?: number;
  height?: number;
  status: 'idle' | 'processing' | 'completed' | 'error';
  progress: number;
  message?: string;
  outputPath?: string;
}

interface ComparisonViewerProps {
  originalUrl: string;
  upscaledUrl: string;
  isLoading: boolean;
}

function ComparisonViewer({ originalUrl, upscaledUrl, isLoading }: ComparisonViewerProps) {
  const [sliderPos, setSliderPos] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastMousePos = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setIsPanning(true);
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      setSliderPos(Math.min(Math.max(x, 0), 100));
    }
    if (isPanning) {
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      setOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setIsPanning(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(prev => Math.min(Math.max(prev * delta, 0.5), 10));
  };

  const resetView = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setSliderPos(50);
  };

  return (
    <div 
      ref={containerRef}
      className="w-full h-full relative cursor-crosshair select-none overflow-hidden"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
    >
      {/* Zoom/Pan Controls Overlay */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 p-1.5 bg-black/60 backdrop-blur-md border border-white/10 rounded-2xl shadow-2xl">
        <button 
          onClick={() => setZoom(prev => Math.max(prev - 0.5, 0.5))}
          className="p-2 hover:bg-white/10 rounded-xl transition-all text-zinc-400 hover:text-white"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <div className="w-px h-4 bg-white/10" />
        <button onClick={() => setZoom(1)} className="px-3 py-1 text-[10px] font-bold hover:bg-white/10 rounded-lg transition-all">100%</button>
        <button onClick={() => setZoom(2)} className="px-3 py-1 text-[10px] font-bold hover:bg-white/10 rounded-lg transition-all">200%</button>
        <button onClick={() => setZoom(4)} className="px-3 py-1 text-[10px] font-bold hover:bg-white/10 rounded-lg transition-all">400%</button>
        <div className="w-px h-4 bg-white/10" />
        <button 
          onClick={() => setZoom(prev => Math.min(prev + 0.5, 10))}
          className="p-2 hover:bg-white/10 rounded-xl transition-all text-zinc-400 hover:text-white"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <div className="w-px h-4 bg-white/10" />
        <button 
          onClick={resetView}
          className="p-2 hover:bg-white/10 rounded-xl transition-all text-zinc-400 hover:text-white"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      {/* Labels */}
      <div className="absolute top-4 left-4 z-20 px-3 py-1.5 bg-black/60 backdrop-blur-md border border-white/10 rounded-lg text-[10px] font-bold uppercase tracking-widest text-zinc-400">
        Original
      </div>
      <div className="absolute top-4 right-4 z-20 px-3 py-1.5 bg-emerald-500/20 backdrop-blur-md border border-emerald-500/30 rounded-lg text-[10px] font-bold uppercase tracking-widest text-emerald-500">
        AI Upscaled
      </div>

      {/* Images Container */}
      <div 
        className="w-full h-full flex items-center justify-center transition-transform duration-75 ease-out"
        style={{ 
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`
        }}
      >
        {/* Original Image (Bottom Layer) */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <img 
            src={originalUrl} 
            alt="Original" 
            className="max-w-full max-h-full object-contain"
            referrerPolicy="no-referrer"
          />
        </div>

        {/* Upscaled Image (Top Layer with Clip) */}
        <div 
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ 
            clipPath: `inset(0 0 0 ${sliderPos}%)`
          }}
        >
          <img 
            src={upscaledUrl} 
            alt="Upscaled" 
            className="max-w-full max-h-full object-contain"
            referrerPolicy="no-referrer"
          />
        </div>
      </div>

      {/* Slider Handle */}
      <div 
        className="absolute top-0 bottom-0 z-20 w-1 bg-white cursor-col-resize group"
        style={{ left: `${sliderPos}%` }}
        onMouseDown={(e) => {
          e.stopPropagation();
          setIsDragging(true);
        }}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 bg-white rounded-full shadow-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
          <Split className="w-5 h-5 text-black" />
        </div>
      </div>

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-40 bg-black/20 backdrop-blur-[2px] flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
            <span className="text-xs font-bold text-white uppercase tracking-widest">Updating Preview...</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [scale, setScale] = useState<string>('2');
  const [format, setFormat] = useState<string>('PNG');
  const [outputPath, setOutputPath] = useState<string>('outputs');
  const [selectedPreview, setSelectedPreview] = useState<UploadedFile | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Manual Quality Controls
  const [sharpenStrength, setSharpenStrength] = useState<number>(40);
  const [denoiseStrength, setDenoiseStrength] = useState<number>(20);
  const [compressionRecovery, setCompressionRecovery] = useState<number>(30);
  const [modelMode, setModelMode] = useState<string>('Standard');
  const [autoMode, setAutoMode] = useState<boolean>(true);
  const [textureProtection, setTextureProtection] = useState<boolean>(true);
  const [faceRecovery, setFaceRecovery] = useState<boolean>(true);
  const [pngBitDepth, setPngBitDepth] = useState<string>('Preserve');
  const [jpegQuality, setJpegQuality] = useState<number>(90);
  const [upscaledPreviewUrl, setUpscaledPreviewUrl] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isSystemReady, setIsSystemReady] = useState<boolean | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch('/api/health');
        setIsSystemReady(res.ok);
      } catch (e) {
        setIsSystemReady(false);
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    socketRef.current = io();

    socketRef.current.on('progress', (data) => {
      setFiles(prev => prev.map(f => {
        if (f.id === data.fileId) {
          return {
            ...f,
            status: data.status,
            progress: data.progress,
            message: data.message,
            outputPath: data.outputPath || f.outputPath
          };
        }
        return f;
      }));
    });

    socketRef.current.on('batch_complete', () => {
      setIsProcessing(false);
      setBatchId(null);
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (selectedPreview) {
      fetchUpscaledPreview();
    } else {
      setUpscaledPreviewUrl(null);
    }
  }, [selectedPreview, scale, sharpenStrength, denoiseStrength, compressionRecovery, modelMode, autoMode, textureProtection, faceRecovery, pngBitDepth, jpegQuality]);

  const fetchUpscaledPreview = async () => {
    if (!selectedPreview) return;
    // If already completed, use the actual output path (with inline=true)
    if (selectedPreview.status === 'completed' && selectedPreview.outputPath) {
      setUpscaledPreviewUrl(`${selectedPreview.outputPath}&inline=true`);
      setIsPreviewLoading(false);
      return;
    }

    setIsPreviewLoading(true);
    try {
      const res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: selectedPreview.id,
          scale,
          settings: {
            sharpenStrength,
            denoiseStrength,
            compressionRecovery,
            modelMode,
            autoMode,
            textureProtection,
            faceRecovery,
            pngBitDepth,
            jpegQuality
          }
        })
      });
      const data = await res.json();
      if (data.previewUrl) {
        setUpscaledPreviewUrl(data.previewUrl);
      }
    } catch (e) {
      console.error("Failed to fetch preview:", e);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files) as File[];
    handleUpload(droppedFiles);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleUpload(Array.from(e.target.files));
    }
  };

  const handleUpload = async (newFiles: File[]) => {
    const formData = new FormData();
    newFiles.forEach(file => formData.append('images', file));

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        let errorMessage = `Server returned ${response.status} ${response.statusText}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (e) {
          // If JSON parsing fails, try to get the text body
          const text = await response.text().catch(() => '');
          if (text) {
            // Strip HTML tags if it's an HTML error page
            const cleanText = text.replace(/<[^>]*>?/gm, '').trim().substring(0, 150);
            errorMessage += `: ${cleanText}`;
          }
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      
      const uploaded: UploadedFile[] = (data.files as any[]).map((f: any) => ({
        ...f,
        previewUrl: `/uploads/${f.id}`,
        width: f.width,
        height: f.height,
        status: 'idle',
        progress: 0
      }));
      
      setFiles(prev => [...prev, ...uploaded]);
    } catch (error: any) {
      console.error('Upload failed:', error);
      alert(`Upload failed: ${error.message}`);
    }
  };

  const startProcessing = async () => {
    if (files.length === 0) return;
    setIsProcessing(true);
    
    try {
      const response = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          files, 
          scale, 
          format, 
          outputPath,
          settings: {
            sharpenStrength,
            denoiseStrength,
            compressionRecovery,
            modelMode,
            autoMode,
            textureProtection,
            faceRecovery,
            pngBitDepth,
            jpegQuality
          }
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown server error' }));
        throw new Error(errorData.error || `Processing failed with status ${response.status}`);
      }

      const data = await response.json();
      setBatchId(data.batchId);
    } catch (error: any) {
      console.error('Processing failed:', error);
      alert(`Processing failed: ${error.message}`);
      setIsProcessing(false);
    }
  };

  const stopProcessing = async () => {
    if (!batchId) return;
    try {
      const response = await fetch('/api/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown server error' }));
        throw new Error(errorData.error || `Stop failed with status ${response.status}`);
      }

      setIsProcessing(false);
      setBatchId(null);
    } catch (error: any) {
      console.error('Stop failed:', error);
      alert(`Stop failed: ${error.message}`);
    }
  };

  const downloadAsZip = async (filesToZip: UploadedFile[], zipName?: string) => {
    const filesToProcess = filesToZip
      .filter(f => f.status === 'completed' && f.outputPath)
      .map(f => {
        const fileNameWithoutExt = f.name.substring(0, f.name.lastIndexOf('.')) || f.name;
        return {
          path: f.outputPath!,
          name: `${fileNameWithoutExt}_upscaled.${format.toLowerCase()}`
        };
      });

    if (filesToProcess.length === 0) return;

    try {
      const response = await fetch('/api/download-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: filesToProcess, zipName }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to generate ZIP' }));
        throw new Error(errorData.error || 'Failed to generate ZIP');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = zipName || `upscaled_batch_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error: any) {
      console.error('ZIP download failed:', error);
      alert(`ZIP download failed: ${error.message}`);
    }
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const clearCompleted = () => {
    setFiles(prev => prev.filter(f => f.status !== 'completed'));
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100 font-sans selection:bg-emerald-500/30">
      {/* Header */}
      <header className="h-14 border-b border-white/5 flex items-center justify-between px-6 bg-[#0d0d0d]/90 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(16,185,129,0.3)]">
            <Maximize2 className="w-5 h-5 text-black" />
          </div>
          <h1 className="font-bold tracking-tight text-lg">Lumina <span className="text-emerald-500">AI</span></h1>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Engine v3.1 Pro</span>
          </div>
        </div>
      </header>

      <main className="flex h-[calc(100vh-3.5rem)]">
        {/* Left Panel: File List */}
        <div className="flex-1 flex flex-col border-r border-white/5 overflow-hidden">
          <div className="p-4 border-b border-white/5 flex items-center justify-between bg-[#0d0d0d]">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-zinc-500" />
                <span className="text-sm font-semibold">Queue ({files.length})</span>
              </div>
              {!isProcessing && files.length > 0 && (
                <label className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 text-emerald-500 rounded-lg text-xs font-bold cursor-pointer hover:bg-emerald-500/20 transition-all border border-emerald-500/20">
                  <Upload className="w-3.5 h-3.5" />
                  Add More
                  <input type="file" multiple className="hidden" onChange={handleFileSelect} accept="image/*" />
                </label>
              )}
            </div>
            <div className="flex items-center gap-4">
              {files.some(f => f.status === 'completed') && (
                <>
                  <button 
                    onClick={() => downloadAsZip(files)}
                    className="flex items-center gap-1.5 text-xs text-emerald-500 hover:text-emerald-400 transition-colors font-medium"
                  >
                    <Download className="w-3 h-3" />
                    Download All (ZIP)
                  </button>
                  <div className="w-px h-3 bg-white/10" />
                  <button 
                    onClick={clearCompleted}
                    className="text-xs text-zinc-500 hover:text-white transition-colors"
                  >
                    Clear Completed
                  </button>
                </>
              )}
            </div>
          </div>

          <div 
            className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar"
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
          >
            {files.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8">
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="w-24 h-24 rounded-[2rem] bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 flex items-center justify-center mb-8 border border-emerald-500/20 shadow-[0_0_30px_rgba(16,185,129,0.1)]"
                >
                  <Upload className="w-10 h-10 text-emerald-500" />
                </motion.div>
                <h3 className="text-2xl font-bold mb-3 tracking-tight">Enhance your images</h3>
                <p className="text-zinc-500 text-sm max-w-xs mb-10 leading-relaxed">
                  Professional-grade AI upscaling for JPG, PNG, and WebP. Unlimited batch processing.
                </p>
                <label className="px-8 py-4 bg-emerald-500 text-black rounded-2xl font-bold text-sm cursor-pointer hover:bg-emerald-400 transition-all active:scale-95 shadow-[0_4px_20px_rgba(16,185,129,0.3)]">
                  Select Images
                  <input type="file" multiple className="hidden" onChange={handleFileSelect} accept="image/*" />
                </label>
              </div>
            ) : (
              <AnimatePresence mode="popLayout">
                {files.map((file) => (
                  <motion.div
                    key={file.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className={`group p-3 rounded-xl border transition-all ${
                      file.status === 'processing' 
                        ? 'bg-emerald-500/5 border-emerald-500/30' 
                        : 'bg-white/5 border-white/5 hover:border-white/10'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <button 
                        onClick={() => setSelectedPreview(file)}
                        className="w-16 h-16 rounded-xl bg-black/40 flex items-center justify-center overflow-hidden border border-white/10 relative group/preview cursor-zoom-in hover:border-emerald-500/50 transition-all"
                      >
                        {file.previewUrl ? (
                          <img 
                            src={file.previewUrl} 
                            alt={file.name} 
                            className="w-full h-full object-cover group-hover/preview:scale-110 transition-transform duration-500"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <ImageIcon className="w-8 h-8 text-zinc-600" />
                        )}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/preview:opacity-100 transition-opacity flex items-center justify-center">
                          <Maximize2 className="w-4 h-4 text-white" />
                        </div>
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex flex-col truncate pr-4">
                            <h4 className="text-sm font-medium truncate">{file.name}</h4>
                            {file.width && file.height && (
                              <span className="text-[10px] text-zinc-500 font-mono">
                                {file.width} × {file.height} px 
                                <ChevronRight className="w-2 h-2 inline mx-1" />
                                <span className="text-emerald-500">
                                  {file.width * parseInt(scale)} × {file.height * parseInt(scale)} px
                                </span>
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {file.status === 'completed' && (
                              <div className="flex items-center gap-1">
                                <button 
                                  onClick={() => setSelectedPreview(file)}
                                  title="Preview Comparison"
                                  className="p-1.5 bg-white/10 rounded-md text-white hover:bg-white/20 transition-colors"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                                <a 
                                  href={file.outputPath} 
                                  download={`${file.name.substring(0, file.name.lastIndexOf('.')) || file.name}_upscaled_${scale}x.${format.toLowerCase()}`}
                                  title="Download Image"
                                  className="p-1.5 bg-emerald-500 rounded-md text-black hover:bg-emerald-400 transition-colors"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </a>
                                <button 
                                  onClick={() => {
                                    const fileNameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
                                    downloadAsZip([file], `${fileNameWithoutExt}_upscaled.zip`);
                                  }}
                                  title="Download as ZIP"
                                  className="p-1.5 bg-white/10 rounded-md text-white hover:bg-white/20 transition-colors"
                                >
                                  <FileArchive className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                            {!isProcessing && (
                              <button 
                                onClick={() => removeFile(file.id)}
                                className="p-1.5 text-zinc-500 hover:text-white hover:bg-white/5 rounded-md transition-all"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-3">
                          {file.status === 'processing' && (
                            <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                              <motion.div 
                                className="h-full bg-emerald-500"
                                initial={{ width: 0 }}
                                animate={{ width: `${file.progress}%` }}
                              />
                            </div>
                          )}
                          <span className={`text-[10px] uppercase tracking-wider font-bold ${
                            file.status === 'completed' ? 'text-emerald-500' :
                            file.status === 'error' ? 'text-red-500' :
                            file.status === 'processing' ? 'text-emerald-400' : 'text-zinc-500'
                          }`}>
                            {file.status === 'processing' ? `Upscaling ${Math.round(file.progress)}%` : file.status}
                          </span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </div>
        </div>

        {/* Right Panel: Settings */}
        <div className="w-80 bg-[#0d0d0d] flex flex-col">
          <div className="p-4 border-b border-white/5 flex items-center gap-2">
            <Settings className="w-4 h-4 text-zinc-500" />
            <span className="text-sm font-semibold">Settings</span>
          </div>

          <div className="p-6 space-y-8 flex-1 overflow-y-auto custom-scrollbar">
            {/* Scale Selector */}
            <section>
              <label className="text-[10px] uppercase tracking-widest font-bold text-zinc-500 mb-4 block">Upscale Factor</label>
              <div className="grid grid-cols-2 gap-2">
                {['2', '3', '4', '6'].map((s) => (
                  <button
                    key={s}
                    onClick={() => setScale(s)}
                    disabled={isProcessing}
                    className={`py-3 rounded-xl text-sm font-bold transition-all border ${
                      scale === s 
                        ? 'bg-emerald-500 text-black border-emerald-500 shadow-lg shadow-emerald-500/20' 
                        : 'bg-white/5 text-zinc-400 border-white/5 hover:border-white/10'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </section>

            {/* Manual Quality Controls */}
            <section className="space-y-6">
              <div className="flex items-center justify-between">
                <label className="text-[10px] uppercase tracking-widest font-bold text-zinc-500">Manual Settings</label>
                <div className="flex items-center gap-2">
                  {!autoMode && (
                    <button 
                      onClick={() => {
                        setSharpenStrength(40);
                        setDenoiseStrength(20);
                        setCompressionRecovery(30);
                        setModelMode('Standard');
                      }}
                      title="Reset to Defaults"
                      className="p-1 text-zinc-500 hover:text-white transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" />
                    </button>
                  )}
                  <div className="flex items-center gap-3">
                    <span className={`text-[10px] font-bold transition-colors ${autoMode ? 'text-emerald-500' : 'text-zinc-500'}`}>
                      {autoMode ? 'AUTO' : 'MANUAL'}
                    </span>
                    <button 
                      onClick={() => setAutoMode(!autoMode)}
                      className={`relative w-8 h-4 rounded-full transition-colors duration-200 focus:outline-none ${
                        autoMode ? 'bg-emerald-500' : 'bg-white/10'
                      }`}
                    >
                      <motion.div 
                        animate={{ x: autoMode ? 18 : 2 }}
                        transition={{ type: "spring", stiffness: 500, damping: 30 }}
                        className="absolute top-1 w-2 h-2 bg-white rounded-full shadow-sm"
                      />
                    </button>
                  </div>
                </div>
              </div>

              {!autoMode && (
                <div className="space-y-5 animate-in fade-in slide-in-from-top-2 duration-300">
                  {/* Model Mode Selector */}
                  <div className="space-y-2">
                    <label className="text-[10px] text-zinc-400 font-medium flex items-center gap-1.5">
                      <Sparkles className="w-3 h-3" />
                      AI Model Mode
                    </label>
                    <select 
                      value={modelMode}
                      onChange={(e) => setModelMode(e.target.value)}
                      className="w-full bg-white/5 border border-white/5 rounded-lg py-2 px-3 text-xs focus:outline-none focus:border-emerald-500/50 transition-all"
                    >
                      <option value="Standard">Standard</option>
                      <option value="High Fidelity">High Fidelity</option>
                      <option value="Art & Illustration">Art & Illustration</option>
                      <option value="Low Resolution Recovery">Low Res Recovery</option>
                      <option value="Very Compressed Image">Very Compressed</option>
                    </select>
                  </div>

                  {/* Sliders */}
                  <div className="space-y-4">
                    {[
                      { label: 'Sharpen Strength', value: sharpenStrength, setter: setSharpenStrength, icon: <Zap className="w-3 h-3" /> },
                      { label: 'Denoise Strength', value: denoiseStrength, setter: setDenoiseStrength, icon: <RotateCcw className="w-3 h-3" /> },
                      { label: 'Compression Recovery', value: compressionRecovery, setter: setCompressionRecovery, icon: <FileArchive className="w-3 h-3" /> }
                    ].map((slider) => (
                      <div key={slider.label} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] text-zinc-400 font-medium flex items-center gap-1.5">
                            {slider.icon}
                            {slider.label}
                          </label>
                          <span className="text-[10px] font-mono text-emerald-500">{slider.value}</span>
                        </div>
                        <input 
                          type="range" 
                          min="0" 
                          max="100" 
                          value={slider.value}
                          onChange={(e) => slider.setter(parseInt(e.target.value))}
                          className="w-full h-1 bg-white/5 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                        />
                      </div>
                    ))}
                  </div>

                  {/* Additional AI Toggles */}
                  <div className="space-y-3 pt-2 border-t border-white/5">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] text-zinc-400 font-medium flex items-center gap-1.5">
                        <Layers className="w-3 h-3" />
                        Texture Protection
                      </label>
                      <button 
                        onClick={() => setTextureProtection(!textureProtection)}
                        className={`relative w-7 h-3.5 rounded-full transition-colors duration-200 focus:outline-none ${
                          textureProtection ? 'bg-emerald-500' : 'bg-white/10'
                        }`}
                      >
                        <motion.div 
                          animate={{ x: textureProtection ? 15 : 2 }}
                          transition={{ type: "spring", stiffness: 500, damping: 30 }}
                          className="absolute top-0.5 w-2.5 h-2.5 bg-white rounded-full shadow-sm"
                        />
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] text-zinc-400 font-medium flex items-center gap-1.5">
                        <Sparkles className="w-3 h-3" />
                        Face Recovery
                      </label>
                      <button 
                        onClick={() => setFaceRecovery(!faceRecovery)}
                        className={`relative w-7 h-3.5 rounded-full transition-colors duration-200 focus:outline-none ${
                          faceRecovery ? 'bg-emerald-500' : 'bg-white/10'
                        }`}
                      >
                        <motion.div 
                          animate={{ x: faceRecovery ? 15 : 2 }}
                          transition={{ type: "spring", stiffness: 500, damping: 30 }}
                          className="absolute top-0.5 w-2.5 h-2.5 bg-white rounded-full shadow-sm"
                        />
                      </button>
                    </div>
                  </div>
                </div>
              )}
              
              {autoMode && (
                <div className="p-3 rounded-xl bg-white/5 border border-white/5 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-emerald-500" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-tight">Auto-Optimization</span>
                    <span className="text-[9px] text-zinc-500 leading-tight">AI will analyze each image and apply optimal settings automatically.</span>
                  </div>
                </div>
              )}
            </section>

            {/* Format Selector */}
            <section>
              <label className="text-[10px] uppercase tracking-widest font-bold text-zinc-500 mb-4 block">Export Format</label>
              <div className="space-y-2">
                {['PNG', 'JPG', 'JPEG'].map((f) => (
                  <button
                    key={f}
                    onClick={() => setFormat(f)}
                    disabled={isProcessing}
                    className={`w-full py-3 px-4 rounded-xl text-sm font-bold flex items-center justify-between transition-all border ${
                      format === f 
                        ? 'bg-white/10 text-white border-white/20' 
                        : 'bg-white/5 text-zinc-500 border-white/5 hover:border-white/10'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {f}
                    {format === f && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                  </button>
                ))}
              </div>
            </section>

            {/* PNG Bit Depth (Conditional) */}
            {format === 'PNG' && (
              <section>
                <label className="text-[10px] uppercase tracking-widest font-bold text-zinc-500 mb-4 block">PNG Bit Depth</label>
                <div className="grid grid-cols-3 gap-2">
                  {['Preserve', '8-bit', '16-bit'].map((bd) => (
                    <button
                      key={bd}
                      onClick={() => setPngBitDepth(bd)}
                      disabled={isProcessing}
                      className={`py-2 px-1 rounded-lg text-[10px] font-bold transition-all border ${
                        pngBitDepth === bd
                          ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                          : 'bg-white/5 text-zinc-500 border-white/5 hover:border-white/10'
                      } disabled:opacity-50`}
                    >
                      {bd}
                    </button>
                  ))}
                </div>
                <p className="text-[9px] text-zinc-600 mt-2 px-1 leading-tight">
                  {pngBitDepth === '16-bit' ? 'High precision, prevents banding.' : 
                   pngBitDepth === '8-bit' ? 'Standard quality, smaller file size.' : 
                   'Matches source image bit depth.'}
                </p>
              </section>
            )}

            {/* JPEG Quality (Conditional) */}
            {(format === 'JPG' || format === 'JPEG') && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-zinc-500">JPEG Quality</label>
                  <span className="text-[10px] font-mono text-emerald-500">{jpegQuality}%</span>
                </div>
                <input 
                  type="range" 
                  min="10" 
                  max="100" 
                  value={jpegQuality}
                  onChange={(e) => setJpegQuality(parseInt(e.target.value))}
                  disabled={isProcessing}
                  className="w-full h-1 bg-white/5 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
                <p className="text-[9px] text-zinc-600 mt-2 px-1 leading-tight">
                  Higher values preserve more detail but result in larger files.
                </p>
              </section>
            )}

            {/* Output Destination */}
            <section>
              <label className="text-[10px] uppercase tracking-widest font-bold text-zinc-500 mb-4 block">Output Destination</label>
              <div className="space-y-3">
                <div className="relative group">
                  <input 
                    type="text" 
                    value={outputPath}
                    onChange={(e) => setOutputPath(e.target.value)}
                    disabled={isProcessing}
                    placeholder="e.g. outputs/upscaled"
                    className="w-full bg-white/5 border border-white/5 rounded-xl py-3 px-4 text-sm focus:outline-none focus:border-emerald-500/50 transition-all disabled:opacity-50"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                    <ChevronRight className="w-4 h-4 text-zinc-600 group-focus-within:text-emerald-500 transition-colors" />
                  </div>
                </div>
                <p className="text-[10px] text-zinc-600 leading-tight px-1">
                  Path relative to server root. Default is <code className="text-zinc-400">outputs</code>.
                </p>
              </div>
            </section>

            {/* Info Box */}
            <div className="p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/10 space-y-2">
              <div className="flex items-center gap-2 text-emerald-500">
                <Sparkles className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-tight">AI Fusion Engine v4.0</span>
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Using multi-stage progressive upscaling with <span className="text-emerald-500 font-bold">Texture Intelligence</span> and <span className="text-emerald-500 font-bold">Face Recovery</span>. Optimized for Adobe Stock (300 DPI, sRGB).
              </p>
            </div>
          </div>

          {/* Action Footer */}
          <div className="p-6 border-t border-white/5 bg-[#0a0a0a]">
            {isProcessing ? (
              <button
                onClick={stopProcessing}
                className="w-full py-4 bg-red-500/10 text-red-500 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-red-500/20 transition-all border border-red-500/20"
              >
                <Square className="w-4 h-4 fill-current" />
                Stop Processing
              </button>
            ) : (
              <button
                onClick={startProcessing}
                disabled={files.length === 0}
                className="w-full py-4 bg-emerald-500 text-black rounded-2xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-emerald-400 transition-all shadow-xl shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
              >
                <Play className="w-4 h-4 fill-current" />
                Start Processing
              </button>
            )}
          </div>
        </div>
      </main>

      <AnimatePresence>
        {selectedPreview && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8 bg-black/95 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full h-full bg-[#0d0d0d] rounded-3xl border border-white/10 overflow-hidden shadow-2xl flex flex-col"
            >
              {/* Modal Header */}
              <div className="p-4 border-b border-white/5 flex items-center justify-between bg-black/40">
                <div className="flex items-center gap-4">
                  <div className="flex flex-col">
                    <h3 className="text-sm font-bold truncate max-w-[200px] md:max-w-md">{selectedPreview.name}</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-zinc-500 font-mono">
                        {selectedPreview.width} × {selectedPreview.height} px
                      </span>
                      <ChevronRight className="w-3 h-3 text-zinc-700" />
                      <span className="text-[10px] text-emerald-500 font-mono font-bold">
                        {(selectedPreview.width || 0) * parseInt(scale)} × {(selectedPreview.height || 0) * parseInt(scale)} px ({scale}x)
                      </span>
                    </div>
                  </div>
                  {isPreviewLoading && (
                    <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
                      <Loader2 className="w-3 h-3 text-emerald-500 animate-spin" />
                      <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-tighter">AI Rendering Preview...</span>
                    </div>
                  )}
                </div>
                <div className="absolute top-4 right-4 z-10">
                  <button 
                    onClick={() => setSelectedPreview(null)}
                    className="p-2 bg-black/50 hover:bg-black/80 rounded-full transition-colors"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
              </div>

              {/* Comparison Viewer */}
              <div className="flex-1 relative overflow-hidden bg-[#050505]">
                <ComparisonViewer 
                  originalUrl={selectedPreview.previewUrl || ''} 
                  upscaledUrl={upscaledPreviewUrl || selectedPreview.previewUrl || ''}
                  isLoading={isPreviewLoading}
                />
              </div>

              {/* Modal Footer / Controls */}
              <div className="p-4 border-t border-white/5 bg-black/40 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/5 flex items-center gap-2">
                    <Info className="w-3.5 h-3.5 text-zinc-500" />
                    <span className="text-[10px] text-zinc-400">Drag the slider to compare. Use mouse wheel to zoom.</span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                   <div className="flex items-center gap-1 p-1 bg-white/5 rounded-xl border border-white/5">
                      <div className="flex flex-col items-center px-3">
                        <span className="text-[9px] uppercase font-bold text-zinc-500">Sharpen</span>
                        <span className="text-xs font-mono text-emerald-500">{sharpenStrength}</span>
                      </div>
                      <div className="w-px h-6 bg-white/10" />
                      <div className="flex flex-col items-center px-3">
                        <span className="text-[9px] uppercase font-bold text-zinc-500">Denoise</span>
                        <span className="text-xs font-mono text-emerald-500">{denoiseStrength}</span>
                      </div>
                   </div>
                   <button 
                    onClick={() => setSelectedPreview(null)}
                    className="px-6 py-2 bg-white text-black rounded-xl font-bold text-sm hover:bg-zinc-200 transition-all"
                  >
                    Done
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}} />
    </div>
  );
}
