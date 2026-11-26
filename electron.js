const { app, BrowserWindow, dialog, ipcMain, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const {
  ENCRYPTED_CONFIG_PREFIX,
  parseConfiguration,
  cloudConfiguration
} = require('./electron-config');

const SHUTDOWN_TIMEOUT_MS = 8_000;
const BACKEND_START_TIMEOUT_MS = 90_000;
const STARTUP_PROBE_TIMEOUT_MS = 2_500;
const CONFIG_FILE_NAME = 'backend.env';

let mainWindow;
let backendProcess;
let backendPort = null;
let quitting = false;
let shutdownPromise;
let backendStartupOutput = '';
let backendStartError = null;
let backendExitCode = null;

const DEBUG_LOG = path.join(app.getPath('temp'), 'mang-electron-debug.log');
function debugLog(message) {
  try {
    fs.appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${message}\n`);
  } catch {}
}
process.on('uncaughtException', (error) => {
  debugLog(`uncaughtException: ${error.stack || error.message}`);
});
process.on('unhandledRejection', (reason) => {
  debugLog(`unhandledRejection: ${reason && (reason.stack || reason.message || reason)}`);
});
debugLog('electron.js loaded');

const isolatedTestData = process.env.NODE_ENV === 'test' && process.env.ALMADINAH_TEST_DATA_DIR;
app.setPath('userData', isolatedTestData && path.isAbsolute(isolatedTestData)
  ? isolatedTestData : path.join(app.getPath('appData'), 'AlMadinahSystem'));
const hasSingleInstanceLock = app.requestSingleInstanceLock();
debugLog(`userData=${app.getPath('userData')} packaged=${app.isPackaged} singleInstance=${hasSingleInstanceLock}`);

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function showStartupError(message) {
  dialog.showErrorBox('تعذر تشغيل التطبيق', message);
}

function getUserDataPath(...segments) {
  return path.join(app.getPath('userData'), ...segments);
}

function getBackendPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'backend')
    : path.join(__dirname, 'backend');
}

function getFrontendIndexPath() {
  return path.join(__dirname, 'frontend', 'dist', 'index.html');
}

function getTesseractLangPath(backendPath) {
  const packagedPath = path.join(backendPath, 'tessdata_best');
  if (app.isPackaged) return packagedPath;
  const devPath = path.join(backendPath, 'src', 'ocr-service', 'models', 'tessdata_best');
  return fs.existsSync(devPath) ? devPath : packagedPath;
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function createLogStream(name) {
  ensureDirectory(getUserDataPath('logs'));
  return fs.createWriteStream(getUserDataPath('logs', name), { flags: 'a' });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function getBackendConfigPath() {
  return getUserDataPath(CONFIG_FILE_NAME);
}

function loadStoredConfiguration() {
  const configPath = getBackendConfigPath();
  if (!fs.existsSync(configPath)) return { configuration: null };

  const contents = fs.readFileSync(configPath);
  let plaintext;
  if (contents.subarray(0, ENCRYPTED_CONFIG_PREFIX.length)
    .equals(ENCRYPTED_CONFIG_PREFIX)) {
    if (!safeStorage.isEncryptionAvailable()) {
      return { configuration: null, error: 'تعذر فك تشفير إعدادات التطبيق.' };
    }
    try {
      plaintext = safeStorage.decryptString(contents.subarray(ENCRYPTED_CONFIG_PREFIX.length));
    } catch {
      return { configuration: null, error: 'تعذر فك تشفير إعدادات التطبيق.' };
    }
  } else {
    plaintext = contents.toString('utf8');
  }
  return { configuration: parseConfiguration(plaintext) };
}

function saveStoredConfiguration(configuration) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('تشفير Windows غير متاح؛ لم يتم حفظ الإعدادات.');
  }
  const serialized = Object.entries(configuration)
    .filter(([, value]) => typeof value === 'string' && value.length > 0)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join('\n') + '\n';
  const encrypted = Buffer.concat([
    ENCRYPTED_CONFIG_PREFIX,
    safeStorage.encryptString(serialized)
  ]);
  const configPath = getBackendConfigPath();
  const temporaryPath = `${configPath}.${process.pid}.tmp`;
  ensureDirectory(app.getPath('userData'));
  fs.writeFileSync(temporaryPath, encrypted, { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporaryPath, configPath);
}

async function ensureDesktopConfiguration() {
  const explicitFile = process.env.ALMADINAH_CONFIG_FILE;
  const companionFile = path.join(process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath), '.env');
  const candidates = explicitFile ? [explicitFile] : app.isPackaged
    ? [companionFile] : [path.join(__dirname, 'backend', '.env')];
  let source = candidates.find(file => fs.existsSync(file));
  let configuration;
  if (explicitFile && !source) throw new Error('ملف إعدادات Neon المحدد غير موجود.');
  if (source) {
    configuration = cloudConfiguration(parseConfiguration(fs.readFileSync(source)));
  } else {
    const stored = loadStoredConfiguration();
    if (stored.configuration) {
      try { configuration = cloudConfiguration(stored.configuration); } catch { /* Import the requested cloud configuration instead of an old local database. */ }
    }
    if (!configuration) {
      const selection = await dialog.showOpenDialog({
        title: 'اختر ملف إعدادات Neon (.env) الخاص بالإدارة',
        properties: ['openFile', 'showHiddenFiles'],
        filters: [{ name: 'Environment configuration', extensions: ['env'] }, { name: 'All files', extensions: ['*'] }]
      });
      if (selection.canceled || !selection.filePaths[0]) throw new Error('يلزم ملف إعدادات Neon لتشغيل البرنامج.');
      source = selection.filePaths[0];
      configuration = cloudConfiguration(parseConfiguration(fs.readFileSync(source)));
    }
  }
  saveStoredConfiguration(configuration);
  return configuration;
}

function makeChildEnvironment(configuration) {
  const backendPath = getBackendPath();
  return {
    ...process.env,
    ...configuration,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(backendPort),
    DATABASE_URL: configuration.DATABASE_URL,
    JWT_SECRET: configuration.JWT_SECRET,
    PG_TRANSPORT: configuration.PG_TRANSPORT || 'auto',
    INITIAL_ADMIN_USERNAME: configuration.INITIAL_ADMIN_USERNAME,
    INITIAL_ADMIN_PASSWORD: configuration.INITIAL_ADMIN_PASSWORD,
    ALLOWED_ORIGINS: 'null',
    PG_POOL_MAX: process.env.PG_POOL_MAX || '5',
    UPLOAD_DIR: getUserDataPath('uploads'),
    TESSERACT_LANG_PATH: getTesseractLangPath(backendPath),
    TESSERACT_CACHE_DIR: getUserDataPath('tesseract-cache'),
    OCR_AUTOSTART: process.env.OCR_AUTOSTART || 'true'
  };
}

async function probeBackend(timeoutMs = STARTUP_PROBE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${backendPort}/api/health`, {
      signal: controller.signal
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForBackend(timeoutMs = BACKEND_START_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (backendStartError) {
      throw new Error('تعذر تشغيل عملية الخادم.');
    }
    if (backendExitCode !== null) {
      throw new Error('توقف الخادم أثناء التشغيل. راجع الاتصال بقاعدة Neon وملف الإعدادات.');
    }
    if (await probeBackend()) return;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error('انتهت مهلة انتظار استجابة الخادم.');
}

function startBackendProcess(configuration) {
  const backendPath = getBackendPath();
  const serverPath = path.join(backendPath, 'src', 'server.js');
  if (!fs.existsSync(serverPath)) {
    throw new Error('ملفات الخادم غير موجودة. أعد تثبيت التطبيق.');
  }

  backendStartError = null;
  backendExitCode = null;
  backendStartupOutput = '';
  const logStream = createLogStream('backend.log');
  const child = spawn(process.execPath, [serverPath], {
    cwd: backendPath,
    windowsHide: true,
    env: makeChildEnvironment(configuration),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  backendProcess = child;

  const captureOutput = (data, stream) => {
    const text = data.toString();
    backendStartupOutput = `${backendStartupOutput}${text}`.slice(-16_000);
    logStream.write(`[${stream}] ${text}`);
    if (/DATABASE_URL=|JWT_SECRET=|postgres(?:ql)?:\/\/[^\s]+/i.test(text)) {
      console.error(`Backend ${stream}: [sensitive configuration output redacted]`);
      return;
    }
    console[stream === 'stderr' ? 'error' : 'log'](`Backend ${stream}: ${text.trimEnd()}`);
  };
  child.stdout.on('data', (data) => captureOutput(data, 'stdout'));
  child.stderr.on('data', (data) => captureOutput(data, 'stderr'));
  child.on('error', (error) => {
    backendStartError = error;
    console.error('Unable to launch the backend process:', error.message);
  });
  child.on('close', (code) => {
    backendExitCode = code ?? 1;
    logStream.end();
    if (backendProcess === child) backendProcess = null;
    if (!quitting && mainWindow && !mainWindow.isDestroyed()) {
      showStartupError('توقف الخادم. أغلق التطبيق وأعد تشغيله.');
      app.quit();
    }
  });
}

async function stopBackend() {
  const child = backendProcess;
  if (!child || child.exitCode !== null || child.killed) {
    backendProcess = null;
    return;
  }
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once('close', resolve)),
    new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS))
  ]);
  if (child.exitCode === null && !child.killed) child.kill();
  if (backendProcess === child) backendProcess = null;
}

function createWindowOptions(preloadPath) {
  return {
    icon: path.join(__dirname, 'assets', 'desktop-icon.png'),
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      ...(preloadPath && { preload: preloadPath })
    }
  };
}

