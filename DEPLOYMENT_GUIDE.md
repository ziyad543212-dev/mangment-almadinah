# Deployment: Render backend and Vercel frontend

## Architecture

This repository is a desktop application with separate `frontend` (React/Vite) and `backend` (Express) packages. Deploy the backend as a Render Web Service and the frontend as a Vercel project with its **Root Directory** set to `frontend`. The Vercel rewrite serves the React SPA and proxies `/api/*` to Render.

The backend uses SQLite and local file uploads. The Render blueprint mounts a persistent disk at `/var/data`; `DATA_DIR` points the SQLite database, uploads, and backup files into that disk. Do not remove the disk or change its mount path without migrating the existing data. The repository's PostgreSQL adapter is not used by the running server.

## Render backend

1. Create a Render **Web Service** from this repository.
2. Set **Root Directory** to `backend`, **Build Command** to `npm install`, and **Start Command** to `npm start`.
3. Attach a persistent disk mounted at `/var/data` (the supplied `render.yaml` requests a 1 GB disk).
4. Set `NODE_ENV=production`, a strong unique `JWT_SECRET`, `DATA_DIR=/var/data`, and `ALLOWED_ORIGINS` to your Vercel origin(s), comma-separated. `PORT` is supplied by Render; the server also defaults to `3001` locally.
5. Set the Render health check path to `/api/health`. The server listens on `0.0.0.0`.
6. After the first deploy, verify `https://<your-service>.onrender.com/api/health` returns `{"status":"ok"}`.

`ALLOWED_ORIGINS` should contain exact origins with no trailing slash, for example `https://your-app.vercel.app,https://www.example.com`. The backend also allows HTTPS `*.vercel.app` origins and local development origins `http://localhost:5173` and `http://localhost:3000`.

## Deploy the frontend to Vercel

1. Import this Git repository in Vercel.
2. Set **Root Directory** to `frontend` and **Framework Preset** to **Vite**.
3. Use the configured build command `npm run build` and output directory `dist`.
4. Replace `YOUR-RENDER-BACKEND-URL` in [frontend/vercel.json](./frontend/vercel.json) with the Render service hostname (without a trailing slash), then push and deploy.
5. Leave `VITE_API_URL` unset in Vercel. The frontend uses same-origin `/api` requests and Vercel rewrites them to Render.

The rewrite makes the deployed browser requests same-origin; CORS is configured as well for direct API access and local/Electron use.

## Backend environment and persistence

For the backend host, set `NODE_ENV=production` and a unique `JWT_SECRET`. The included `render.yaml` generates a secret for Render; the app now refuses to start in production if the variable is missing. Keep secrets out of source control. Local variable names are listed in [backend/.env.example](./backend/.env.example).

The active backend stores data in SQLite and writes uploaded documents to its `uploads` directory. The supplied Render blueprint puts both on the persistent disk. If creating the service manually, attach and verify the disk before accepting production data; an ephemeral filesystem does not preserve user data.

## Local development and Vercel CLI

Install dependencies once from each app directory if needed:

```powershell
Set-Location backend
npm install
Set-Location ..\frontend
npm install
```

In **Terminal 1**, start the backend with a local secret:

```powershell
Set-Location backend
$env:NODE_ENV = "development"
$env:PORT = "3001"
$env:JWT_SECRET = "replace-with-a-long-random-local-secret"
$env:DATA_DIR = (Get-Location).Path
npm start
```

In **Terminal 2**, link the Vercel project once, then run Vercel's local development server against the local backend:

```powershell
Set-Location frontend
npx vercel link
$env:API_PROXY_TARGET = "http://localhost:3001"
npx vercel dev
```

Open the local URL printed by Vercel (usually `http://localhost:3000`). The frontend's Vite proxy sends `/api` to the local backend. To test the production `/api` rewrite instead, remove `API_PROXY_TARGET` before starting `vercel dev`; requests will reach the configured Render host.

For a production CLI deployment:

```powershell
Set-Location frontend
npx vercel --prod
```

Alternatively, connect the repository to Vercel once and push to the configured Git branch; Vercel will build the `frontend` project automatically.

## Deployment checklist

- [ ] Commit and push the changes to GitHub.
- [ ] Create the Render Web Service with root `backend`, build `npm install`, start `npm start`, persistent disk mount `/var/data`, and environment variables `NODE_ENV`, `JWT_SECRET`, `DATA_DIR`, and `ALLOWED_ORIGINS`.
- [ ] Verify the Render `/api/health` endpoint.
- [ ] Replace the Vercel URL placeholder in `frontend/vercel.json` with the assigned Render hostname.
- [ ] Set Vercel's root to `frontend`, then deploy using Git integration or `npx vercel --prod`.
- [ ] Add the Vercel origin to Render's `ALLOWED_ORIGINS` if using a custom domain; redeploy the Render service after changing environment variables.

## First-user setup and smoke test

After confirming that the backend has durable storage, create the initial administrator once by sending a JSON `POST` to:

```text
https://<your-service>.onrender.com/api/auth/setup-admin
```

Example body:

```json
{
  "username": "admin",
  "password": "choose-a-strong-password"
}
```

Verify the Vercel site loads directly on a nested route (for example `/trips`) and that logging in sends API requests to `/api/...` on the Vercel hostname. Do not call the setup endpoint again after creating the administrator.
