export interface ModelConfig {
    id?: string;
    provider_mode: "token" | "local";
    provider_name: string;
    model_name: string;
    api_key?: string;
    endpoint?: string;
    is_default: boolean;
    supports_stream: boolean;
    supports_realtime: boolean;
    transport: "http_sse" | "websocket";
    input_modalities: string;
    output_modalities: string;
}

export interface Persona {
    icon: string;
    name: string;
    description: string;
}

export interface TtsConfig {
    enabled: boolean;
    provider: "browser" | "chatterbox" | "elevenlabs" | "openai";
    voiceURI: string;
    apiKey: string;
    voiceId: string;
    model: string;
    language: string;
    audioPromptPath: string;
    exaggeration: number;
    cfgWeight: number;
    rate: number;
    pitch: number;
    volume: number;
}

export interface SettingsData {
    models: ModelConfig[];
    persona: Persona;
    tts: TtsConfig;
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
};

export const DEFAULT_TTS: TtsConfig = {
    enabled: false,
    provider: "chatterbox",
    voiceURI: "",
    apiKey: "",
    voiceId: "",
    model: "multilingual",
    language: "ko",
    audioPromptPath: "",
    exaggeration: 0.5,
    cfgWeight: 0.5,
    rate: 1,
    pitch: 1,
    volume: 1,
};

export const EMPTY_MODEL: ModelConfig = {
    provider_mode: "local",
    provider_name: "",
    model_name: "",
    api_key: "",
    endpoint: "",
    is_default: false,
    supports_stream: true,
    supports_realtime: false,
    transport: "http_sse",
    input_modalities: "text",
    output_modalities: "text",
};