function createMainWindow() {
  const indexPath = getFrontendIndexPath();
  if (!fs.existsSync(indexPath)) {
    throw new Error('ملفات الواجهة غير موجودة. أعد بناء التطبيق.');
  }

  mainWindow = new BrowserWindow(createWindowOptions(
    path.join(__dirname, 'electron-preload.js')
  ));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const mainPageUrl = require('url').pathToFileURL(indexPath).href;
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.split('#')[0] !== mainPageUrl) event.preventDefault();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.loadFile(indexPath).catch((error) => {
    console.error('Unable to load the frontend:', error.message);
    showStartupError('تعذر تحميل واجهة التطبيق.');
    app.quit();
  });
}

async function initializeApplication() {
  debugLog('initializeApplication: waiting for ready');
  await app.whenReady();
  debugLog('app ready');

  const configuration = await ensureDesktopConfiguration();
  debugLog('configuration ready');

  backendPort = await getFreePort();
  startBackendProcess(configuration);
  try {
    await waitForBackend();
  } catch (error) {
    await stopBackend();
    throw error;
  }

  createMainWindow();
}

ipcMain.on('desktop:get-config', (event) => {
  event.returnValue = {
    apiBaseUrl: backendPort ? `http://127.0.0.1:${backendPort}/api` : ''
  };
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && backendProcess) {
    createMainWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

async function shutdown() {
  if (shutdownPromise) return shutdownPromise;
  quitting = true;
  shutdownPromise = (async () => {
    await stopBackend();
  })();
  return shutdownPromise;
}

app.on('before-quit', (event) => {
  if (quitting && shutdownPromise) return;
  event.preventDefault();
  shutdown().finally(() => {
    quitting = true;
    app.quit();
  });
});

app.on('render-process-gone', (_event, _webContents, details) => {
  console.error('Electron renderer process exited:', details.reason);
});

initializeApplication().catch(async (error) => {
  debugLog(`startup failed: ${error.stack || error.message}`);
  console.error('Application startup failed:', error.message);
  showStartupError(error.message || 'خطأ غير متوقع أثناء التشغيل.');
  await shutdown().catch(() => {});
  app.quit();
});
