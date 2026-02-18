const fs = require("fs");
const path = require("path");
const archiver = require("archiver");

// Files to include in the bundle (maintain directory structure)
const filesToInclude = [
  "manifest.json",
  "background/background.js",
  "background/cancelDownload.js",
  "background/startDownload.js",
  "background/downloadBlob.js",
  "background/downloadM3U8.js",
  "background/configParser.js",
  "background/offscreen.html",
  "background/offscreen.js",
  "ffmpeg-helper-umd.cjs",
  "content/utils.js",
  "content/videoExtraction.js",
  "content/restoreDownloads.js",
  "content/downloadNotifications.js",
  "content/pageTracking.js",
  "content/downloadButton.js",
  "content/content.js",
  "popup/popup.html",
  "popup/popup.js",
  "popup/popup.css",
  "scripts/utils.js",
  "scripts/storage.js",
  "scripts/messaging.js",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
  "assets/feed-download-icon.png",
];

function createBundle() {
  const outputPath = path.join(__dirname, "dist", "dailymotion-downloader.zip");
  const output = fs.createWriteStream(outputPath);
  const archive = archiver("zip", {
    zlib: { level: 9 }, // Maximum compression
  });

  output.on("close", () => {
    const sizeInMB = (archive.pointer() / 1024 / 1024).toFixed(2);
    console.log(`✅ Bundle created successfully!`);
    console.log(`📦 File: ${path.basename(outputPath)}`);
    console.log(`📊 Size: ${sizeInMB} MB`);
    console.log(`📝 Total files: ${archive.pointer()} bytes\n`);
  });

  archive.on("error", (err) => {
    throw err;
  });

  archive.pipe(output);

  // Add files from dist directory (maintain directory structure)
  console.log("📦 Creating bundle from dist/ directory...");
  filesToInclude.forEach((file) => {
    const filePath = path.join(__dirname, "dist", file);
    if (fs.existsSync(filePath)) {
      // Preserve directory structure in zip
      archive.file(filePath, { name: file });
      console.log(`   ✓ Added: ${file}`);
    } else {
      console.warn(`   ⚠️  Warning: ${file} not found in dist/, skipping...`);
    }
  });

  // Add source maps if they exist (maintain directory structure)
  const sourceMapFiles = filesToInclude.filter((f) => f.endsWith(".js"));
  sourceMapFiles.forEach((file) => {
    const mapPath = path.join(__dirname, "dist", file + ".map");
    if (fs.existsSync(mapPath)) {
      archive.file(mapPath, { name: file + ".map" });
      console.log(`   ✓ Added: ${file}.map`);
    }
  });

  archive.finalize();
}

// Check if dist directory exists
if (!fs.existsSync(path.join(__dirname, "dist"))) {
  console.error(
    '❌ Error: dist/ directory not found. Run "npm run build" first.',
  );
  process.exit(1);
}

console.log("🚀 Starting extension bundling...\n");
createBundle();
