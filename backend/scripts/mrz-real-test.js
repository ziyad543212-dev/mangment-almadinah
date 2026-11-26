// Real end-to-end MRZ check: renders MRZ text into an image, runs the REAL
// Tesseract MRZ worker path (same crop params as routes/ocr.js runMrzRead),
// then parses with the real passport-extraction module.
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createWorker, OEM, PSM } = require('tesseract.js');
const extraction = require('../src/services/ocr/passport-extraction');

const weights = [7, 3, 1];
const vals = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const cd = (v) => String([...v].reduce((s, c, i) => s + (c === '<' ? 0 : vals.indexOf(c)) * weights[i % 3], 0) % 10);
const doc = 'N12345678';
const dob = '900102';
const exp = '300506';
const line1 = 'P<SYRDOE<AL<HASSAN<<JOHN<PAUL'.padEnd(44, '<');
const prefix = doc + cd(doc) + 'SYR' + dob + cd(dob) + 'M' + exp + cd(exp) + '<'.repeat(14) + '<';
const composite = prefix.slice(0, 10) + prefix.slice(13, 20) + prefix.slice(21, 43);
const line2 = prefix + cd(composite);
console.log('MRZ line1:', line1);
console.log('MRZ line2:', line2);

async function main() {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
    <rect width="1200" height="800" fill="#f5f0e6"/>
    <text x="40" y="730" font-family="monospace" font-size="36" fill="#111">${esc(line1)}</text>
    <text x="40" y="780" font-family="monospace" font-size="36" fill="#111">${esc(line2)}</text>
  </svg>`;
  const image = await sharp(Buffer.from(svg)).png().toBuffer();
  const meta = await sharp(image).metadata();
  console.log('image:', meta.width, 'x', meta.height, meta.format);

  const cacheDir = path.join(os.tmpdir(), 'tesseract-cache');
  const worker = await createWorker('eng', OEM.LSTM_ONLY, { cachePath: cacheDir });
  await worker.setParameters({
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK
  });

  for (const topRatio of [0.5, 0.525]) {
    const top = Math.floor(meta.height * topRatio);
    const crop = await sharp(image)
      .extract({ left: 0, top, width: meta.width, height: meta.height - top })
      .resize({ width: 2800, withoutEnlargement: false })
      .grayscale()
      .normalize()
      .sharpen({ sigma: 1.4 })
      .png()
      .toBuffer();
    const raw = await worker.recognize(crop);
    console.log(`--- ROI top=${topRatio} raw text ---`);
    console.log(JSON.stringify(raw.data.text));
    const lines = extraction.sanitizeMrzLines(raw.data.text);
    console.log('sanitized:', JSON.stringify(lines));
    if (lines.length === 2) {
      console.log('diagnostics:', JSON.stringify(extraction.mrzDiagnostics(lines)));
      console.log('parsed:', JSON.stringify(extraction.parseMrz(lines)));
    }
  }
  await worker.terminate();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
