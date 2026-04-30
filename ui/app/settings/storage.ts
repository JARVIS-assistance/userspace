import { DEFAULT_PERSONA, DEFAULT_TTS, type SettingsData } from "./types";

const STORAGE_KEY = "jarvis_settings";

export async function resolveApiBase(): Promise<string> {
    const bridge = (window as any).jarvisBridge;
    if (!bridge?.getUserspaceConfig) {
        throw new Error("Userspace config bridge is unavailable");
    }

    const config = await bridge.getUserspaceConfig();
    const candidate =
        typeof config?.authApiBase === "string" ? config.authApiBase.trim() : "";
    if (!candidate) {
        throw new Error("AUTH_API_BASE is not configured");
    }

    return candidate.replace(/\/+$/, "");
}

export function loadLocal(): SettingsData {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            return {
                models: Array.isArray(parsed.models) ? parsed.models : [],
                persona: { ...DEFAULT_PERSONA, ...(parsed.persona || {}) },
                tts: { ...DEFAULT_TTS, ...(parsed.tts || {}) },
            };
        }
    } catch (_) {}
    return { models: [], persona: DEFAULT_PERSONA, tts: DEFAULT_TTS };
}

export function saveLocal(data: SettingsData) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
