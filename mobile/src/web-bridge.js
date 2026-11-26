// Runs only in the configured first-party WebView, never on external pages.
const WEB_BRIDGE = `
(function () {
  if (window.__mangMobileBridge) return;
  window.__mangMobileBridge = true;
  var blobs = new Map();
  var originalCreate = URL.createObjectURL.bind(URL);
  var originalRevoke = URL.revokeObjectURL.bind(URL);
  var originalClick = HTMLAnchorElement.prototype.click;
  function post(value) { window.ReactNativeWebView.postMessage(JSON.stringify(value)); }
  function shareBlob(blob, name) {
    if (!blob || blob.size > 25 * 1024 * 1024) { post({ type: 'error', message: 'الملف أكبر من حد المشاركة داخل التطبيق (25 ميغابايت).' }); return; }
    var reader = new FileReader();
    reader.onload = function () { post({ type: 'download', name: name || 'document.pdf', mimeType: blob.type.split(';')[0] || 'application/octet-stream', data: reader.result }); };
    reader.onerror = function () { post({ type: 'error', message: 'تعذر تجهيز الملف للمشاركة.' }); };
    reader.readAsDataURL(blob);
  }
  URL.createObjectURL = function (blob) { var url = originalCreate(blob); blobs.set(url, blob); return url; };
  URL.revokeObjectURL = function (url) { blobs.delete(url); originalRevoke(url); };
  HTMLAnchorElement.prototype.click = function () {
    var blob = blobs.get(this.href);
    if (blob && this.download) { shareBlob(blob, this.download); return; }
    originalClick.call(this);
  };
  document.addEventListener('click', function (event) {
    var anchor = event.target && event.target.closest && event.target.closest('a[download]');
    if (anchor && blobs.has(anchor.href)) { event.preventDefault(); shareBlob(blobs.get(anchor.href), anchor.download); }
  }, true);
  var originalOpen = window.open;
  window.open = function (url) {
    if (blobs.has(String(url))) { shareBlob(blobs.get(String(url)), 'document.pdf'); return null; }
    return originalOpen.apply(window, arguments);
  };
  window.print = function () { post({ type: 'print', html: '<!doctype html>' + document.documentElement.outerHTML.replace('<head>', '<head><base href="' + location.origin + '/">') }); };
  var cameraInputs = new Map(), cameraId = 0, cameraGranted = false;
  document.addEventListener('click', function (event) {
    var target = event.target;
    if (target && target.tagName === 'INPUT' && target.type === 'file' && target.hasAttribute('capture') && !cameraGranted) {
      event.preventDefault(); event.stopImmediatePropagation();
      var id = String(++cameraId); cameraInputs.set(id, target); post({ type: 'camera', id: id });
    }
  }, true);
  window.__mangCameraResult = function (id, granted) {
    var input = cameraInputs.get(id); cameraInputs.delete(id);
    if (granted && input) { cameraGranted = true; input.click(); }
  };
})(); true;
`;
module.exports = { WEB_BRIDGE };
