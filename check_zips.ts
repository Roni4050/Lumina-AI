import fs from 'fs';
import path from 'path';
import unzipper from 'unzipper';

async function checkZip(filePath: string) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  console.log(`\nChecking ZIP: ${filePath}`);
  if (!fs.existsSync(absolutePath)) {
    console.log('File does not exist');
    return;
  }
  try {
    const size = fs.statSync(absolutePath).size;
    console.log(`File size on disk: ${size} bytes`);
    const directory = await unzipper.Open.file(absolutePath);
    console.log(`Files in ZIP (${directory.files.length}):`);
    for (const file of directory.files) {
      console.log(`- ${file.path} (${file.uncompressedSize} bytes)`);
    }
  } catch (err: any) {
    console.error('Error reading zip:', err.message);
  }
}

async function run() {
  const outputsDir = path.join(process.cwd(), 'outputs');
  if (fs.existsSync(outputsDir)) {
    const files = fs.readdirSync(outputsDir);
    const zips = files.filter(f => f.endsWith('.zip'));
    console.log(`Found ${zips.length} ZIP files in outputs/`);
    for (const zip of zips) {
      await checkZip(path.join('outputs', zip));
    }
  } else {
    console.log('Outputs directory not found');
  }
}

run();
