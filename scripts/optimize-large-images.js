#!/usr/bin/env node

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Images to optimize with their target dimensions
const imagesToOptimize = [
  {
    name: 'rituali1.webp',
    maxWidth: 1920,
    maxHeight: 1440,
    quality: 80
  },
  {
    name: 'massaggi1.webp',
    maxWidth: 1920,
    maxHeight: 1440,
    quality: 80
  },
  {
    name: 'demo_2.webp',
    maxWidth: 1920,
    maxHeight: 1440,
    quality: 80
  },
  {
    name: 'Gioia-08592.webp',
    maxWidth: 1920,
    maxHeight: 1440,
    quality: 80
  },
  {
    name: 'reception1.webp',
    maxWidth: 1920,
    maxHeight: 1440,
    quality: 80
  },
  {
    name: 'pressoterapia1.webp',
    maxWidth: 1920,
    maxHeight: 1440,
    quality: 80
  },
  {
    name: 'bed.webp',
    maxWidth: 1920,
    maxHeight: 1440,
    quality: 80
  }
];

// Function to get file size in MB
function getFileSizeMB(filePath) {
  const stats = fs.statSync(filePath);
  return (stats.size / (1024 * 1024)).toFixed(2);
}

// Function to optimize a single image
async function optimizeImage(imageConfig) {
  const inputPath = path.join(__dirname, '../public/images', imageConfig.name);
  const outputPath = path.join(__dirname, '../public/images', `optimized_${imageConfig.name}`);
  
  if (!fs.existsSync(inputPath)) {
    console.log(`❌ Image not found: ${imageConfig.name}`);
    return;
  }

  const originalSize = getFileSizeMB(inputPath);
  
  try {
    // Get original dimensions
    const metadata = await sharp(inputPath).metadata();
    console.log(`📷 ${imageConfig.name}: ${metadata.width}x${metadata.height} (${originalSize}MB)`);
    
    await sharp(inputPath)
      .resize({
        width: imageConfig.maxWidth,
        height: imageConfig.maxHeight,
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({
        quality: imageConfig.quality,
        effort: 6, // Higher effort for better compression
        smartSubsample: true,
        lossless: false
      })
      .toFile(outputPath);
    
    const optimizedSize = getFileSizeMB(outputPath);
    const reduction = ((originalSize - optimizedSize) / originalSize * 100).toFixed(1);
    
    console.log(`✅ Optimized ${imageConfig.name}: ${originalSize}MB → ${optimizedSize}MB (${reduction}% reduction)`);
    
    return {
      name: imageConfig.name,
      originalSize: parseFloat(originalSize),
      optimizedSize: parseFloat(optimizedSize),
      reduction: parseFloat(reduction)
    };
    
  } catch (error) {
    console.error(`❌ Error optimizing ${imageConfig.name}:`, error.message);
    return null;
  }
}

// Function to replace original with optimized version
async function replaceWithOptimized(imageName) {
  const originalPath = path.join(__dirname, '../public/images', imageName);
  const optimizedPath = path.join(__dirname, '../public/images', `optimized_${imageName}`);
  const backupPath = path.join(__dirname, '../public/images', `backup_${imageName}`);
  
  if (fs.existsSync(optimizedPath)) {
    // Create backup
    fs.copyFileSync(originalPath, backupPath);
    // Replace original with optimized
    fs.copyFileSync(optimizedPath, originalPath);
    // Remove optimized temp file
    fs.unlinkSync(optimizedPath);
    console.log(`🔄 Replaced ${imageName} with optimized version (backup created)`);
  }
}

// Main optimization function
async function optimizeAllImages() {
  console.log('🚀 Starting image optimization...\n');
  
  let totalOriginalSize = 0;
  let totalOptimizedSize = 0;
  const results = [];
  
  // Optimize each image
  for (const imageConfig of imagesToOptimize) {
    const result = await optimizeImage(imageConfig);
    if (result) {
      results.push(result);
      totalOriginalSize += result.originalSize;
      totalOptimizedSize += result.optimizedSize;
    }
    console.log(''); // Empty line for readability
  }
  
  // Show summary
  console.log('📊 OPTIMIZATION SUMMARY:');
  console.log('========================');
  results.forEach(result => {
    console.log(`${result.name}: ${result.originalSize}MB → ${result.optimizedSize}MB (-${result.reduction}%)`);
  });
  
  const totalReduction = ((totalOriginalSize - totalOptimizedSize) / totalOriginalSize * 100).toFixed(1);
  console.log(`\nTotal: ${totalOriginalSize.toFixed(2)}MB → ${totalOptimizedSize.toFixed(2)}MB (-${totalReduction}%)\n`);
  
  // Ask for confirmation to replace
  console.log('🤔 Do you want to replace the original images with optimized versions?');
  console.log('   Run with --replace flag to automatically replace');
  console.log('   Example: node scripts/optimize-large-images.js --replace');
  
  if (process.argv.includes('--replace')) {
    console.log('\n🔄 Replacing original images...');
    for (const result of results) {
      await replaceWithOptimized(result.name);
    }
    console.log('✅ All images have been replaced with optimized versions!');
    console.log('💾 Original images backed up with "backup_" prefix');
  } else {
    console.log('\n📝 Optimized images saved with "optimized_" prefix for review');
  }
}

// Run the optimization
optimizeAllImages().catch(console.error);