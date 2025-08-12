import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const sizes = [
  { name: 'favicon-16x16.png', size: 16 },
  { name: 'favicon-32x32.png', size: 32 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'android-chrome-192x192.png', size: 192 },
  { name: 'android-chrome-512x512.png', size: 512 }
];

async function generateIcons() {
  console.log('🎨 Gerando ícones...');
  
  const svgPath = path.join(process.cwd(), 'public', 'favicon.svg');
  const svgBuffer = fs.readFileSync(svgPath);
  
  for (const { name, size } of sizes) {
    const outputPath = path.join(process.cwd(), 'public', name);
    
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(outputPath);
    
    console.log(`✅ Gerado: ${name} (${size}x${size})`);
  }
  
  console.log('🎉 Todos os ícones foram gerados!');
}

generateIcons().catch(console.error);
