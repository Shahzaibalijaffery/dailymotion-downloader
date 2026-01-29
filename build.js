const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

// Configuration
const config = {
  minify: true,
  obfuscate: false, // Set to true for code obfuscation (makes debugging harder)
  sourceMaps: true,
  outputDir: 'dist'
};

// Files to minify - maintain directory structure in dist/
const jsFiles = [
  { src: 'background/background.js', dest: 'background/background.js' },
  { src: 'content/content.js', dest: 'content/content.js' },
  { src: 'popup/popup.js', dest: 'popup/popup.js' },
  { src: 'background/offscreen.js', dest: 'background/offscreen.js' }
];

// Files to copy as-is - maintain directory structure in dist/
const copyFiles = [
  { src: 'manifest.json', dest: 'manifest.json' },
  { src: 'popup/popup.html', dest: 'popup/popup.html' },
  { src: 'popup/popup.css', dest: 'popup/popup.css' },
  { src: 'background/offscreen.html', dest: 'background/offscreen.html' },
  { src: 'icons/icon16.png', dest: 'icons/icon16.png' },
  { src: 'icons/icon48.png', dest: 'icons/icon48.png' },
  { src: 'icons/icon128.png', dest: 'icons/icon128.png' }
];

async function minifyFile(inputPath, outputPath) {
  try {
    const code = fs.readFileSync(inputPath, 'utf8');
    
    const options = {
      compress: {
        drop_console: false, // Keep console.log for debugging
        drop_debugger: true,
        pure_funcs: ['console.debug', 'console.trace'], // Remove debug/trace logs
        passes: 2 // Multiple passes for better compression
      },
      mangle: config.obfuscate ? {
        toplevel: false, // Don't mangle top-level names (keeps extension working)
        reserved: ['chrome', 'window', 'document', 'navigator'] // Keep these unmangled
      } : false,
      format: {
        comments: false, // Remove comments
        beautify: false
      },
      sourceMap: config.sourceMaps ? {
        filename: path.basename(outputPath),
        url: path.basename(outputPath) + '.map'
      } : false
    };

    const result = await minify(code, options);
    
    // Write minified file
    fs.writeFileSync(outputPath, result.code);
    
    // Write source map if enabled
    if (config.sourceMaps && result.map) {
      fs.writeFileSync(outputPath + '.map', result.map);
    }
    
    const originalSize = fs.statSync(inputPath).size;
    const minifiedSize = fs.statSync(outputPath).size;
    const savings = ((1 - minifiedSize / originalSize) * 100).toFixed(1);
    
    console.log(`   ✓ ${path.basename(inputPath)}: ${(originalSize / 1024).toFixed(2)}KB → ${(minifiedSize / 1024).toFixed(2)}KB (${savings}% smaller)`);
    
    return { originalSize, minifiedSize };
  } catch (error) {
    console.error(`   ✗ Error minifying ${inputPath}:`, error.message);
    // Fallback: copy original file
    fs.copyFileSync(inputPath, outputPath);
    return null;
  }
}

function copyFile(inputPath, outputPath) {
  try {
    fs.copyFileSync(inputPath, outputPath);
    console.log(`   ✓ Copied: ${path.basename(inputPath)}`);
  } catch (error) {
    console.error(`   ✗ Error copying ${inputPath}:`, error.message);
  }
}

