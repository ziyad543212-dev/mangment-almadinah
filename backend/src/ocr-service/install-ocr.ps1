[CmdletBinding()]
param(
    [switch]$SkipModelDownload,
    [ValidateSet('accuracy', 'balanced')][string]$Profile = 'balanced'
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$serviceDir = $PSScriptRoot
$venvDir = Join-Path $serviceDir '.venv'
$venvPython = Join-Path $venvDir 'Scripts\python.exe'
$modelsDir = Join-Path $serviceDir 'models'

function Test-Python311($pythonPath, $launcherArgs) {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $pythonPath @launcherArgs -c "import platform, sys; raise SystemExit(0 if sys.version_info[:2] == (3, 11) and sys.maxsize > 2**32 and platform.machine().lower() in ('amd64', 'x86_64') else 1)" 2>$null
        $isPython311 = $LASTEXITCODE -eq 0
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    return $isPython311
}

$pythonCommand = Get-Command py -ErrorAction SilentlyContinue
$pythonBase = $null
$pythonArgs = @()
$portablePython = Join-Path $serviceDir '.python-runtime\python.exe'
if ((Test-Path $portablePython) -and (Test-Path $venvPython) -and (Test-Python311 $portablePython @())) {
    $pythonBase = $portablePython
} elseif ($pythonCommand -and (Test-Python311 $pythonCommand.Source @('-3.11'))) {
    $pythonBase = $pythonCommand.Source
    $pythonArgs = @('-3.11')
} else {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if ($pythonCommand -and (Test-Python311 $pythonCommand.Source @())) {
        $pythonBase = $pythonCommand.Source
    }
}

if (-not $pythonBase) {
    throw 'PaddleOCR requires 64-bit Python 3.11 on Windows for this pinned CPU setup. Install Python 3.11 from https://www.python.org/downloads/windows/ (including the Python launcher), then rerun this script. The detected Python 3.15 is not used.'
}

if (-not (Test-Path $venvPython)) {
    & $pythonBase @pythonArgs -m venv $venvDir
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not create the OCR virtual environment.'
    }
} elseif (-not (Test-Python311 $venvPython @())) {
    throw "The existing OCR virtual environment at $venvDir is not Python 3.11. Remove that specific .venv folder manually, then rerun this script."
}

Write-Host 'Installing pinned CPU-only PaddleOCR dependencies...'
& $venvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) {
    throw 'Could not update pip inside the OCR virtual environment.'
}
& $venvPython -m pip install --extra-index-url 'https://www.paddlepaddle.org.cn/packages/stable/cpu/' -r (Join-Path $serviceDir 'requirements.txt')
if ($LASTEXITCODE -ne 0) {
    throw 'PaddleOCR dependency installation failed. Check Python 3.11, Windows architecture, and network access.'
}

if (-not $SkipModelDownload) {
    $tarCommand = Get-Command tar -ErrorAction SilentlyContinue
    if (-not $tarCommand) {
        throw 'Windows tar.exe was not found. Install the Windows tar utility or download/extract the documented model archives manually.'
    }

    $modelDownloads = @(
        @{
            Name = 'PP-OCRv5_mobile_det'
            Url = 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_det_infer.tar'
        },
        @{
            Name = 'arabic_PP-OCRv5_mobile_rec'
            Url = 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/arabic_PP-OCRv5_mobile_rec_infer.tar'
        },
        @{
            Name = 'PP-LCNet_x1_0_doc_ori'
            Url = 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-LCNet_x1_0_doc_ori_infer.tar'
        },
        @{
            Name = 'en_PP-OCRv5_mobile_rec'
            Url = 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/en_PP-OCRv5_mobile_rec_infer.tar'
        }
    )
    if ($Profile -eq 'accuracy') {
        $modelDownloads += @{
            Name = 'PP-OCRv5_server_det'
            Url = 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_server_det_infer.tar'
        }
    }

    foreach ($model in $modelDownloads) {
        $targetDir = Join-Path $modelsDir $model.Name
        $files = @()
        if (Test-Path $targetDir) {
            $files = Get-ChildItem -Path $targetDir -File -Recurse
        }
        $hasWeights = $files | Where-Object { $_.Name -eq 'inference.pdiparams' } | Select-Object -First 1
        $hasConfig = $files | Where-Object {
            $_.Name -in @('inference.json', 'inference.yml', 'inference.pdmodel')
        } | Select-Object -First 1
        if ($hasWeights -and $hasConfig) {
            Write-Host "Model already exists locally: $($model.Name)"
            continue
        }

        New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
        $archivePath = Join-Path $env:TEMP ("{0}-{1}.tar" -f $model.Name, [guid]::NewGuid())
        try {
            Write-Host "Downloading $($model.Name)..."
            Invoke-WebRequest -Uri $model.Url -OutFile $archivePath
            & $tarCommand.Source -xf $archivePath -C $targetDir
            if ($LASTEXITCODE -ne 0) {
                throw "Could not extract model archive $($model.Name)."
            }
        } finally {
            if (Test-Path $archivePath) {
                Remove-Item -LiteralPath $archivePath -Force
            }
        }

        $files = Get-ChildItem -Path $targetDir -File -Recurse
        $hasWeights = $files | Where-Object { $_.Name -eq 'inference.pdiparams' } | Select-Object -First 1
        $hasConfig = $files | Where-Object {
            $_.Name -in @('inference.json', 'inference.yml', 'inference.pdmodel')
        } | Select-Object -First 1
        if (-not ($hasWeights -and $hasConfig)) {
            throw "Downloaded archive did not contain a recognized Paddle inference model: $($model.Name)."
        }
    }

    $tessdataDir = Join-Path $modelsDir 'tessdata_best'
    New-Item -ItemType Directory -Force -Path $tessdataDir | Out-Null
    foreach ($language in @('ara', 'eng')) {
        $destination = Join-Path $tessdataDir ($language + '.traineddata')
        if (-not (Test-Path $destination)) {
            Write-Host "Downloading Tesseract best model: $language"
            $temporaryModel = $destination + '.partial'
            Invoke-WebRequest -Uri ("https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/main/{0}.traineddata" -f $language) -OutFile $temporaryModel
            Move-Item -LiteralPath $temporaryModel -Destination $destination -Force
        }
    }
} else {
    Write-Host 'Model downloads skipped. Download and unpack both model archives into backend\src\ocr-service\models before starting the service.'
}

& $venvPython -c "import paddle, paddleocr, paddlex; print('PaddlePaddle', paddle.__version__); print('PaddleOCR', paddleocr.__version__); print('PaddleX', paddlex.__version__)"
if ($LASTEXITCODE -ne 0) {
    throw 'PaddleOCR installation verification failed.'
}

Write-Host 'Local OCR dependencies are ready. Start the service with .\start-ocr.ps1'
