export interface ModelConfig {
    id?: string;
    provider_mode: "token" | "local";
    provider_name: string;
    model_name: string;
    api_key?: string;
    endpoint?: string;
    is_active: boolean;
    is_default: boolean;
    supports_stream: boolean;
    supports_realtime: boolean;
    transport: "http_sse" | "websocket";
    input_modalities: string;
    output_modalities: string;
}

export interface ModelSelection {
    realtime_model_config_id?: string | null;
    deep_model_config_id?: string | null;
}

export interface Persona {
    user_persona_id?: string;
    icon: string;
    name: string;
    description: string;
    prompt_template: string;
    tone: string;
    alias: string;
    selected?: boolean;
}

export interface TtsConfig {
    enabled: boolean;
    provider:
        | "browser"
        | "qwen3-local"
        | "chatterbox"
        | "vibevoice"
        | "gpt-sovits"
        | "qwen3-realtime"
        | "elevenlabs"
        | "openai";
    voiceURI: string;
    apiKey: string;
    voiceId: string;
    model: string;
    language: string;
    audioPromptPath: string;
    gptSovitsRepoPath: string;
    gptSovitsPythonPath: string;
    gptSovitsHost: string;
    gptSovitsPort: number;
    gptSovitsConfigPath: string;
    gptSovitsPromptText: string;
    gptSovitsTextLanguage: string;
    gptSovitsPromptLanguage: string;
    gptSovitsStreamingMode: number;
    gptSovitsSpeedFactor: number;
    gptSovitsTopK: number;
    gptSovitsTopP: number;
    gptSovitsTemperature: number;
    qwen3Region: "international" | "china";
    qwen3LocalPythonPath: string;
    qwen3LanguageType: string;
    qwen3Instructions: string;
    qwen3SampleRate: number;
    exaggeration: number;
    cfgWeight: number;
    rate: number;
    pitch: number;
    volume: number;
}

export interface VisualConfig {
    particleDensity: number;
}

export interface CameraConfig {
    enabled: boolean;
    deviceId: string;
    label: string;
    preferPhysical: boolean;
}

export interface WakewordSample {
    id: string;
    createdAt: number;
    durationMs: number;
    fingerprint: number[][];
}

export interface WakewordConfig {
    enabled: boolean;
    phraseLabel: string;
    requiredSamples: number;
    threshold: number;
    samples: WakewordSample[];
}

export interface SettingsData {
    models: ModelConfig[];
    modelSelection: ModelSelection;
    persona: Persona;
    tts: TtsConfig;
    visual: VisualConfig;
    camera: CameraConfig;
    wakeword: WakewordConfig;
}

export const PERSONA_ICONS = [
    "\u{1F916}",
    "\u{1F9E0}",
    "\u26A1",
    "\u{1F6E1}\uFE0F",
    "\u{1F52E}",
    "\u{1F3AF}",
    "\u{1F48E}",
    "\u{1F31F}",
    "\u{1F9BE}",
    "\u{1F47E}",
];

export const DEFAULT_PERSONA: Persona = {
    icon: "\u{1F916}",
    name: "J.A.R.V.I.S",
    description: "Just A Rather Very Intelligent System",
    prompt_template: "친절하고 간결하게 답해.",
    tone: "neutral",
    alias: "jarvis",
    selected: true,
};

export const DEFAULT_MODEL_SELECTION: ModelSelection = {
    realtime_model_config_id: null,
    deep_model_config_id: null,
};

export const DEFAULT_TTS: TtsConfig = {
    enabled: false,
    provider: "qwen3-local",
    voiceURI: "",
    apiKey: "",
    voiceId: "Chelsie",
    model: "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit",
    language: "ko",
    audioPromptPath: "",
    gptSovitsRepoPath: "",
    gptSovitsPythonPath: "",
    gptSovitsHost: "127.0.0.1",
    gptSovitsPort: 9880,
    gptSovitsConfigPath: "GPT_SoVITS/configs/tts_infer.yaml",
    gptSovitsPromptText: "",
    gptSovitsTextLanguage: "ko",
    gptSovitsPromptLanguage: "ko",
    gptSovitsStreamingMode: 3,
    gptSovitsSpeedFactor: 1,
    gptSovitsTopK: 15,
    gptSovitsTopP: 1,
    gptSovitsTemperature: 1,
    qwen3Region: "international",
    qwen3LocalPythonPath: "",
    qwen3LanguageType: "Korean",
    qwen3Instructions: "calm Korean assistant voice, concise and warm",
    qwen3SampleRate: 24000,
    exaggeration: 0.5,
    cfgWeight: 0.5,
    rate: 1,
    pitch: 1,
    volume: 1,
};

export const DEFAULT_VISUAL: VisualConfig = {
    particleDensity: 1,
};

export const DEFAULT_CAMERA: CameraConfig = {
    enabled: false,
    deviceId: "",
    label: "",
    preferPhysical: true,
};

export const DEFAULT_WAKEWORD: WakewordConfig = {
    enabled: false,
    phraseLabel: "Jarvis",
    requiredSamples: 3,
    threshold: 0.28,
    samples: [],
};

export const EMPTY_MODEL: ModelConfig = {
    provider_mode: "local",
    provider_name: "",
    model_name: "",
    api_key: "",
    endpoint: "",
    is_active: true,
    is_default: false,
    supports_stream: true,
    supports_realtime: false,
    transport: "http_sse",
    input_modalities: "text",
    output_modalities: "text",
};
