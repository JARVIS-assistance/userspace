const { app, BrowserWindow, ipcMain, session, screen } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const USERSPACE_HOST = process.env.USERSPACE_HOST || '127.0.0.1';
const USERSPACE_PORT = Number(process.env.USERSPACE_PORT || '8765');
const AUTH_API_BASE = (process.env.AUTH_API_BASE || 'http://127.0.0.1:8001').replace(/\/+$/, '');
const USERSPACE_WS_URL = process.env.USERSPACE_WS_URL || `ws://${USERSPACE_HOST}:${USERSPACE_PORT}/ws`;

const SPHERE_SIZE = 100;
const SPHERE_MARGIN = 24;
const SPHERE_WINDOW_W = 560; // wide enough for speech bubble
const SPHERE_WINDOW_H = 160;

let mainWindow = null;
let savedBounds = null;
let isSphereMode = false;

// ── Window ─────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    frame: false,
    fullscreen: false,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    transparent: true,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow = win;

  // Pipe renderer console to terminal (safely)
  win.webContents.on('console-message', (e, level, msg, line, src) => {
    try { process.stdout.write(`[renderer] ${msg}\n`); } catch (_) {}
  });

  // Detect renderer crash
  win.webContents.on('render-process-gone', (e, details) => {
    try { process.stderr.write(`[CRASH] renderer process gone: ${details.reason} ${details.exitCode}\n`); } catch (_) {}
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  win.maximize();

  // Intercept OS minimize → trigger sphere animation instead
  win.on('minimize', (e) => {
    if (!isSphereMode) {
      e.preventDefault();
      win.webContents.send('window:minimize-to-sphere');
    }
  });

  win.on('closed', () => {
    mainWindow = null;
  });
}

// ── Sphere mode transitions ───────────────────────────
function transitionToSphere() {
  if (!mainWindow || isSphereMode) return;

  savedBounds = mainWindow.getBounds();
  isSphereMode = true;

  const display = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint()
  );
  const { width: screenW } = display.workArea;

  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setResizable(false);
  mainWindow.setHasShadow(false);
  mainWindow.setBounds({
    x: screenW - SPHERE_WINDOW_W - SPHERE_MARGIN,
    y: SPHERE_MARGIN,
    width: SPHERE_WINDOW_W,
    height: SPHERE_WINDOW_H,
  }, true);

  if (process.platform === 'darwin') {
    mainWindow.setWindowButtonVisibility(false);
  }

  // Wait a tick for resize to settle, then tell renderer sphere is ready
  setTimeout(() => {
    if (mainWindow) mainWindow.webContents.send('window:sphere-ready');
  }, 50);
}

function restoreFromSphere() {
  if (!mainWindow || !isSphereMode) return;

  isSphereMode = false;
  mainWindow.setAlwaysOnTop(false);
  mainWindow.setResizable(true);
  mainWindow.setHasShadow(true);

  if (savedBounds) {
    mainWindow.setBounds(savedBounds, true);
    savedBounds = null;
  } else {
    mainWindow.maximize();
  }

  // Wait for window resize to settle, then tell renderer to fade in waveform
  setTimeout(() => {
    if (mainWindow) mainWindow.webContents.send('window:restore-from-sphere');
  }, 50);
}

// ── IPC handlers ───────────────────────────────────────
ipcMain.handle('userspace:get-config', async () => {
  return {
    host: USERSPACE_HOST,
    port: USERSPACE_PORT,
    baseUrl: `http://${USERSPACE_HOST}:${USERSPACE_PORT}`,
    authApiBase: AUTH_API_BASE,
    wsUrl: USERSPACE_WS_URL,
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

ipcMain.handle('tts:synthesize', async (event, payload = {}) => {
  const provider = String(payload.provider || '');
  const text = String(payload.text || '').trim();
  const apiKey = String(payload.apiKey || '').trim();
  const voiceId = String(payload.voiceId || '').trim();
  const model = String(payload.model || '').trim();

  if (!text) return { ok: false, error: 'missing text' };
  if (provider !== 'chatterbox' && !apiKey) return { ok: false, error: 'missing api key' };

  try {
    let res;
    if (provider === 'chatterbox') {
      return await synthesizeChatterbox({
        text,
        model: model || 'multilingual',
        language: String(payload.language || 'ko').trim() || 'ko',
        audioPromptPath: String(payload.audioPromptPath || '').trim(),
        exaggeration: Number(payload.exaggeration ?? 0.5),
        cfgWeight: Number(payload.cfgWeight ?? 0.5),
      });
    } else if (provider === 'elevenlabs') {
      const voice = voiceId || 'JBFqnCBsd6RMkjVDRZzb';
      res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: model || 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.45,
            similarity_boost: 0.8,
            style: 0.25,
            use_speaker_boost: true,
          },
        }),
      });
    } else if (provider === 'openai') {
      res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: model || 'gpt-4o-mini-tts',
          voice: voiceId || 'marin',
          input: text,
          response_format: 'mp3',
        }),
      });
    } else {
      return { ok: false, error: `unsupported provider: ${provider}` };
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        ok: false,
        status: res.status,
        error: body.slice(0, 500) || `HTTP ${res.status}`,
      };
    }

    const bytes = Buffer.from(await res.arrayBuffer());
    return {
      ok: true,
      mimeType: res.headers.get('content-type') || 'audio/mpeg',
      audioBase64: bytes.toString('base64'),
    };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
});

function synthesizeChatterbox(options) {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'chatterbox_tts.py');
    const outputPath = path.join(os.tmpdir(), `jarvis-chatterbox-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`);
    const cacheRoot = path.join(__dirname, '..', '.cache');
    const python = process.env.CHATTERBOX_PYTHON || process.env.PYTHON || 'python3';
    const child = spawn(python, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        HF_HOME: process.env.HF_HOME || path.join(cacheRoot, 'huggingface'),
        NUMBA_CACHE_DIR: process.env.NUMBA_CACHE_DIR || path.join(cacheRoot, 'numba'),
      },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      resolve({ ok: false, error: String(error) });
    });
    child.on('close', (code) => {
      if (code !== 0) {
        resolve({
          ok: false,
          error: stderr.trim() || stdout.trim() || `Chatterbox exited with ${code}`,
        });
        return;
      }
      try {
        const bytes = fs.readFileSync(outputPath);
        fs.unlink(outputPath, () => {});
        resolve({
          ok: true,
          mimeType: 'audio/wav',
          audioBase64: bytes.toString('base64'),
        });
      } catch (error) {
        resolve({
          ok: false,
          error: `${String(error)} ${stderr.trim()}`.trim(),
        });
      }
    });
    child.stdin.end(JSON.stringify({ ...options, outputPath }));
  });
}

// Window control IPCs
ipcMain.on('window:minimize', () => {
  if (mainWindow) {
    mainWindow.webContents.send('window:minimize-to-sphere');
  }
});

ipcMain.handle('window:minimize-now', async () => {
  transitionToSphere();
  return true;
});

ipcMain.on('window:close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.on('window:minimize-animation-done', () => {
  transitionToSphere();
});

ipcMain.on('window:restore', () => {
  restoreFromSphere();
});

// Sphere mode: toggle click-through based on cursor position
ipcMain.on('window:set-ignore-mouse', (event, ignore) => {
  if (!mainWindow) return;
  if (ignore) {
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
  } else {
    mainWindow.setIgnoreMouseEvents(false);
  }
});

// ── App lifecycle ──────────────────────────────────────
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

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (isSphereMode) {
      restoreFromSphere();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
