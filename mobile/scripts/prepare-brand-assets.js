const fs = require('node:fs/promises');
const path = require('node:path');
const { generateImageAsync, generateImageBackgroundAsync, compositeImagesAsync } = require('@expo/image-utils');

// Prepare launcher sizes from the existing company mark, retaining its proportions.
async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const source = path.join(projectRoot, 'assets', 'Logo.png');
  await fs.mkdir(path.dirname(source), { recursive: true });
  await fs.copyFile(path.resolve(projectRoot, '..', 'Logo.png'), source);
  for (const [name, size, backgroundColor] of [
    ['icon.png', 780, '#1a1a2e'], ['adaptive-icon.png', 600, 'transparent']
  ]) {
    const mark = await generateImageAsync({ projectRoot, cacheType: 'almadinah-brand-' + size }, {
      src: source, width: size, height: size, resizeMode: 'contain', backgroundColor: 'transparent'
    });
    const background = await generateImageBackgroundAsync({ width: 1024, height: 1024, backgroundColor, resizeMode: 'contain' });
    const output = await compositeImagesAsync({ foreground: mark.source, background, x: (1024-size)/2, y: (1024-size)/2 });
    await fs.writeFile(path.join(projectRoot, 'assets', name), output);
    console.log('Prepared ' + name);
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
