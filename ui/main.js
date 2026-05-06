const { app, BrowserWindow, ipcMain, session, screen, globalShortcut } = require('electron');
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
let lastSphereBounds = null; // 아이콘 모드의 마지막 위치 저장
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

  // 창 이동 시 위치 저장 (아이콘 모드일 때만)
  win.on('move', () => {
    if (isSphereMode && mainWindow) {
      lastSphereBounds = mainWindow.getBounds();
    }
  });

  // Pipe renderer console to terminal (safely)
// ... (이하 동일)
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

  if (lastSphereBounds) {
    // 마지막으로 드래그해서 놓은 위치가 있으면 그 위치로 이동
    mainWindow.setBounds(lastSphereBounds, true);
  } else {
    // 없으면 기본 위치(우측 상단)로 이동
    mainWindow.setBounds({
      x: screenW - SPHERE_WINDOW_W - SPHERE_MARGIN,
      y: SPHERE_MARGIN,
      width: SPHERE_WINDOW_W,
      height: SPHERE_WINDOW_H,
    }, true);
  }

  if (process.platform === 'darwin') {
    mainWindow.setWindowButtonVisibility(false);
  }

  // Wait a tick for resize to settle, then tell renderer sphere is ready
  setTimeout(() => {
    if (mainWindow) mainWindow.webContents.send('window:sphere-ready');
  }, 50);
}

function restoreFromSphere(text) {
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
    if (mainWindow) mainWindow.webContents.send('window:restore-from-sphere', text);
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

// Window control IPCs
ipcMain.on('window:minimize', () => {
  if (mainWindow) {
    mainWindow.webContents.send('window:minimize-to-sphere');
  }
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

// 수동 드래그를 위한 IPC 핸들러: 렌더러에서 계산된 좌표로 창 위치 이동
ipcMain.on('window:move', (event, { x, y, width, height }) => {
  if (mainWindow) {
    mainWindow.setBounds({ x, y, width, height });
  }
});

ipcMain.handle('window:get-bounds', async () => {
  if (mainWindow) return mainWindow.getBounds();
  return null;
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

  // 전역 단축키 등록: Alt+Shift+P
  // 다른 프로그램을 사용 중일 때도 해당 키를 누르면 앱이 반응합니다.
  globalShortcut.register('Alt+Shift+P', () => {
    if (mainWindow) {
      if (isSphereMode) {
        // 아이콘 모드일 경우 원래 크기로 복구하며 인사말 전달
        restoreFromSphere('무슨 일이신가요?');
      } else {
        // 이미 큰 상태일 경우 아이콘 모드로 전환 (토글 기능)
        mainWindow.webContents.send('window:minimize-to-sphere');
      }
    }
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

// 앱 종료 시 모든 전역 단축키 해제 (메모리 누수 및 단축키 충돌 방지)
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
