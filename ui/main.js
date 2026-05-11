const { app, BrowserWindow, ipcMain, session, screen, globalShortcut, systemPreferences } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const USERSPACE_HOST = process.env.USERSPACE_HOST || '127.0.0.1';
const USERSPACE_PORT = Number(process.env.USERSPACE_PORT || '8765');
const AUTH_API_BASE = (process.env.AUTH_API_BASE || 'http://127.0.0.1:8001').replace(/\/+$/, '');
const USERSPACE_WS_URL = process.env.USERSPACE_WS_URL || `ws://${USERSPACE_HOST}:${USERSPACE_PORT}/ws`;
const USERSPACE_WS_AUTH_DISABLED =
  String(process.env.JARVIS_USERSPACE_AUTH_DISABLED || '').toLowerCase();
const USERSPACE_WS_AUTH_DISABLED_BOOL =
  USERSPACE_WS_AUTH_DISABLED === '1' || USERSPACE_WS_AUTH_DISABLED === 'true' || USERSPACE_WS_AUTH_DISABLED === 'yes' || USERSPACE_WS_AUTH_DISABLED === 'on';

app.setName('JARVIS Userspace');
app.setPath('userData', path.join(app.getPath('appData'), 'JARVIS Userspace'));

const SPHERE_SIZE = 100;
const SPHERE_MARGIN = 24;
const SPHERE_WINDOW_W = 560; // wide enough for speech bubble
const SPHERE_WINDOW_H = 160;
let mainWindow = null;
let lastSphereBounds = null; // 아이콘 모드의 마지막 위치 저장
let isSphereMode = false;
const activeTtsStreams = new Map();
let gptSovitsRuntime = {
  child: null,
  key: '',
  config: null,
  externallyManaged: false,
  starting: null,
};

