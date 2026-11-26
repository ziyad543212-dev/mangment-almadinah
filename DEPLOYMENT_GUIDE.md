# Deployment: Render PostgreSQL backend and Vercel frontend

## Architecture

The application has a React/Vite frontend, an Express API, a PostgreSQL database,
and an optional Electron desktop shell. The included Render blueprint provisions
PostgreSQL and the backend. Vercel builds the frontend from the `frontend`
directory and rewrites `/api/*` to the Render service.

The backend runs PostgreSQL migrations at startup. Render's persistent disk is
used for uploaded visa documents only; passport images submitted for OCR are
processed in memory and are not retained. Keep the disk mounted at `/var/data`
to preserve uploaded documents between deployments.

## Render deployment

1. Import the repository into Render and apply the included `render.yaml`.
   It creates a PostgreSQL 16 database and a Node web service in Frankfurt.
2. Set `ALLOWED_ORIGINS` on the backend to the exact deployed frontend origin(s),
   without a trailing slash. The backend also permits the development origins
   `http://localhost:4173` and `http://localhost:5173`. Add the production
   Vercel/custom domain to Render explicitly after verifying the actual domain
   in Vercel; do not use a wildcard. This project configuration does not identify
   the deployed Vercel hostname.
   Do not add `null` on Render; that opaque origin is reserved for the Electron
   renderer and is accepted only by its loopback-bound local backend.
3. Keep the generated `JWT_SECRET` and `INITIAL_ADMIN_PASSWORD` private. The
   first startup creates `INITIAL_ADMIN_USERNAME` (default `admin`) only when
   the database has no users. Existing passwords are never reset on restart.
4. The blueprint connects `DATABASE_URL` to the managed Render database and
   stores uploaded visa files under `/var/data/uploads`. Do not remove the disk
   or change the upload path without moving existing files.
5. The backend health check is `/api/health`. Verify
   `https://<service>.onrender.com/api/health` returns `{"status":"ok"}`.

Database migrations are versioned in `schema_migrations` and run before the
server accepts requests. For an existing PostgreSQL database, take an external
backup before deploying schema changes. The first migration that converts
currency columns to `NUMERIC(12,2)` rounds existing amounts to the nearest cent.
The deployment does not migrate an old SQLite database into PostgreSQL.

## Vercel deployment

1. Import the repository and set the Vercel **Root Directory** to `frontend`.
2. Use the Vite preset, `npm run build`, and output directory `dist`.
3. Verify `frontend/vercel.json` points `/api/*` at the intended Render service.
4. Leave `VITE_API_URL` unset for the hosted app; requests use the same-origin
   Vercel rewrite. The rewrite selects the API host, not the frontend origin.
   Add the exact Vercel/custom frontend origin to Render's `ALLOWED_ORIGINS`.

## Database backup and restore

The authenticated administrator can download a JSON snapshot from
**Settings → Backup and restore**. The backup includes user password hashes,
personal records, payment records, and uploaded-document paths. Treat it as
sensitive data and store it encrypted with restricted access.

Restore validates the backup format and performs replacement in a PostgreSQL
transaction. It requires an administrator token, the explicit `RESTORE`
confirmation field, and (in production) `ALLOW_DATABASE_RESTORE=true`. This
setting is `false` in the Render blueprint by default; enable it only for a
planned restore, then disable it immediately afterward. Create and verify a
separate current backup before restoring. The operation replaces the
application tables and does not restore uploaded document files; ensure the
referenced files exist on the persistent disk.

## Local development (Windows)

Prerequisites: Node.js 18+, PostgreSQL 14+, and (for the primary local OCR
service) 64-bit Python 3.11.

Create a local database, then copy `backend/.env.example` to the ignored
`backend/.env.local` and set your own values:

```powershell
psql -U postgres -h localhost -c "CREATE DATABASE mangment_almadinah;"
```

Set at least:

```dotenv
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://postgres:your-local-password@localhost:5432/mangment_almadinah
JWT_SECRET=replace-with-a-random-secret-at-least-32-characters
INITIAL_ADMIN_USERNAME=admin
INITIAL_ADMIN_PASSWORD=replace-with-a-unique-password-at-least-12-characters
ALLOWED_ORIGINS=http://localhost:4173,http://localhost:5173,http://localhost:3000
UPLOAD_DIR=C:\path\to\project-data\uploads
```

Never commit `.env` files or real credentials. Install and start the backend:

```powershell
Set-Location backend
npm install
npm run migrate
npm run dev
```

In another terminal:

```powershell
Set-Location frontend
npm install
npm run dev
```

The API is available at `http://localhost:3001`; Vite normally serves the UI
at `http://localhost:5173`. On the first empty database, the configured initial
administrator is created once. If no initial password is configured in local
development, create the first administrator through `/setup`.

## Passport OCR

The integrated Express endpoint `/api/ocr/passport` is the only frontend OCR
entry point. On Windows, the primary recognition service is the local
PaddleOCR process described in
[backend/src/ocr-service/README.md](./backend/src/ocr-service/README.md).
Start it before the backend for Arabic/English visual text recognition; Express
also validates MRZ data and falls back to local Tesseract when PaddleOCR is
unavailable. The independent EasyOCR FastAPI app in `backend/main.py` is not
connected to this route and is not part of the production deployment.

The Render blueprint does not deploy the Windows PaddleOCR service. Therefore,
production OCR relies on the Express service's Tesseract/MRZ fallback unless a
separately secured and compatible OCR service is deliberately provisioned.
Automated tests mock OCR results and do not establish recognition accuracy on
real passports.

## Electron desktop build

Build from the repository root with `npm run dist`; install root, backend, and
frontend dependencies first. The packaged app includes the backend runtime
dependencies, frontend assets and Tesseract language files. It excludes environment
secrets, Python OCR environments and Paddle model weights.

The app uses `%APPDATA%\AlMadinahSystem` for configuration and uploaded files,
regardless of the installation directory. The build creates a private `dist/.env`
companion from `backend/.env`. Portable builds import it from beside the EXE;
installed builds let the administrator select this file on first launch.
The imported Neon configuration is saved to `backend.env` using Electron
`safeStorage` encryption. An existing encrypted cloud configuration can be reused.
This build requires Neon and never creates a replacement local database.
Neon URLs must include `sslmode=require`. Settings are
protected with the current Windows user profile and file ACLs. Windows
`safeStorage` uses OS-backed encryption, but encrypted settings are not
portable to a different Windows account or computer. The private companion
contains database credentials; keep it on trusted administration devices and
exclude it from public distribution. The EXE and frontend contain no database
password. See [DESKTOP_APP_GUIDE.md](./DESKTOP_APP_GUIDE.md).

After configuration, the server runs PostgreSQL migrations before listening.
When the database has no users and no initial admin password is configured,
the backend stays available so the existing `/setup` page can create the first
administrator. Existing passwords are never reset on restart.

In development, Electron imports `backend/.env` explicitly.
The packaged backend binds to loopback and stores uploaded documents under
Electron's user-data directory.

The local Python PaddleOCR service is not bundled with the desktop installer;
the Express endpoint uses its fallback OCR providers when that service is
unavailable. The desktop OCR flow has not been validated against real passport
images.
