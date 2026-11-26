'use strict';
// Tesseract.js 7's relaxed-SIMD build omits the float dot product required by
// tessdata_best. Use its regular SIMD build for these workers only. Keep the
// default fast core for integer models. Remove after upstream #1080 is fixed:
// https://github.com/naptha/tesseract.js/issues/1080
const path = require('node:path');
const originalWorker = require.resolve('tesseract.js/src/worker-script/node/index.js');
const detectPath = require.resolve('wasm-feature-detect', { paths: [path.dirname(originalWorker)] });
const detect = require(detectPath);
require.cache[detectPath].exports = { ...detect, relaxedSimd: async () => false };
require(originalWorker);
