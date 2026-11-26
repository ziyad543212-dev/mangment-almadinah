const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../backend/node_modules/sharp');
const { parseConfiguration, cloudConfiguration } = require('../electron-config');
(async () => {
  const root = path.resolve(__dirname, '..');
  const configuration = cloudConfiguration(parseConfiguration(fs.readFileSync(path.join(root, 'backend', '.env'))));
  const output = path.join(root, 'dist');
  fs.mkdirSync(output, { recursive: true });
  // This private companion stays outside the EXE and is encrypted on import.
  fs.writeFileSync(path.join(output, '.env'), Object.entries(configuration).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 });
  const directory = path.resolve(__dirname, '..', 'assets');
  fs.mkdirSync(directory, { recursive: true });
  const png = await sharp(path.resolve(__dirname, '..', 'mobile/assets/icon.png')).resize(256, 256).png().toBuffer();
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
  fs.writeFileSync(path.join(directory, 'desktop-icon.ico'), Buffer.concat([header, png]));
  fs.writeFileSync(path.join(directory, 'desktop-icon.png'), png);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
