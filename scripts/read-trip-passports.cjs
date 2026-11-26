const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const base = 'http://10.198.77.173:3001/api';
const folder = 'C:/Users/DELL/Desktop/رحلة ٢١ ١١';
const files = fs.readdirSync(folder).filter(name => name.toLowerCase().endsWith('.jpg')).sort();
const env = dotenv.parse(fs.readFileSync('backend/.env'));

(async () => {
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ username: env.INITIAL_ADMIN_USERNAME || 'admin', password: env.INITIAL_ADMIN_PASSWORD }) });
  const loginBody = await login.json();
  if (!login.ok) throw new Error(loginBody.error || 'login failed');
  const result = [];
  for (const name of files) {
    const form = new FormData();
    form.append('passport', new Blob([fs.readFileSync(path.join(folder, name))], { type: 'image/jpeg' }), name);
    const response = await fetch(`${base}/ocr/passport`, { method: 'POST', headers: { Authorization: `Bearer ${loginBody.token}` }, body: form });
    const body = await response.json();
    result.push({ file: name, ok: response.ok, data: body.data, review_fields: body.review_fields, warnings: body.warnings, error: body.error });
    console.error(`${name}: ${response.ok ? 'ok' : body.error || response.status}`);
  }
  fs.writeFileSync('mobile/artifacts/qa/trip-passports-ocr.json', JSON.stringify(result, null, 2));
})();
