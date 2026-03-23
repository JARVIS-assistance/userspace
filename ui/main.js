const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const USERSPACE_HOST = process.env.USERSPACE_HOST || '127.0.0.1';
const USERSPACE_PORT = Number(process.env.USERSPACE_PORT || '8765');

let userspaceProcess = null;

function resolveUserspacePythonExecutable(userspaceRoot) {
  const venvPython =
    process.platform === 'win32'
      ? path.join(userspaceRoot, '.venv', 'Scripts', 'python.exe')
      : path.join(userspaceRoot, '.venv', 'bin', 'python');

  if (fs.existsSync(venvPython)) {
    return venvPython;
  }

  return process.env.PYTHON_BIN || 'python3';
}

function startUserspace() {
  if (userspaceProcess) return;

  const userspaceRoot = path.resolve(__dirname, '..', 'userspace');
  const runFile = path.join(userspaceRoot, 'run.py');
  if (!fs.existsSync(runFile)) {
    console.warn(`[userspace] run.py not found at ${runFile}`);
    return;
  }

  const pythonBin = resolveUserspacePythonExecutable(userspaceRoot);
  userspaceProcess = spawn(pythonBin, ['run.py'], {
    cwd: userspaceRoot,
    env: {
      ...process.env,
      USERSPACE_HOST,
      USERSPACE_PORT: String(USERSPACE_PORT)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  userspaceProcess.stdout.on('data', (chunk) => {
    process.stdout.write(`[userspace] ${chunk}`);
  });

  userspaceProcess.stderr.on('data', (chunk) => {
    process.stderr.write(`[userspace] ${chunk}`);
  });

  userspaceProcess.on('exit', (code, signal) => {
    console.log(`[userspace] exited (code=${code}, signal=${signal})`);
    userspaceProcess = null;
  });
}

function stopUserspace() {
  if (!userspaceProcess) return;
  userspaceProcess.kill();
  userspaceProcess = null;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    frame: false,
    fullscreen: false,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  win.maximize();
}

ipcMain.handle('userspace:get-config', async () => {
  return {
    host: USERSPACE_HOST,
    port: USERSPACE_PORT,
    baseUrl: `http://${USERSPACE_HOST}:${USERSPACE_PORT}`
  };
});

ipcMain.handle('userspace:health', async () => {
  const url = `http://${USERSPACE_HOST}:${USERSPACE_PORT}/health`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return { ok: false, status: res.status, data: null };
    }
    const data = await res.json();
    return { ok: true, status: res.status, data };
  } catch (error) {
    return { ok: false, status: 0, error: String(error) };
  }
});

app.whenReady().then(() => {
  // Allow microphone access for STT
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'microphone') {
      callback(true);
    } else {
      callback(false);
    }
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'media' || permission === 'microphone') {
      return true;
    }
    return false;
  });

  startUserspace();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopUserspace();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopUserspace();
});
