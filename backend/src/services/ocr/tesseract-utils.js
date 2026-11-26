const queues = new WeakMap();

// Tesseract workers have mutable image/parameter state and cannot serve two
// passport requests simultaneously. Each language has its own serial queue.
function recognizeSerialized(worker, image, options = {}, output = { text: true, blocks: true }) {
  const previous = queues.get(worker) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => worker.recognize(image, options, output));
  queues.set(worker, current.catch(() => {}));
  return current;
}

function normalizeTesseractLines(result, imageWidth, imageHeight, passId) {
  const data = result?.data || {};
  const lines = Array.isArray(data.lines) ? data.lines : (data.blocks || [])
    .flatMap((block) => block.paragraphs || [])
    .flatMap((paragraph) => paragraph.lines || []);
  return lines.map((line) => {
    const box = line.bbox || {};
    return {
      text: line.text || '',
      confidence: Number.isFinite(line.confidence) ? Math.max(0, Math.min(1, line.confidence / 100)) : null,
      pageNumber: 1,
      passId,
      bounds: [box.x0, box.y0, box.x1, box.y1].every(Number.isFinite)
        ? { left: box.x0 / imageWidth, top: box.y0 / imageHeight,
          width: (box.x1 - box.x0) / imageWidth, height: (box.y1 - box.y0) / imageHeight }
        : null
    };
  });
}

module.exports = { normalizeTesseractLines, recognizeSerialized };
