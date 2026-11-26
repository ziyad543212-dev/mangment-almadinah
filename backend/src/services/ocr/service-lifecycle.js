const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

let managedProcess = null;
let starting = null;
let serviceStatus = { status: 'not_started', diagnostic: null };

function getLocalOcrStatus() {
  return { ...serviceStatus };
}

function startupDiagnostic(stderr) {
  return /Application Control policy|blocked this file|blocked by (?:group |a )?policy/i.test(stderr)
    ? 'PADDLE_OCR_BLOCKED_BY_POLICY' : 'PADDLE_OCR_STARTUP_FAILED';
}

async function waitForLocalOcrService() {
  if (starting) await starting;
}

async function startLocalOcrService() {
  if (starting) return starting;
  starting = (async () => {
    if (process.env.OCR_AUTOSTART === 'false') {
      serviceStatus = { status: 'disabled', diagnostic: null };
      return false;
    }
    // Never manage a differently configured service or a remote host.
    const url = new URL(process.env.LOCAL_PADDLE_OCR_URL || 'http://127.0.0.1:8765/ocr');
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.port !== '8765') return false;
    try {
      const response = await fetch(new URL('/health', url), { signal: AbortSignal.timeout(1200), redirect: 'error' });
      if (response.ok && (await response.json()).ok) {
        serviceStatus = { status: 'ready', diagnostic: null };
        return true;
      }
    } catch { /* Start the installed local environment below. */ }
    const serviceDir = path.join(__dirname, '..', '..', 'ocr-service');
    const executables = process.platform === 'win32'
      ? [path.join(serviceDir, '.python-runtime', 'python.exe'), path.join(serviceDir, '.venv', 'Scripts', 'python.exe')]
      : [path.join(serviceDir, '.venv', 'bin', 'python')];
    const executable = executables.find((candidate) => fs.existsSync(candidate));
    if (!executable || !fs.existsSync(path.join(serviceDir, 'models', 'arabic_PP-OCRv5_mobile_rec'))) {
      serviceStatus = { status: 'not_installed', diagnostic: null };
      return false;
    }
    serviceStatus = { status: 'starting', diagnostic: null };
    const child = spawn(executable, [path.join(serviceDir, 'app.py')], {
      cwd: serviceDir, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: 'True' }
    });
    managedProcess = child;
    let startupStderr = '';
    child.stderr.on('data', (chunk) => {
      // Keep startup errors only. Never persist OCR output or expose raw paths.
      if (serviceStatus.status === 'starting') startupStderr = (startupStderr + chunk.toString()).slice(-16_384);
    });
    const failed = () => {
      if (managedProcess !== child) return;
      managedProcess = null;
      serviceStatus = { status: 'unavailable', diagnostic: startupDiagnostic(startupStderr) };
      console.warn('[OCR] Local service stopped:', serviceStatus.diagnostic);
      startupStderr = '';
    };
    child.once('error', failed);
    child.once('exit', failed);
    const deadline = Date.now() + 60_000;
    while (managedProcess === child && Date.now() < deadline) {
      try {
        const response = await fetch(new URL('/health', url), { signal: AbortSignal.timeout(1000), redirect: 'error' });
        if (response.ok && (await response.json()).ok) {
          serviceStatus = { status: 'ready', diagnostic: null };
          startupStderr = '';
          return true;
        }
      } catch { /* Models are still loading. */ }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (managedProcess === child) {
      serviceStatus = { status: 'unavailable', diagnostic: 'PADDLE_OCR_STARTUP_TIMEOUT' };
      stopLocalOcrService();
    }
    return false;
  })().finally(() => { starting = null; });
  return starting;
}

function stopLocalOcrService() {
  const child = managedProcess;
  managedProcess = null;
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 3000 }); }
    catch { child.kill(); }
  } else child.kill();
}

module.exports = { startLocalOcrService, stopLocalOcrService, getLocalOcrStatus, waitForLocalOcrService, startupDiagnostic };
