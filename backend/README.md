# Backend

The Express API uses PostgreSQL. Set `DATABASE_URL` and `JWT_SECRET` in the
ignored `.env.local` or `.env` files before starting. Schema migrations are
versioned and run before the API listens; `npm run migrate` can run them
explicitly. Initial administrator credentials come from
`INITIAL_ADMIN_USERNAME` and `INITIAL_ADMIN_PASSWORD` and are applied only
when the users table is empty. Restarting the API never resets a password.

Neon databases use the official `@neondatabase/serverless` PostgreSQL driver
over secure WebSockets by default, including transactions and migrations.
This works on networks where direct PostgreSQL connections on port 5432 are
blocked. Local and other PostgreSQL databases keep the standard TCP driver.
Set `PG_TRANSPORT=tcp` to explicitly use TCP with Neon. Node.js 20 or newer is
required.

The backend runs passport OCR locally using the Windows Python PaddleOCR service
documented in [`src/ocr-service/README.md`](./src/ocr-service/README.md). Azure
credentials and paid OCR APIs are not required.
An optional Gemini assistant for Arabic names requires a project with active
Cloud Billing and explicit server configuration; its privacy controls and
local-only per-scan option are described in the same guide.

Install the local OCR service once, then start the Node backend (it starts the
installed OCR service automatically):

```powershell
cd backend\src\ocr-service
.\install-ocr.ps1
```

In another PowerShell terminal:

```powershell
cd backend
npm test
npm start
```

OCR accepts images and single selected PDF pages. Tests cover extraction,
MRZ checks, crop retries, concurrency, and PDF rasterization. Real-image
evaluation and labeled accuracy reports are described in the OCR service guide.
