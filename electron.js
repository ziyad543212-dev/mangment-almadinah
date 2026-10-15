const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let backendProcess;

function createWindow() {
  console.log('Creating window...');
  console.log('__dirname:', __dirname);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load the frontend from the dist folder
  const indexPath = path.join(__dirname, 'frontend', 'dist', 'index.html');
  console.log('Loading index from:', indexPath);

  const fs = require('fs');
  if (!fs.existsSync(indexPath)) {
    console.error('index.html does not exist at:', indexPath);
    app.quit();
    return;
  }

  mainWindow.loadFile(indexPath).then(() => {
    console.log('Successfully loaded index.html');
  }).catch(err => {
    console.error('Failed to load index.html:', err);
    app.quit();
  });

  // Comment out DevTools for production
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    console.log('Window closed');
    mainWindow = null;
  });
}

function startBackend() {
  // Determine the backend path based on environment
  let backendPath;
  
  if (app.isPackaged) {
    // Production: use resourcesPath for installed app
    backendPath = path.join(process.resourcesPath, 'backend');
  } else {
    // Development: assume backend is in the project root
    backendPath = path.join(__dirname, 'backend');
  }

  console.log('Starting backend from:', backendPath);
  console.log('App is packaged:', app.isPackaged);
  console.log('__dirname:', __dirname);

  const serverPath = path.join(backendPath, 'src', 'server.js');
  
  // Check if server file exists
  const fs = require('fs');
  if (!fs.existsSync(serverPath)) {
    console.error('Server file does not exist at:', serverPath);
    return;
  }

  // Spawn the backend process
  backendProcess = spawn('node', ['src/server.js'], {
    cwd: backendPath,
    shell: true,
    env: { ...process.env, NODE_ENV: 'production' },
    detached: false
  });

  backendProcess.stdout.on('data', (data) => {
    console.log(`Backend: ${data}`);
  });

  backendProcess.stderr.on('data', (data) => {
    console.error(`Backend Error: ${data}`);
  });

  backendProcess.on('close', (code) => {
    console.log(`Backend process exited with code ${code}`);
  });

  backendProcess.on('error', (err) => {
    console.error('Failed to start backend:', err);
  });

  console.log('Backend process started with PID:', backendProcess.pid);
}

function killBackend() {
  if (backendProcess) {
    console.log('Killing backend process...');
    try {
      // Try graceful shutdown first
      backendProcess.kill('SIGTERM');
      
      // Force kill after 3 seconds if still running
      setTimeout(() => {
        if (backendProcess && !backendProcess.killed) {
          console.log('Force killing backend process...');
          backendProcess.kill('SIGKILL');
        }
      }, 3000);
    } catch (err) {
      console.error('Error killing backend:', err);
    }
    backendProcess = null;
  }
}

// IPC handlers for file dialogs
ipcMain.handle('dialog:save', async (event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, options);
  return result;
});

ipcMain.handle('dialog:open', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options);
  return result;
});

ipcMain.handle('app:getPath', async (event) => {
  return app.getPath('userData');
});

app.whenReady().then(() => {
  console.log('App is ready');
  startBackend();
  
  // Wait for backend to be ready before creating window
  // Increased timeout to ensure backend has time to start and initialize database
  setTimeout(() => {
    console.log('Creating window after backend startup delay');
    createWindow();
  }, 5000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  console.log('All windows closed');
  if (process.platform !== 'darwin') {
    killBackend();
    app.quit();
  }
});

app.on('before-quit', () => {
  console.log('App is quitting');
  killBackend();
});

app.on('will-quit', () => {
  console.log('App will quit');
  killBackend();
});
