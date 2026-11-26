# Al Madinah Hajj & Umrah Management System

Arabic-first management software for Hajj and Umrah operations: trips,
pilgrim/passport records, payment tracking, manifests, summaries, and passport
OCR. The web client uses React, TypeScript, and Vite; the API uses Express and
PostgreSQL. An Electron shell is available for Windows.

## Project layout

- `frontend/` — Vite/React application
- `backend/` — Express API, PostgreSQL migrations, tests, and OCR integration
- `backend/src/ocr-service/` — optional loopback PaddleOCR service for Windows
- `electron.js` — desktop shell and backend process launcher

## Local development

1. Install Node.js 18+, PostgreSQL 14+, and configure `backend/.env.local` from
   [backend/.env.example](./backend/.env.example). Set `DATABASE_URL`, a random
   `JWT_SECRET`, and an initial administrator password of at least 12
   characters. Never commit secrets.
2. Start the API and frontend in separate PowerShell terminals:

   ```powershell
   Set-Location backend
   npm install
   npm run migrate
   npm run dev
   ```

   ```powershell
   Set-Location frontend
   npm install
   npm run dev
   ```

3. Optionally install and start local OCR using
   [backend/src/ocr-service/README.md](./backend/src/ocr-service/README.md).

See [START_APP_GUIDE.md](./START_APP_GUIDE.md) for Windows setup and
[DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) for Render, Vercel, data persistence,
and backup/restore procedures.

The Windows desktop app stores its connection settings and uploads under
`%APPDATA%\AlMadinahSystem`. The packaged app encrypts its database URL and JWT
secret with Electron `safeStorage`; encrypted settings are tied to the current
Windows profile and must be configured again on another computer.
The current desktop build imports the Neon connection from `backend/.env`
through a private companion configuration file; see
[DESKTOP_APP_GUIDE.md](./DESKTOP_APP_GUIDE.md) for installation and existing-account login.

## Passport OCR

`POST /api/ocr/passport` (admin only) accepts one image (JPEG/PNG/WebP/TIFF,
≤15 MB, verified by file signature) and returns:

- `data` — extracted fields (names AR/EN, passport number, dates,
  nationality, gender, place of birth/issue, issuing authority).
- `review_fields` — fields requiring manual review.
- `ocr_contract` — per-field `{ value, confidence, source, validated,
  alternatives }`, structured `warnings`, `conflicts`, `status`, and
  `requiresHumanReview`. MRZ-derived fields are `validated` only when ICAO
  9303 check digits pass; conflicts between visual OCR and MRZ are reported
  with both alternatives instead of being silently resolved.
- `GET /api/ocr/health` — engine availability (PaddleOCR service, Tesseract
  workers).

Safeguards: rate limit (12 req/min/user, `OCR_RATE_LIMIT_PER_MINUTE`),
concurrency cap (`OCR_MAX_CONCURRENT`, default 2), image-quality warnings
(blur/resolution heuristics), loopback-only PaddleOCR client, and no
passport images or MRZ text in logs.

### OCR benchmark

```powershell
Set-Location backend
node scripts/ocr-benchmark.js              # built-in synthetic fixtures
node scripts/ocr-benchmark.js --dir <path> # custom JSON fixtures
```

Measures exact-match rate, precision/recall, character error rate, conflict
detection, and latency per fixture. Fixtures are synthetic line-level data —
real-passport accuracy is **not** established. To measure real accuracy,
add consented fixtures (stored outside git) in the documented JSON format.

## Duplicate passports

`pilgrims.passport_number` is no longer globally unique (migration v4):
the same person may be registered on multiple trips. `POST`/`PUT
/api/pilgrims` returns `409` with matching records unless
`confirm_duplicate: true` is sent; `GET /api/pilgrims/lookup-passport?number=`
lists existing registrations for review.

## Checks

```powershell
Set-Location backend
npm test
node scripts/ocr-benchmark.js
Set-Location ..\frontend
npm run build
npm run lint
```

OCR tests use mocked engines and synthetic fixtures. Real passport
recognition accuracy has not been established by the automated test suite.
