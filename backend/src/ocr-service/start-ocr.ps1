$ErrorActionPreference = 'Stop'
$serviceDir = $PSScriptRoot
$python = Join-Path $serviceDir '.venv\Scripts\python.exe'
$portablePython = Join-Path $serviceDir '.python-runtime\python.exe'
if (Test-Path $portablePython) {
    $python = $portablePython
}
$app = Join-Path $serviceDir 'app.py'
$models = Join-Path $serviceDir 'models'

if (-not (Test-Path $python)) {
    throw 'The OCR Python environment is missing. Run .\install-ocr.ps1 first.'
}
if (-not (Test-Path $app)) {
    throw "The OCR service entry point was not found: $app"
}

$env:PADDLE_HOME = $models
if (-not $env:PADDLE_OCR_DEVICE) {
    $env:PADDLE_OCR_DEVICE = 'cpu'
}

Write-Host "Starting local PaddleOCR on 127.0.0.1:8765 using $($env:PADDLE_OCR_DEVICE)..."
& $python $app
if ($LASTEXITCODE -ne 0) {
    throw 'The local PaddleOCR service stopped with an error. Verify the models and Python dependencies.'
}