function requestMacOSActionPermissions() {
  if (process.platform !== 'darwin') return;

  try {
    const trusted = systemPreferences.isTrustedAccessibilityClient(true);
    process.stdout.write(`[permissions] accessibility trusted=${trusted}\n`);
  } catch (err) {
    process.stderr.write(`[permissions] accessibility prompt failed: ${String(err)}\n`);
  }

  const probe = spawn('osascript', [
    '-e',
    'tell application "System Events" to get name of first process',
  ], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  let stderr = '';
  probe.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  probe.on('close', (code) => {
    if (code === 0) {
      process.stdout.write('[permissions] automation probe succeeded\n');
      return;
    }
    process.stderr.write(`[permissions] automation probe failed rc=${code}: ${stderr.trim()}\n`);
  });
  probe.on('error', (err) => {
    process.stderr.write(`[permissions] automation probe error: ${String(err)}\n`);
  });
}

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
      partition: 'persist:jarvis-userspace',
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

  isSphereMode = true;

  const display = screen.getDisplayMatching(mainWindow.getBounds());
  const workArea = display.workArea;

  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setResizable(false);
  mainWindow.setHasShadow(false);
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  }

  if (lastSphereBounds) {
    // 마지막으로 드래그해서 놓은 위치가 있으면 그 위치로 이동
    mainWindow.setBounds(lastSphereBounds, true);
  } else {
    // 없으면 기본 위치(우측 상단)로 이동
    mainWindow.setBounds({
      x: workArea.x + workArea.width - SPHERE_WINDOW_W - SPHERE_MARGIN,
      y: workArea.y + SPHERE_MARGIN,
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
  mainWindow.maximize();

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
    authDisabled: USERSPACE_WS_AUTH_DISABLED_BOOL,
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
  if (!['chatterbox', 'vibevoice', 'gpt-sovits'].includes(provider) && !apiKey) return { ok: false, error: 'missing api key' };

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
    } else if (provider === 'vibevoice') {
      return await synthesizeVibeVoice({
        text,
        model: model || 'microsoft/VibeVoice-Realtime-0.5B',
        voiceId: voiceId || 'Carter',
        voicePresetPath: String(payload.audioPromptPath || '').trim(),
        cfgScale: Number(payload.cfgWeight ?? 1.5),
      });
    } else if (provider === 'gpt-sovits') {
      return await synthesizeGptSovitsNonStreaming(payload);
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

ipcMain.handle('tts:synthesize-stream', async (event, payload = {}) => {
  const requestId = String(payload.requestId || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const sender = event.sender;
  const sendEvent = (message) => {
    if (!sender.isDestroyed()) {
      sender.send('tts:stream-event', { requestId, ...message });
    }
  };

  const controller = new AbortController();
  activeTtsStreams.set(requestId, controller);

  try {
    const provider = String(payload.provider || '');
    const text = String(payload.text || '').trim();
    if (provider !== 'gpt-sovits') {
      throw new Error(`streaming unsupported provider: ${provider}`);
    }
    if (!text) throw new Error('missing text');

    const config = normalizeGptSovitsConfig(payload);
    await ensureGptSovitsServer(config);

    const response = await fetch(`http://${config.host}:${config.port}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(buildGptSovitsPayload(payload, config, true)),
    });

    if (!response.ok || !response.body) {
      const body = await response.text().catch(() => '');
      throw new Error(body.slice(0, 500) || `GPT-SoVITS HTTP ${response.status}`);
    }

    await streamGptSovitsAudio(response.body, sendEvent, controller.signal);
    sendEvent({ type: 'end' });
    return { ok: true };
  } catch (error) {
    if (controller.signal.aborted) {
      sendEvent({ type: 'end', cancelled: true });
      return { ok: false, cancelled: true };
    }
    const message = error instanceof Error ? error.message : String(error);

    try {
      const fallback = await synthesizeGptSovitsNonStreaming(payload);
      if (fallback?.ok) {
        sendEvent({
          type: 'fallback',
          mimeType: fallback.mimeType,
          audioBase64: fallback.audioBase64,
        });
        sendEvent({ type: 'end' });
        return { ok: true, fallback: true };
      }
    } catch (_) {}

    sendEvent({ type: 'error', error: message });
    return { ok: false, error: message };
  } finally {
    activeTtsStreams.delete(requestId);
  }
});

ipcMain.on('tts:stream-cancel', (event, requestId) => {
  const controller = activeTtsStreams.get(String(requestId || ''));
  if (controller) controller.abort();
});

function normalizeGptSovitsConfig(payload = {}) {
  const repoPath = String(payload.gptSovitsRepoPath || '').trim();
  const pythonPath = String(payload.gptSovitsPythonPath || process.env.GPT_SOVITS_PYTHON || process.env.PYTHON || 'python3').trim();
  const host = String(payload.gptSovitsHost || '127.0.0.1').trim() || '127.0.0.1';
  const port = Number(payload.gptSovitsPort || 9880);
  const configPath = String(payload.gptSovitsConfigPath || 'GPT_SoVITS/configs/tts_infer.yaml').trim();
  return {
    repoPath,
    pythonPath,
    host,
    port: Number.isFinite(port) ? port : 9880,
    configPath,
  };
}

function buildGptSovitsPayload(payload, config, streaming) {
  return {
    text: String(payload.text || '').trim(),
    text_lang: String(payload.gptSovitsTextLanguage || payload.language || 'ko').trim().toLowerCase() || 'ko',
    ref_audio_path: String(payload.audioPromptPath || '').trim(),
    prompt_text: String(payload.gptSovitsPromptText || '').trim(),
    prompt_lang: String(payload.gptSovitsPromptLanguage || payload.language || 'ko').trim().toLowerCase() || 'ko',
    top_k: clampNumber(payload.gptSovitsTopK, 1, 50, 15),
    top_p: clampNumber(payload.gptSovitsTopP, 0.1, 1, 1),
    temperature: clampNumber(payload.gptSovitsTemperature, 0.1, 1.5, 1),
    text_split_method: 'cut5',
    batch_size: 1,
    batch_threshold: 0.75,
    split_bucket: true,
    speed_factor: clampNumber(payload.gptSovitsSpeedFactor, 0.6, 1.6, 1),
    fragment_interval: 0.3,
    seed: -1,
    media_type: 'wav',
    streaming_mode: streaming ? clampNumber(payload.gptSovitsStreamingMode, 0, 3, 3) : 0,
    parallel_infer: true,
    repetition_penalty: 1.35,
    sample_steps: 32,
    super_sampling: false,
    overlap_length: 2,
    min_chunk_length: 16,
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

async function ensureGptSovitsServer(config) {
  const key = `${config.repoPath}|${config.pythonPath}|${config.host}|${config.port}|${config.configPath}`;
  if (await isGptSovitsAlive(config)) {
    gptSovitsRuntime.key = key;
    gptSovitsRuntime.config = config;
    gptSovitsRuntime.externallyManaged = !gptSovitsRuntime.child;
    return;
  }

  if (gptSovitsRuntime.starting && gptSovitsRuntime.key === key) {
    await gptSovitsRuntime.starting;
    return;
  }

  if (!config.repoPath) {
    throw new Error('GPT-SoVITS repo path is required');
  }

  const apiPath = path.join(config.repoPath, 'api_v2.py');
  if (!fs.existsSync(apiPath)) {
    throw new Error(`GPT-SoVITS api_v2.py not found: ${apiPath}`);
  }

  if (gptSovitsRuntime.child && gptSovitsRuntime.key !== key) {
    shutdownGptSovitsServer();
  }

  gptSovitsRuntime.key = key;
  gptSovitsRuntime.config = config;
  gptSovitsRuntime.externallyManaged = false;
  gptSovitsRuntime.starting = startGptSovitsServer(config, apiPath);
  try {
    await gptSovitsRuntime.starting;
  } finally {
    gptSovitsRuntime.starting = null;
  }
}

function startGptSovitsServer(config, apiPath) {
  return new Promise((resolve, reject) => {
    const configPath = path.isAbsolute(config.configPath)
      ? config.configPath
      : path.join(config.repoPath, config.configPath);
    const child = spawn(config.pythonPath, [
      apiPath,
      '-a',
      config.host,
      '-p',
      String(config.port),
      '-c',
      configPath,
    ], {
      cwd: config.repoPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    gptSovitsRuntime.child = child;
    child.stdout.on('data', (chunk) => process.stdout.write(`[gpt-sovits] ${chunk}`));
    child.stderr.on('data', (chunk) => process.stderr.write(`[gpt-sovits] ${chunk}`));
    child.on('exit', (code, signal) => {
      if (gptSovitsRuntime.child === child) {
        gptSovitsRuntime.child = null;
      }
      process.stderr.write(`[gpt-sovits] exited code=${code} signal=${signal}\n`);
    });
    child.on('error', reject);

    waitForGptSovits(config, 120000).then(resolve, (error) => {
      try { child.kill(); } catch (_) {}
      reject(error);
    });
  });
}

async function waitForGptSovits(config, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isGptSovitsAlive(config)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Timed out waiting for GPT-SoVITS server');
}

async function isGptSovitsAlive(config) {
  try {
    const response = await fetch(`http://${config.host}:${config.port}/control?command=__jarvis_probe`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.status === 200 || response.status === 400;
  } catch (_) {
    return false;
  }
}

async function synthesizeGptSovitsNonStreaming(payload = {}) {
  const config = normalizeGptSovitsConfig(payload);
  await ensureGptSovitsServer(config);
  const response = await fetch(`http://${config.host}:${config.port}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify(buildGptSovitsPayload(payload, config, false)),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    return { ok: false, error: body.slice(0, 500) || `GPT-SoVITS HTTP ${response.status}` };
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    ok: true,
    mimeType: response.headers.get('content-type') || 'audio/wav',
    audioBase64: bytes.toString('base64'),
  };
}

async function streamGptSovitsAudio(body, sendEvent, signal) {
  const reader = body.getReader();
  let header = null;
  let pending = Buffer.alloc(0);

  while (true) {
    if (signal.aborted) throw new Error('cancelled');
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) continue;

    pending = Buffer.concat([pending, Buffer.from(value)]);
    if (!header) {
      header = parseWavHeader(pending);
      if (!header) continue;
      if (header.bitsPerSample !== 16) {
        throw new Error(`Unsupported GPT-SoVITS WAV bit depth: ${header.bitsPerSample}`);
      }
      sendEvent({
        type: 'start',
        sampleRate: header.sampleRate,
        channels: header.channels,
        bitsPerSample: header.bitsPerSample,
      });
      pending = pending.subarray(header.dataOffset);
    }

    if (pending.length > 0) {
      sendEvent({ type: 'chunk', audioBase64: pending.toString('base64') });
      pending = Buffer.alloc(0);
    }
  }
}

function parseWavHeader(buffer) {
  if (buffer.length < 44) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('GPT-SoVITS returned non-WAV streaming audio');
  }

  let offset = 12;
  let channels = 1;
  let sampleRate = 32000;
  let bitsPerSample = 16;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;
    if (chunkDataOffset + chunkSize > buffer.length) return null;

    if (chunkId === 'fmt ') {
      channels = buffer.readUInt16LE(chunkDataOffset + 2);
      sampleRate = buffer.readUInt32LE(chunkDataOffset + 4);
      bitsPerSample = buffer.readUInt16LE(chunkDataOffset + 14);
    } else if (chunkId === 'data') {
      return { channels, sampleRate, bitsPerSample, dataOffset: chunkDataOffset };
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }
  return null;
}

function shutdownGptSovitsServer() {
  const child = gptSovitsRuntime.child;
  if (!child) return;
  const config = gptSovitsRuntime.config;
  gptSovitsRuntime.child = null;
  if (config) {
    fetch(`http://${config.host}:${config.port}/control?command=exit`).catch(() => {});
  }
  setTimeout(() => {
    if (!child.killed) {
      try { child.kill(); } catch (_) {}
    }
  }, 1500);
  try {
    child.kill('SIGTERM');
  } catch (_) {}
}

function synthesizeVibeVoice(options) {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'vibevoice_realtime_tts.py');
    const outputPath = path.join(os.tmpdir(), `jarvis-vibevoice-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`);
    const cacheRoot = path.join(__dirname, '..', '.cache');
    const python = process.env.VIBEVOICE_PYTHON || process.env.PYTHON || 'python3';
    const child = spawn(python, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        HF_HOME: process.env.HF_HOME || path.join(cacheRoot, 'huggingface'),
        TORCH_HOME: process.env.TORCH_HOME || path.join(cacheRoot, 'torch'),
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
          error: stderr.trim() || stdout.trim() || `VibeVoice exited with ${code}`,
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
  requestMacOSActionPermissions();

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
  for (const controller of activeTtsStreams.values()) {
    controller.abort();
  }
  activeTtsStreams.clear();
  shutdownGptSovitsServer();
  globalShortcut.unregisterAll();
});
