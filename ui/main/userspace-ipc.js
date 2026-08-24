function envFlag(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function resolveUserspaceConfig(env = process.env) {
  const host = env.USERSPACE_HOST || '127.0.0.1';
  const port = Number(env.USERSPACE_PORT || '8765');
  const authApiBase = (env.AUTH_API_BASE || 'http://127.0.0.1:8001').replace(/\/+$/, '');
  return {
    host,
    port,
    baseUrl: `http://${host}:${port}`,
    authApiBase,
    googleClientId: env.GOOGLE_CLIENT_ID || env.JARVIS_GOOGLE_CLIENT_ID || '',
    wsUrl: env.USERSPACE_WS_URL || `ws://${host}:${port}/ws`,
    authDisabled: envFlag(env.JARVIS_USERSPACE_AUTH_DISABLED),
  };
}

function registerUserspaceIpc(ipcMain, { env = process.env, fetchImpl = fetch } = {}) {
  const config = resolveUserspaceConfig(env);
  ipcMain.handle('userspace:get-config', async () => ({ ...config }));
  ipcMain.handle('userspace:health', async () => {
    try {
      const response = await fetchImpl(`${config.baseUrl}/health`);
      if (!response.ok) return { ok: false, status: response.status, data: null };
      return { ok: true, status: response.status, data: await response.json() };
    } catch (error) {
      return { ok: false, status: 0, error: String(error) };
    }
  });
  return config;
}

module.exports = { envFlag, registerUserspaceIpc, resolveUserspaceConfig };
