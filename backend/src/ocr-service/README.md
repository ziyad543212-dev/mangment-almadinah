# Local Arabic PaddleOCR service

This Windows-only helper runs the official PaddleOCR PP-OCRv5 CPU pipeline on
`127.0.0.1:8765`. It loads the detection and recognition models once during
startup and exposes only `/health` and `/ocr` (API documentation is disabled).
The OCR language model is the dedicated `arabic_PP-OCRv5_mobile_rec`, which
Paddle documents as supporting Arabic, Persian, Uyghur, Urdu, Pashto, Kurdish,
Sindhi, Balochi, and English. It is not a passport-field parser; Node.js uses
recognized labels, text positions, confidence, and independent MRZ validation
to identify fields.

The service also loads a dedicated English recognizer and document orientation
classifier. Recognition scores are model scores, not calibrated probabilities
that an entire passport field is correct. Accuracy must be measured on labeled
passport images from the actual capture workflow.

## Windows setup

The pinned environment uses 64-bit Python 3.11. Install it from
[python.org](https://www.python.org/downloads/windows/) with
the Python launcher enabled. From PowerShell:

```powershell
cd backend\src\ocr-service
.\install-ocr.ps1
```

The installer creates this service's `.venv`, installs the versions in
`requirements.txt`, and downloads the detector, Arabic and English recognizers,
orientation classifier, and Tesseract `tessdata_best` models into `models\`.
`-Profile accuracy` additionally installs `PP-OCRv5_server_det` (about 88 MB of
weights). Select it explicitly with `PADDLE_OCR_DETECTOR=PP-OCRv5_server_det`;
the mobile detector is the runtime default because the server detector can
exhaust available RAM when the app and OCR run together on an 8 GB PC.
No model download is performed during
OCR requests. The configured model names match the model metadata bundled with
these mobile weights. The model weights are local and excluded from source
control. Paddle's Windows inference runtime may not read model files through a
non-ASCII path; the service resolves an ASCII Windows short path automatically
when the models are stored below a non-ASCII user directory.

If models are downloaded manually, use the links from the official
[PP-OCRv5 OCR model table](https://www.paddleocr.ai/latest/en/version3.x/pipeline_usage/OCR.html):

- `PP-OCRv5_mobile_det_infer.tar`
- `arabic_PP-OCRv5_mobile_rec_infer.tar`
- `en_PP-OCRv5_mobile_rec_infer.tar`
- `PP-LCNet_x1_0_doc_ori_infer.tar`

Extract each under `models\<model-name>\`. The service verifies the
inference files at startup.

## Run

The backend automatically starts an installed local service and stops only
the process it started. `OCR_AUTOSTART=false` disables that behavior. An
already running service is reused. For manual operation:

```powershell
cd backend\src\ocr-service
.\start-ocr.ps1
```

In a second terminal, start the Node backend:

```powershell
cd backend
npm start
```

The Node endpoint accepts JPEG, PNG, WebP, TIFF, or PDF (15 MB). PDF rendering
selects exactly one page, bounds its raster size before allocation, and frees
the parser afterward. Use the form `page` field (default 1) to choose a page;
the UI exposes this selector for PDF uploads.

The service corrects 0/90/180/270-degree orientation, estimates small skew,
and retains an upright colour image. It compares the original read with
adaptive shadow/contrast passes when necessary, rereads uncertain Arabic
line crops, and uses the English model on Latin text and MRZ candidates.
These filters do not generate or invent image detail. The processed image
is returned in memory so Tesseract and crop retries share the same coordinates.

The backend derives the name-region crop from detected labels and runs an
independent, serialised Tesseract worker for each language and for MRZ.
Tesseract block output is requested explicitly and flattened into positioned
lines. For floating-point `tessdata_best`, a local worker selects standard SIMD
because Tesseract.js 7's relaxed-SIMD float path currently crashes (upstream
[#1080](https://github.com/naptha/tesseract.js/issues/1080)).

Set `LOCAL_PADDLE_OCR_TIMEOUT_MS` to change the Node-to-Python
request timeout; the service URL can be changed with
`LOCAL_PADDLE_OCR_URL`, but must remain an HTTP loopback address.

CPU is the default. The supported versions are pinned together in
`requirements.txt`; PaddleOCR 3.7.0 and PaddleX 3.7.2 are pinned together
because their predictor APIs must match. Allowing pip to select a different
PaddleX release can prevent the service from starting. The service disables
oneDNN for CPU inference because the configured PaddlePaddle 3.3.0 CPU runtime
does not support the model's oneDNN attribute path. The installer uses
PaddlePaddle 3.3.0's official Windows CPU package index. GPU use is opt-in
through `PADDLE_OCR_DEVICE=gpu:0` and requires a compatible NVIDIA GPU, CUDA
runtime, and a matching GPU-enabled PaddlePaddle build. Replace the CPU
PaddlePaddle wheel with the compatible GPU wheel from the official
[Windows installation instructions](https://www.paddlepaddle.org.cn/documentation/docs/en/install/pip/windows-pip_en.html).
The CPU environment will reject GPU requests instead of silently pretending
to use GPU.

Additional Python settings (pass as environment variables; backend `.env`
settings are inherited when autostarting):

| Setting | Default | Meaning |
| --- | --- | --- |
| `PADDLE_OCR_CPU_THREADS` | `4` | CPU threads per model, capped at 8 |
| `PADDLE_OCR_MAX_PASSES` | `2` | Full-page attempts, range 1-3; 1 also disables Arabic crop refinement |
| `PADDLE_OCR_BUDGET_SECONDS` | `45` | Stop starting optional passes after this budget; an active inference must finish |
| `PADDLE_OCR_DETECTOR` | `PP-OCRv5_mobile_det` | Mobile or installed server detector |

Use `OCR_MAX_CONCURRENT=1` on 8 GB machines. Python inference is serialised
because model predictors are stateful. If a portable `.python-runtime` exists,
the start script prefers it; environments, model weights, and private test
outputs are excluded from git and the Electron package.

## Data handling and limitations

The service accepts image files only in memory and is hard-bound to loopback.
Raw recognized text is returned to the authenticated Node API for manual review;
OCR text and passport images are not written to disk by this service. The
backend also retains its existing Tesseract temporary model cache.

MRZ fillers remain `<`, never `L`. Repair is limited to known OCR confusions
and requires check digits; unknown date digits are never brute-forced. The
data line can independently recover checked document fields when the name
line is damaged. MRZ names are never advertised as checksum-validated (the
name line has no check digit). Neither Arabic names nor a father's name are
inferred from the MRZ. Conflicting visual readings remain visible for review.

## Verification and real-image evaluation

```powershell
cd backend
npm test
node scripts/ocr-engine-smoke.js
node scripts/ocr-fallback-smoke.js
node scripts/ocr-evaluate.js --dir "C:\private\passports" --labels "C:\private\expected.json" --stress
```

The smoke test exercises real `tessdata_best` recognition and positioned blocks.
The evaluator uses the application's real OCR processing handler without
opening a database connection. `--match <regex>` and `--limit <number>` select
samples. `--stress` adds rotated, dark/compressed and blurred versions of the
first file. Source documents remain unchanged.

Labels have the shape `{ "file.pdf": { "first_name_ar": "...", ... } }`.
Private results default to `backend/ocr-evaluation/`; `--include-raw` additionally
retains engine text locally for diagnosis. Never commit private labels,
images or raw results. Reports distinguish exact field accuracy on supplied
labels, field coverage, checksum validation, and measured latency. Coverage
alone is not an accuracy result. Arabic dots and names under glare can remain
wrong despite high model confidence and require human review.

## Local or cloud passport OCR

The passport panel offers two explicit modes. **Local** is the default and
uses PaddleOCR with the Tesseract/MRZ fallback, without any Gemini request.
**Cloud (Gemini)** sends the complete selected data-page image to Google,
including the portrait and printed identifiers when present, after stripping
metadata and resizing. For PDF input only the selected page is rasterized and
sent. Cloud mode reads Arabic names, English names, document number, dates,
nationality, gender and additional document fields directly. It does not
depend on local text detection, model installation, or safe name-box cropping.
The UI explains the transmission and potential API charges before upload.

Use a Gemini API project with **active Cloud Billing**. Google excludes
personal information from its unpaid service; under the paid-service terms,
inputs and responses are not used to improve Google's products, but Google
can retain temporary abuse-monitoring logs. See the official
[data-use terms](https://aistudio.google.com/docs/terms#data-use-paid).

Set these values in the ignored `backend/.env.local` and restart the backend:

```dotenv
GEMINI_OCR_ENABLED=true
GEMINI_OCR_PAID_PROJECT_CONFIRMED=true
GEMINI_API_KEY=your-server-side-key
GEMINI_OCR_MODEL=gemini-3.6-flash
GEMINI_OCR_TIMEOUT_MS=45000
```

The paid-project confirmation is the operator's attestation. The backend
cannot verify Cloud Billing status from an API key, so reconfirm it when
switching projects. The key is never sent to the frontend or placed in URLs.
Do not enable this feature for a free-tier project containing real passports.
The API is billed according to the configured project's pricing; a paid
project does not make inference free.

Requests use the Interactions API with **`store: false`**, an inline image,
no uploaded files, no conversation history, no tools and a strict JSON schema.
This disables conversation storage; it does not override Google's separate
abuse-monitoring terms. See the official
[storage controls](https://aistudio.google.com/docs/interactions-overview#data-storage-retention).
The integration makes at most one cloud request per scan and has a bounded
timeout. Quota, credential, model and timeout errors are reported explicitly;
it does not silently switch engines or retry a billable request.

Uncertain letters, invalid scripts/dates, corrupted place text, missing labels
and unlabeled father names are rejected. MRZ text is checked locally using the
existing parser and check digits; visible/MRZ disagreements remain available
for review. A name is never split to invent a father name. Cloud self-assessment
is not converted into a numerical confidence score, and cloud names always
require human review. Reading only ancillary fields cannot mark a scan successful.

The multipart `mode` field accepts only `local` or `cloud`. Omitting it selects
`local`. The old `gemini_assist` flag does not trigger cloud transmission.
`/api/ocr/health` reports `modes.cloud.status` and a configuration message,
without returning credentials. Configured status does not guarantee live API
availability, remaining quota, or verified billing.

For a live API smoke test using a generated synthetic passport page:

```powershell
cd backend
node scripts/cloud-ocr-smoke.js --live
```

This makes one API request and can incur a small usage charge. Without `--live`
the script checks configuration only. The unit suite mocks cloud calls even
when this machine has Gemini enabled. The real-image evaluator and fallback
smoke test explicitly use local mode. Keep private evaluation outputs outside git.