async function build() {
  console.log('🔨 Building extension...\n');
  
  // Create output directory
  if (!fs.existsSync(config.outputDir)) {
    fs.mkdirSync(config.outputDir, { recursive: true });
  }
  
  // Clean output directory recursively
  function cleanDirectory(dir) {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          cleanDirectory(filePath);
          fs.rmdirSync(filePath);
        } else {
          fs.unlinkSync(filePath);
        }
      });
    }
  }
  cleanDirectory(config.outputDir);
  
  let totalOriginal = 0;
  let totalMinified = 0;
  
  // Minify JavaScript files
  console.log('📦 Minifying JavaScript files...');
  for (const file of jsFiles) {
    const inputPath = path.join(__dirname, file.src);
    const outputPath = path.join(__dirname, config.outputDir, file.dest);
    
    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    if (fs.existsSync(inputPath)) {
      const result = await minifyFile(inputPath, outputPath);
      if (result) {
        totalOriginal += result.originalSize;
        totalMinified += result.minifiedSize;
      }
    } else {
      console.warn(`   ⚠️  File not found: ${file.src}`);
    }
  }
  
  // Copy scripts folder (needed for popup.html and potentially content scripts)
  console.log('\n📋 Copying scripts folder...');
  const scriptsDir = path.join(__dirname, 'scripts');
  const distScriptsDir = path.join(__dirname, config.outputDir, 'scripts');
  if (fs.existsSync(scriptsDir)) {
    if (!fs.existsSync(distScriptsDir)) {
      fs.mkdirSync(distScriptsDir, { recursive: true });
    }
    const scriptFiles = fs.readdirSync(scriptsDir);
    scriptFiles.forEach(file => {
      const srcPath = path.join(scriptsDir, file);
      const destPath = path.join(distScriptsDir, file);
      const stat = fs.statSync(srcPath);
      if (stat.isFile() && file.endsWith('.js')) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`   ✓ Copied: scripts/${file}`);
      }
    });
  }
  
  // Copy content script files (needed for manifest.json content_scripts)
  console.log('\n📋 Copying content script files...');
  const contentDir = path.join(__dirname, 'content');
  const distContentDir = path.join(__dirname, config.outputDir, 'content');
  if (fs.existsSync(contentDir)) {
    if (!fs.existsSync(distContentDir)) {
      fs.mkdirSync(distContentDir, { recursive: true });
    }
    // Files needed by manifest.json content_scripts
    const contentFiles = [
      'utils.js',
      'videoExtraction.js',
      'restoreDownloads.js',
      'downloadNotifications.js',
      'pageTracking.js',
      'downloadButton.js',
      'content.js'
    ];
    contentFiles.forEach(file => {
      const srcPath = path.join(contentDir, file);
      const destPath = path.join(distContentDir, file);
      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`   ✓ Copied: content/${file}`);
      } else {
        console.warn(`   ⚠️  Warning: content/${file} not found, skipping...`);
      }
    });
  }
  
  // Copy background script files (needed for background.js importScripts)
  console.log('\n📋 Copying background script files...');
  const backgroundDir = path.join(__dirname, 'background');
  const distBackgroundDir = path.join(__dirname, config.outputDir, 'background');
  if (fs.existsSync(backgroundDir)) {
    if (!fs.existsSync(distBackgroundDir)) {
      fs.mkdirSync(distBackgroundDir, { recursive: true });
    }
    // Files needed by background.js importScripts
    const backgroundFiles = [
      'cancelDownload.js',
      'startDownload.js',
      'downloadBlob.js',
      'downloadM3U8.js',
      'configParser.js',
      'background.js',
      'offscreen.js',
      'offscreen.html'
    ];
    backgroundFiles.forEach(file => {
      const srcPath = path.join(backgroundDir, file);
      const destPath = path.join(distBackgroundDir, file);
      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`   ✓ Copied: background/${file}`);
      } else {
        console.warn(`   ⚠️  Warning: background/${file} not found, skipping...`);
      }
    });
  }
  
  // Copy other files
  console.log('\n📋 Copying other files...');
  for (const file of copyFiles) {
    const inputPath = path.join(__dirname, file.src);
    const outputPath = path.join(__dirname, config.outputDir, file.dest);
    
    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    if (fs.existsSync(inputPath)) {
      copyFile(inputPath, outputPath);
    } else {
      console.warn(`   ⚠️  File not found: ${file.src}`);
    }
  }
  
  // Summary
  console.log('\n✅ Build complete!');
  if (totalOriginal > 0) {
    const totalSavings = ((1 - totalMinified / totalOriginal) * 100).toFixed(1);
    console.log(`📊 Total size reduction: ${(totalOriginal / 1024).toFixed(2)}KB → ${(totalMinified / 1024).toFixed(2)}KB (${totalSavings}% smaller)`);
  }
  console.log(`📁 Output directory: ${config.outputDir}/\n`);
}

// Run build
build().catch(error => {
  console.error('❌ Build failed:', error);
  process.exit(1);
});
