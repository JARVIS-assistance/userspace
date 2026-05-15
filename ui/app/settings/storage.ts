import {
    DEFAULT_CAMERA,
    DEFAULT_MODEL_SELECTION,
    DEFAULT_PERSONA,
    DEFAULT_TTS,
    DEFAULT_VISUAL,
    DEFAULT_WAKEWORD,
    type ModelConfig,
    type ModelSelection,
    type TtsConfig,
    type SettingsData,
    type WakewordConfig,
} from "./types";

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
                models: Array.isArray(parsed.models)
                    ? parsed.models.map(normalizeModelConfig)
                    : [],
                modelSelection: normalizeModelSelection({
                    ...DEFAULT_MODEL_SELECTION,
                    ...(parsed.modelSelection || {}),
                }),
                persona: { ...DEFAULT_PERSONA, ...(parsed.persona || {}) },
                tts: normalizeTtsConfig({ ...DEFAULT_TTS, ...(parsed.tts || {}) }),
                visual: { ...DEFAULT_VISUAL, ...(parsed.visual || {}) },
                camera: { ...DEFAULT_CAMERA, ...(parsed.camera || {}) },
                wakeword: normalizeWakewordConfig({
                    ...DEFAULT_WAKEWORD,
                    ...(parsed.wakeword || {}),
                }),
            };
        }
    } catch (_) {}
    return {
        models: [],
        modelSelection: DEFAULT_MODEL_SELECTION,
        persona: DEFAULT_PERSONA,
        tts: DEFAULT_TTS,
        visual: DEFAULT_VISUAL,
        camera: DEFAULT_CAMERA,
        wakeword: DEFAULT_WAKEWORD,
    };
}

export function saveLocal(data: SettingsData) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function normalizeModelSelection(selection: ModelSelection): ModelSelection {
    return {
        realtime_model_config_id: selection.realtime_model_config_id || null,
        deep_model_config_id: selection.deep_model_config_id || null,
    };
}

function normalizeModelConfig(config: ModelConfig): ModelConfig {
    return {
        ...config,
        is_active: config.is_active ?? true,
        supports_stream: config.supports_stream ?? true,
        supports_realtime: config.supports_realtime ?? false,
    };
}

function normalizeTtsConfig(config: TtsConfig): TtsConfig {
    if (config.provider === "qwen3-realtime" && !config.apiKey?.trim()) {
        return {
            ...config,
            provider: "qwen3-local",
            model: "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit",
            voiceId: "Chelsie",
        };
    }
    return config;
}

function normalizeWakewordConfig(config: WakewordConfig): WakewordConfig {
    const requiredSamples = Number.isFinite(config.requiredSamples)
        ? Math.max(1, Math.round(config.requiredSamples))
        : DEFAULT_WAKEWORD.requiredSamples;
    const threshold = Number.isFinite(config.threshold)
        ? Math.min(2, Math.max(0.05, config.threshold))
        : DEFAULT_WAKEWORD.threshold;
    const samples = Array.isArray(config.samples)
        ? config.samples.filter((sample) =>
              sample
              && typeof sample.id === "string"
              && Array.isArray(sample.fingerprint)
          )
        : [];
    return {
        ...config,
        phraseLabel: config.phraseLabel?.trim() || DEFAULT_WAKEWORD.phraseLabel,
        requiredSamples,
        threshold,
        samples,
    };
}
