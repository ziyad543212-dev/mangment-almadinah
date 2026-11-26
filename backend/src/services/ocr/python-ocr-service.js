const DEFAULT_SERVICE_URL = 'http://127.0.0.1:8765/ocr';
const DEFAULT_TIMEOUT_MS = 90_000;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function getServiceUrl() {
  const serviceUrl = new URL(process.env.LOCAL_PADDLE_OCR_URL || DEFAULT_SERVICE_URL);
  if (serviceUrl.protocol !== 'http:' || !LOOPBACK_HOSTS.has(serviceUrl.hostname)) {
    throw new Error('Local OCR service URL must use HTTP on loopback only');
  }
  return serviceUrl;
}

function appendImage(form, field, imageBuffer, filename) {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) return;
  form.append(field, new Blob([imageBuffer], { type: 'image/jpeg' }), filename);
}

async function recognizePassport({ imageBuffer, cropBuffer, timeoutMs = DEFAULT_TIMEOUT_MS, signal }) {
  if (!Buffer.isBuffer(imageBuffer) && !Buffer.isBuffer(cropBuffer)) {
    throw new TypeError('Local PaddleOCR requires an image or an enhanced crop');
  }
  if (typeof fetch !== 'function' || typeof FormData !== 'function' ||
      typeof Blob !== 'function') {
    throw new Error('The local PaddleOCR client requires Node.js fetch, FormData, and Blob');
  }

  const form = new FormData();
  appendImage(form, 'image', imageBuffer, 'passport.jpg');
  appendImage(form, 'crop', cropBuffer, 'passport-name-region.jpg');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });

  try {
    const response = await fetch(getServiceUrl(), {
      method: 'POST',
      body: form,
      redirect: 'error',
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Local PaddleOCR service returned HTTP ${response.status}`);
    }

    const result = await response.json();
    if (!result || (!Array.isArray(result.lines) && !Array.isArray(result.crop_lines))) {
      throw new Error('Local PaddleOCR service returned an invalid response');
    }
    return {
      lines: Array.isArray(result.lines) ? result.lines : [],
      crop_lines: Array.isArray(result.crop_lines) ? result.crop_lines : [],
      diagnostics: result.diagnostics || null,
      processedImage: typeof result.processed_image === 'string' && result.processed_image.length <= 24 * 1024 * 1024
        ? Buffer.from(result.processed_image, 'base64') : null
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Local PaddleOCR service timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

module.exports = { recognizePassport };
