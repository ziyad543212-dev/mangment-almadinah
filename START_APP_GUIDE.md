# Run the application locally (Windows)

The local application consists of PostgreSQL, the Express API, the React/Vite
frontend, and a PaddleOCR service started automatically by the backend once
installed. Passport scans go through
the authenticated Express route; the standalone FastAPI/EasyOCR app is not used
by the frontend.

## 1. Prerequisites

- Node.js 20 or newer
- PostgreSQL 14 or newer
- 64-bit Python 3.11 for the local PaddleOCR service

Create a local database once:

```powershell
psql -U postgres -h localhost -c "CREATE DATABASE mangment_almadinah;"
```

## 2. Configure local environment

Copy `backend/.env.example` to the ignored `backend/.env.local` and set your
own values:

```dotenv
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://postgres:your-local-password@localhost:5432/mangment_almadinah
JWT_SECRET=replace-with-a-random-secret-at-least-32-characters
ALLOWED_ORIGINS=http://localhost:4173,http://localhost:5173,http://localhost:3000
INITIAL_ADMIN_USERNAME=admin
INITIAL_ADMIN_PASSWORD=replace-with-a-unique-password-at-least-12-characters
UPLOAD_DIR=C:\path\to\project-data\uploads
```

Use the Neon dashboard's connection URL in `.env.local` if desired; keep its
TLS options. `.env.local` is loaded before `.env`. Never commit these files or
share real credentials. The initial administrator is created only when the
database has no users and is never reset on restart.

Neon connections use the official PostgreSQL driver over secure WebSockets
(port 443) by default. This also supports transactions and migrations when
direct database TCP connections are blocked. Local PostgreSQL uses TCP as
usual. Set `PG_TRANSPORT=tcp` only to explicitly select TCP for Neon.

For local browser origins (`localhost`), the frontend uses
`http://localhost:3001/api` directly. `VITE_API_URL` cannot override the local
API target, so stale build-time URLs do not redirect local requests.

## 3. Install dependencies

```powershell
Set-Location 'C:\Users\<your-user>\Desktop\mang\backend'
npm install
```

```powershell
Set-Location 'C:\Users\<your-user>\Desktop\mang\frontend'
npm install
```

## 4. Start local PaddleOCR

The backend starts the installed Python OCR service automatically. To start it
manually for troubleshooting, run:

```powershell
Set-Location 'C:\Users\DELL\Desktop\mang\backend\src\ocr-service'
.\start-ocr.ps1
```

The script prefers the installed portable Python runtime, loads the existing
models, and listens on `127.0.0.1:8765`. Keep this window open. Run
`.\install-ocr.ps1` only if the existing virtual environment or pinned
dependencies need installation.

## 5. Start the local application

Double-click `start-app.bat`, or run it from PowerShell:

```powershell
Set-Location 'C:\Users\DELL\Desktop\mang'
.\start-app.bat
```

The launcher waits for the database and API to be ready before opening
`http://localhost:5173`. It reuses running servers and displays a failure if a
required server cannot start. Keep its server windows open during use.
`start-app-simple.bat` uses the same launcher.

For manual startup, open a PowerShell window:
```powershell
Set-Location 'C:\Users\<your-user>\Desktop\mang\backend'
npm start
```

In another PowerShell window:
```powershell
Set-Location 'C:\Users\<your-user>\Desktop\mang\frontend'
npm start
```

The frontend `npm start` rebuilds the current sources before starting Vite
Preview at `http://localhost:4173`. The backend listens on port `3001`; verify
it at `http://localhost:3001/api/health`. For fast frontend development with
hot reload, use `npm run dev` instead; it serves port `5173`.

## Troubleshooting

### Choose local or cloud passport reading

The passport panel defaults to **محلي** (local), which does not call Gemini.
Choose **سحابي (Gemini)** before uploading to send the selected passport page
to Google for full-field extraction. Re-read the selected file after switching
modes. Cloud mode needs Internet access and the server-side Gemini settings
documented in [the OCR guide](./backend/src/ocr-service/README.md#local-or-cloud-passport-ocr).
Its API usage may be billed. The UI reports unavailable configuration and live
quota/credential errors without automatically switching engines.

### Local startup issues

- **PostgreSQL connection errors:** check the PostgreSQL service, database name,
  username/password, and `DATABASE_URL`. Local PostgreSQL normally does not
  require TLS.
- **Login or 401/403 errors:** verify that the configured administrator exists
  and that the frontend points at the same backend. Tokens expire after 24
  hours. Passwords must be at least 12 characters.
- **Passport OCR falls back:** start `.\start-ocr.ps1` in
  `backend\src\ocr-service` and verify `http://127.0.0.1:8765/health`.
  Express retains the Tesseract/MRZ fallback if the service is unavailable.
- **Windows blocks PaddleOCR:** if startup reports
  `PADDLE_OCR_BLOCKED_BY_POLICY` or "An Application Control policy has blocked
  this file", have the device administrator review the installed Paddle
  library under the device's application policy. The app reports this reason
  and uses local Tesseract with orientation checks, separate Arabic columns,
  and name-region retries. A scan containing only ancillary fields (such as
  expiry or place of issue) is reported as failed.
- **Port already in use:** check ports 3001, 4173, 5173, and 8765, then change the
  corresponding configuration if required.

For Render/Vercel setup and production restore safeguards, see
[DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md).
