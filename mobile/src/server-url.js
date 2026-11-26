function normalizeAppUrl(value) {
  const input = String(value || '').trim().replace(/^https?:/i, (protocol) => protocol.toLowerCase());
  if (/\s/.test(input)) throw new Error('الرابط غير صالح. أدخل عنوان الخادم دون مسافات.');
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('أدخل رابط البرنامج فقط، دون كلمة مرور أو معاملات إضافية.');
  }
  const host = url.hostname.toLowerCase();
  if (!host || host === '[' || !url.origin) throw new Error('أدخل عنوان خادم صالحًا.');
  if (['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(host)) {
    throw new Error('استخدم عنوان الكمبيوتر على شبكة Wi-Fi؛ localhost يشير إلى الهاتف نفسه.');
  }
  const parts = host.split('.').map(Number);
  const privateIp = parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
    (parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
  if (url.protocol !== 'https:' && !privateIp && !host.endsWith('.local') && host !== '10.0.2.2') {
    throw new Error('استخدم HTTPS لخادم الإنترنت، أو عنوان شبكة محلية مثل http://192.168.1.10:3001.');
  }
  // React Native's URL has read-only pathname accessors. Build a normalized
  // string without depending on browser-only URL setters.
  const pathname = url.pathname.replace(/\/+$/, '').replace(/\/api$/, '') || '/';
  return (url.origin + pathname).replace(/\/$/, '');
}

function safeDownloadName(value) {
  return String(value || 'document.pdf').split(/[\\/]/).pop()
    .replace(/[^\p{L}\p{N} ._()-]/gu, '_').replace(/^\.+/, '').slice(0, 120) || 'document.pdf';
}

module.exports = { normalizeAppUrl, safeDownloadName };
