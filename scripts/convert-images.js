#!/usr/bin/env node

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const imageDir = path.join(__dirname, '../images');
const outputDir = path.join(__dirname, '../public/images');

// Create output directory if it doesn't exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Function to convert image to WebP
async function convertToWebP(inputPath, outputPath) {
  try {
    await sharp(inputPath)
      .resize({ width: 1920, height: 1080, fit: 'inside', withoutEnlargement: true })
      .webp({ 
        quality: 80, // Slightly lower quality for better compression
        effort: 6,    // Higher effort for better compression
        smartSubsample: true
      })
      .toFile(outputPath);
    
    console.log(`✅ Converted: ${path.basename(inputPath)} -> ${path.basename(outputPath)}`);
  } catch (error) {
    console.error(`❌ Error converting ${inputPath}:`, error.message);
  }
}

// Function to get all image files recursively
function getImageFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      // Create corresponding directory in output
      const relativeDir = path.relative(imageDir, filePath);
      const outputSubDir = path.join(outputDir, relativeDir);
      if (!fs.existsSync(outputSubDir)) {
        fs.mkdirSync(outputSubDir, { recursive: true });
      }
      getImageFiles(filePath, fileList);
    } else if (/\.(jpg|jpeg|png)$/i.test(file)) {
      fileList.push(filePath);
    }
  });
  
  return fileList;
}

// Main conversion function
async function convertAllImages() {
  console.log('🚀 Starting image conversion to WebP...');
  
  const imageFiles = getImageFiles(imageDir);
  console.log(`📁 Found ${imageFiles.length} images to convert`);
  
  for (const inputPath of imageFiles) {
    const relativePath = path.relative(imageDir, inputPath);
    const outputPath = path.join(outputDir, relativePath).replace(/\.(jpg|jpeg|png)$/i, '.webp');
    
    // Ensure output directory exists
    const outputDirPath = path.dirname(outputPath);
    if (!fs.existsSync(outputDirPath)) {
      fs.mkdirSync(outputDirPath, { recursive: true });
    }
    
    await convertToWebP(inputPath, outputPath);
  }
  
  console.log('✅ Image conversion completed!');
  console.log('📝 Next steps:');
  console.log('   1. Update components to use Next.js Image component');
  console.log('   2. Update image paths from /images/* to /images/*.webp');
  console.log('   3. Test the website to ensure all images load correctly');
}

// Run the conversion
convertAllImages().catch(console.error);