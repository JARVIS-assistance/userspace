import { useEffect, useMemo, useState } from "react";
import { css } from "./styles";
import type { TtsConfig } from "./types";

const QWEN3_LOCAL_VOICES = [
    "Chelsie",
    "Ethan",
    "Serena",
    "Vivian",
    "Ryan",
    "Aiden",
    "Eric",
    "Dylan",
];

const QWEN3_CLOUD_VOICES = [
    "Cherry",
    "Ethan",
    "Chelsie",
    "Serena",
    "Vivian",
    "Ryan",
    "Aiden",
    "Eric",
    "Dylan",
];

interface Props {
    config: TtsConfig;
    onChange: (patch: Partial<TtsConfig>) => void;
}

export default function TtsTab({ config, onChange }: Props) {
    const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
    const [previewBusy, setPreviewBusy] = useState(false);
    const [previewError, setPreviewError] = useState<string | null>(null);

    useEffect(() => {
        if (!("speechSynthesis" in window)) return;

        const refresh = () => setVoices(window.speechSynthesis.getVoices());
        refresh();
        window.speechSynthesis.addEventListener("voiceschanged", refresh);
        return () => {
            window.speechSynthesis.removeEventListener("voiceschanged", refresh);
        };
    }, []);

    const selectedVoice = useMemo(
        () => voices.find((voice) => voice.voiceURI === config.voiceURI),
        [config.voiceURI, voices],
    );

    const preview = async () => {
        if (previewBusy) return;
        setPreviewBusy(true);
        setPreviewError(null);
        const text = "안녕하세요. 자비스 음성 응답 테스트입니다.";
        try {
            if (config.provider === "browser") {
                if (!("speechSynthesis" in window)) {
                    throw new Error("브라우저 TTS를 사용할 수 없습니다.");
                }
                window.speechSynthesis.cancel();
                const utterance = new SpeechSynthesisUtterance(text);
                if (selectedVoice) utterance.voice = selectedVoice;
                utterance.lang = selectedVoice?.lang || "ko-KR";
                utterance.rate = config.rate;
                utterance.pitch = config.pitch;
                utterance.volume = config.volume;
                await new Promise<void>((resolve, reject) => {
                    utterance.onend = () => resolve();
                    utterance.onerror = (event) => reject(new Error(String(event.error || "speech synthesis failed")));
                    window.speechSynthesis.speak(utterance);
                });
                return;
            }

            if (isStreamingProvider(config.provider)) {
                await playPreviewStream(config, text);
                return;
            }

            const bridge = (window as any).jarvisBridge;
            if (!bridge?.synthesizeTts) {
                throw new Error("TTS bridge를 사용할 수 없습니다.");
            }
            const result = await bridge.synthesizeTts(ttsPayload(config, text));
            if (!result?.ok || !result.audioBase64) {
                throw new Error(String(result?.error || "preview synthesis failed"));
            }
            await playAudioBase64(
                result.audioBase64,
                result.mimeType || "audio/wav",
                config.volume,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn("[TTS] preview failed", message);
            setPreviewError(message);
        } finally {
            setPreviewBusy(false);
        }
    };

    const supported = "speechSynthesis" in window;

    return (
        <div>
            <div style={{ marginBottom: 18 }}>
                <label style={css.label}>VOICE RESPONSE</label>
                <button
                    style={css.btn(config.enabled ? "primary" : "ghost")}
                    onClick={() => onChange({ enabled: !config.enabled })}
                    disabled={config.provider === "browser" && !supported}
                >
                    {config.enabled ? "ENABLED" : "DISABLED"}
                </button>
            </div>

            <div style={{ marginBottom: 16 }}>
                <label style={css.label}>PROVIDER</label>
                <select
                    style={css.select}
                    value={config.provider}
                    onChange={(e) => {
                        const provider = e.target.value as TtsConfig["provider"];
                        onChange({
                            provider,
                            model: defaultModel(provider),
                            voiceId: defaultVoice(provider),
                        });
                    }}
                >
                    <optgroup label="Local / Free">
                        <option value="qwen3-local">Qwen3 Local MLX</option>
                        <option value="browser">Browser / System TTS</option>
                        <option value="chatterbox">Chatterbox-TTS Local</option>
                        <option value="vibevoice">VibeVoice Realtime Local</option>
                        <option value="gpt-sovits">GPT-SoVITS Local</option>
                    </optgroup>
                    <optgroup label="Cloud / Paid">
                        <option value="qwen3-realtime">Qwen3 Realtime Cloud</option>
                        <option value="elevenlabs">ElevenLabs</option>
                        <option value="openai">OpenAI</option>
                    </optgroup>
                </select>
            </div>

            {config.provider === "browser" ? (
                <div style={{ marginBottom: 16 }}>
                    <label style={css.label}>VOICE</label>
                    <select
                        style={css.select}
                        value={config.voiceURI}
                        onChange={(e) => onChange({ voiceURI: e.target.value })}
                        disabled={!supported || voices.length === 0}
                    >
                        <option value="">System default</option>
                        {voices.map((voice) => (
                            <option key={voice.voiceURI} value={voice.voiceURI}>
                                {voice.name} ({voice.lang})
                            </option>
                        ))}
                    </select>
                </div>
            ) : config.provider === "chatterbox" ? (
                <ChatterboxFields config={config} onChange={onChange} />
            ) : config.provider === "vibevoice" ? (
                <VibeVoiceFields config={config} onChange={onChange} />
            ) : config.provider === "gpt-sovits" ? (
                <GptSovitsFields config={config} onChange={onChange} />
            ) : config.provider === "qwen3-local" ? (
                <Qwen3LocalFields config={config} onChange={onChange} />
            ) : config.provider === "qwen3-realtime" ? (
                <Qwen3RealtimeFields config={config} onChange={onChange} />
            ) : (
                <CommercialFields config={config} onChange={onChange} />
            )}

            <RangeField
                label="RATE"
                value={config.rate}
                min={0.5}
                max={1.6}
                step={0.05}
                onChange={(rate) => onChange({ rate })}
            />
            <RangeField
                label="PITCH"
                value={config.pitch}
                min={0.5}
                max={1.5}
                step={0.05}
                onChange={(pitch) => onChange({ pitch })}
            />
            <RangeField
                label="VOLUME"
                value={config.volume}
                min={0}
                max={1}
                step={0.05}
                onChange={(volume) => onChange({ volume })}
            />

            <button
                style={{ ...css.btn("ghost"), marginTop: 8 }}
                onClick={preview}
                disabled={previewBusy || (config.provider === "browser" && !supported)}
            >
                {previewBusy ? "TESTING..." : "TEST VOICE"}
            </button>
            {previewError && (
                <p
                    role="alert"
                    style={{
                        margin: "8px 0 0",
                        color: "rgba(220,110,90,0.9)",
                        fontSize: 12,
                        lineHeight: 1.45,
                        wordBreak: "break-word",
                    }}
                >
                    {previewError}
                </p>
            )}
        </div>
    );
}

function GptSovitsFields({
    config,
    onChange,
}: {
    config: TtsConfig;
    onChange: (patch: Partial<TtsConfig>) => void;
}) {
    return (
        <>
            <div style={{ marginBottom: 16 }}>
                <label style={css.label}>GPT-SOVITS REPO PATH</label>
                <input
                    style={css.input}
                    value={config.gptSovitsRepoPath}
                    onChange={(e) => onChange({ gptSovitsRepoPath: e.target.value })}
                    placeholder="/absolute/path/to/GPT-SoVITS"
                />
            </div>
            <div style={css.row}>
                <div style={css.half}>
                    <label style={css.label}>PYTHON PATH</label>
                    <input
                        style={css.input}
                        value={config.gptSovitsPythonPath}
                        onChange={(e) => onChange({ gptSovitsPythonPath: e.target.value })}
                        placeholder="python3 or /path/to/venv/bin/python"
                    />
                </div>
                <div style={css.half}>
                    <label style={css.label}>TTS CONFIG</label>
                    <input
                        style={css.input}
                        value={config.gptSovitsConfigPath}
                        onChange={(e) => onChange({ gptSovitsConfigPath: e.target.value })}
                        placeholder="GPT_SoVITS/configs/tts_infer.yaml"
                    />
                </div>
            </div>
            <div style={css.row}>
                <div style={css.half}>
                    <label style={css.label}>HOST</label>
                    <input
                        style={css.input}
                        value={config.gptSovitsHost}
                        onChange={(e) => onChange({ gptSovitsHost: e.target.value })}
                        placeholder="127.0.0.1"
                    />
                </div>
                <div style={css.half}>
                    <label style={css.label}>PORT</label>
                    <input
                        style={css.input}
                        type="number"
                        value={config.gptSovitsPort}
                        onChange={(e) => onChange({ gptSovitsPort: Number(e.target.value) })}
                        placeholder="9880"
                    />
                </div>
            </div>
            <div style={{ marginBottom: 16 }}>
                <label style={css.label}>REFERENCE AUDIO PATH</label>
                <input
                    style={css.input}
                    value={config.audioPromptPath}
                    onChange={(e) => onChange({ audioPromptPath: e.target.value })}
                    placeholder="/absolute/path/to/reference.wav"
                />
            </div>
            <div style={{ marginBottom: 16 }}>
                <label style={css.label}>REFERENCE PROMPT TEXT</label>
                <textarea
                    style={{ ...css.input, minHeight: 64, resize: "vertical" }}
                    value={config.gptSovitsPromptText}
                    onChange={(e) => onChange({ gptSovitsPromptText: e.target.value })}
                    placeholder="Reference audio transcript"
                />
            </div>
            <div style={css.row}>
                <div style={css.half}>
                    <label style={css.label}>TEXT LANGUAGE</label>
                    <input
                        style={css.input}
                        value={config.gptSovitsTextLanguage}
                        onChange={(e) => onChange({ gptSovitsTextLanguage: e.target.value })}
                        placeholder="ko"
                    />
                </div>
                <div style={css.half}>
                    <label style={css.label}>PROMPT LANGUAGE</label>
                    <input
                        style={css.input}
                        value={config.gptSovitsPromptLanguage}
                        onChange={(e) => onChange({ gptSovitsPromptLanguage: e.target.value })}
                        placeholder="ko"
                    />
                </div>
            </div>
            <div style={css.row}>
                <div style={css.half}>
                    <label style={css.label}>STREAMING MODE</label>
                    <select
                        style={css.select}
                        value={config.gptSovitsStreamingMode}
                        onChange={(e) => onChange({ gptSovitsStreamingMode: Number(e.target.value) })}
                    >
                        <option value={3}>3 - Fastest</option>
                        <option value={2}>2 - Balanced</option>
                        <option value={1}>1 - Quality fragments</option>
                        <option value={0}>0 - Non-stream fallback</option>
                    </select>
                </div>
                <div style={css.half}>
                    <RangeField
                        label="SPEED"
                        value={config.gptSovitsSpeedFactor}
                        min={0.6}
                        max={1.6}
                        step={0.05}
                        onChange={(gptSovitsSpeedFactor) => onChange({ gptSovitsSpeedFactor })}
                    />
                </div>
            </div>
            <RangeField
                label="TOP K"
                value={config.gptSovitsTopK}
                min={1}
                max={50}
                step={1}
                onChange={(gptSovitsTopK) => onChange({ gptSovitsTopK })}
            />
            <RangeField
                label="TOP P"
                value={config.gptSovitsTopP}
                min={0.1}
                max={1}
                step={0.05}
                onChange={(gptSovitsTopP) => onChange({ gptSovitsTopP })}
            />
            <RangeField
                label="TEMPERATURE"
                value={config.gptSovitsTemperature}
                min={0.1}
                max={1.5}
                step={0.05}
                onChange={(gptSovitsTemperature) => onChange({ gptSovitsTemperature })}
            />
        </>
    );
}

function ChatterboxFields({
    config,
    onChange,
}: {
    config: TtsConfig;
    onChange: (patch: Partial<TtsConfig>) => void;
}) {
    return (
        <>
            <div style={css.row}>
                <div style={css.half}>
                    <label style={css.label}>MODEL</label>
                    <select
                        style={css.select}
                        value={config.model}
                        onChange={(e) => onChange({ model: e.target.value })}
                    >
                        <option value="multilingual">Multilingual</option>
                        <option value="turbo">Turbo</option>
                        <option value="english">English</option>
                    </select>
                </div>
                <div style={css.half}>
                    <label style={css.label}>LANGUAGE</label>
                    <input
                        style={css.input}
                        value={config.language}
                        onChange={(e) => onChange({ language: e.target.value })}
                        placeholder="ko"
                    />
                </div>
            </div>
            <div style={{ marginBottom: 16 }}>
                <label style={css.label}>REFERENCE AUDIO PATH</label>
                <input
                    style={css.input}
                    value={config.audioPromptPath}
                    onChange={(e) => onChange({ audioPromptPath: e.target.value })}
                    placeholder="/absolute/path/to/reference.wav"
                />
            </div>
            <RangeField
                label="EXAGGERATION"
                value={config.exaggeration}
                min={0}
                max={1.2}
                step={0.05}
                onChange={(exaggeration) => onChange({ exaggeration })}
            />
            <RangeField
                label="CFG WEIGHT"
                value={config.cfgWeight}
                min={0}
                max={1}
                step={0.05}
                onChange={(cfgWeight) => onChange({ cfgWeight })}
            />
        </>
    );
}

function VibeVoiceFields({
    config,
    onChange,
}: {
    config: TtsConfig;
    onChange: (patch: Partial<TtsConfig>) => void;
}) {
    return (
        <>
            <div style={css.row}>
                <div style={css.half}>
                    <label style={css.label}>MODEL</label>
                    <input
                        style={css.input}
                        value={config.model}
                        onChange={(e) => onChange({ model: e.target.value })}
                        placeholder="microsoft/VibeVoice-Realtime-0.5B"
                    />
                </div>
                <div style={css.half}>
                    <label style={css.label}>VOICE</label>
                    <input
                        style={css.input}
                        value={config.voiceId}
                        onChange={(e) => onChange({ voiceId: e.target.value })}
                        placeholder="Carter"
                    />
                </div>
            </div>
            <div style={{ marginBottom: 16 }}>
                <label style={css.label}>VOICE PRESET PATH</label>
                <input
                    style={css.input}
                    value={config.audioPromptPath}
                    onChange={(e) => onChange({ audioPromptPath: e.target.value })}
                    placeholder="/absolute/path/to/voice.pt"
                />
            </div>
            <RangeField
                label="CFG SCALE"
                value={config.cfgWeight}
                min={0.5}
                max={3}
                step={0.1}
                onChange={(cfgWeight) => onChange({ cfgWeight })}
            />
        </>
    );
}

function Qwen3LocalFields({
    config,
    onChange,
}: {
    config: TtsConfig;
    onChange: (patch: Partial<TtsConfig>) => void;
}) {
    return (
        <>
            <div style={{ marginBottom: 16 }}>
                <label style={css.label}>PYTHON PATH</label>
                <input
                    style={css.input}
                    value={config.qwen3LocalPythonPath}
                    onChange={(e) => onChange({ qwen3LocalPythonPath: e.target.value })}
                    placeholder="python3 or /path/to/venv/bin/python"
                />
            </div>
            <div style={css.row}>
                <div style={css.half}>
                    <label style={css.label}>MODEL</label>
                    <input
                        style={css.input}
                        value={config.model}
                        onChange={(e) => onChange({ model: e.target.value })}
                        placeholder="mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit"
                    />
                </div>
                <div style={css.half}>
                    <label style={css.label}>VOICE</label>
                    <select
                        style={css.select}
                        value={config.voiceId}
                        onChange={(e) => onChange({ voiceId: e.target.value })}
                    >
                        {voiceOptions(QWEN3_LOCAL_VOICES, config.voiceId).map((voice) => (
                            <option key={voice} value={voice}>
                                {voice}
                            </option>
                        ))}
                    </select>
                </div>
            </div>
            <div style={{ marginBottom: 16 }}>
                <label style={css.label}>CUSTOM VOICE</label>
                <input
                    style={css.input}
                    value={config.voiceId}
                    onChange={(e) => onChange({ voiceId: e.target.value })}
                    placeholder="Type another Qwen3 speaker name"
                />
            </div>
            <Qwen3SharedFields config={config} onChange={onChange} />
        </>
    );
}

function Qwen3RealtimeFields({
    config,
    onChange,
}: {
    config: TtsConfig;
    onChange: (patch: Partial<TtsConfig>) => void;
}) {
    return (
        <>
            <div style={{ marginBottom: 16 }}>
                <label style={css.label}>API KEY</label>
                <input
                    style={css.input}
                    type="password"
                    value={config.apiKey}
                    onChange={(e) => onChange({ apiKey: e.target.value })}
                    placeholder="DashScope / Alibaba Cloud Model Studio API key"
                />
            </div>
            <div style={{ marginBottom: 16 }}>
                <label style={css.label}>REGION</label>
                <select
                    style={css.select}
                    value={config.qwen3Region}
                    onChange={(e) =>
                        onChange({ qwen3Region: e.target.value as TtsConfig["qwen3Region"] })
                    }
                >
                    <option value="international">International / Singapore</option>
                    <option value="china">China / Beijing</option>
                </select>
            </div>
            <div style={css.row}>
                <div style={css.half}>
                    <label style={css.label}>MODEL</label>
                    <input
                        style={css.input}
                        value={config.model}
                        onChange={(e) => onChange({ model: e.target.value })}
                        placeholder="qwen3-tts-instruct-flash-realtime"
                    />
                </div>
                <div style={css.half}>
                    <label style={css.label}>VOICE</label>
                    <select
                        style={css.select}
                        value={config.voiceId}
                        onChange={(e) => onChange({ voiceId: e.target.value })}
                    >
                        {voiceOptions(QWEN3_CLOUD_VOICES, config.voiceId).map((voice) => (
                            <option key={voice} value={voice}>
                                {voice}
                            </option>
                        ))}
                    </select>
                </div>
            </div>
            <div style={{ marginBottom: 16 }}>
                <label style={css.label}>CUSTOM VOICE</label>
                <input
                    style={css.input}
                    value={config.voiceId}
                    onChange={(e) => onChange({ voiceId: e.target.value })}
                    placeholder="Type another Qwen3 voice name"
                />
            </div>
            <Qwen3SharedFields config={config} onChange={onChange} />
        </>
    );
}

function Qwen3SharedFields({
    config,
    onChange,
}: {
    config: TtsConfig;
    onChange: (patch: Partial<TtsConfig>) => void;
}) {
    return (
        <>
            <div style={css.row}>
                <div style={css.half}>
                    <label style={css.label}>LANGUAGE TYPE</label>
                    <select
                        style={css.select}
                        value={config.qwen3LanguageType}
                        onChange={(e) => onChange({ qwen3LanguageType: e.target.value })}
                    >
                        <option value="Korean">Korean</option>
                        <option value="Auto">Auto</option>
                        <option value="Chinese">Chinese</option>
                        <option value="English">English</option>
                        <option value="Japanese">Japanese</option>
                        <option value="Spanish">Spanish</option>
                        <option value="French">French</option>
                        <option value="German">German</option>
                    </select>
                </div>
                <div style={css.half}>
                    <label style={css.label}>SAMPLE RATE</label>
                    <input
                        style={css.input}
                        type="number"
                        min={8000}
                        max={48000}
                        step={1000}
                        value={config.qwen3SampleRate}
                        onChange={(e) => onChange({ qwen3SampleRate: Number(e.target.value) })}
                        placeholder="24000"
                    />
                </div>
            </div>
            <div style={{ marginBottom: 16 }}>
                <label style={css.label}>INSTRUCTIONS</label>
                <textarea
                    style={{ ...css.input, minHeight: 72, resize: "vertical" }}
                    value={config.qwen3Instructions}
                    onChange={(e) => onChange({ qwen3Instructions: e.target.value })}
                    placeholder="calm Korean assistant voice, concise and warm"
                />
            </div>
        </>
    );
}

function CommercialFields({
    config,
    onChange,
}: {
    config: TtsConfig;
    onChange: (patch: Partial<TtsConfig>) => void;
}) {
    return (
        <>
            <div style={{ marginBottom: 16 }}>
                <label style={css.label}>API KEY</label>
                <input
                    style={css.input}
                    type="password"
                    value={config.apiKey}
                    onChange={(e) => onChange({ apiKey: e.target.value })}
                    placeholder={
                        config.provider === "elevenlabs"
                            ? "ElevenLabs API key"
                            : "OpenAI API key"
                    }
                />
            </div>
            <div style={css.row}>
                <div style={css.half}>
                    <label style={css.label}>MODEL</label>
                    <input
                        style={css.input}
                        value={config.model}
                        onChange={(e) => onChange({ model: e.target.value })}
                        placeholder={defaultModel(config.provider)}
                    />
                </div>
                <div style={css.half}>
                    <label style={css.label}>VOICE ID</label>
                    <input
                        style={css.input}
                        value={config.voiceId}
                        onChange={(e) => onChange({ voiceId: e.target.value })}
                        placeholder={defaultVoice(config.provider)}
                    />
                </div>
            </div>
        </>
    );
}

function defaultModel(provider: TtsConfig["provider"]): string {
    if (provider === "openai") return "gpt-4o-mini-tts";
    if (provider === "elevenlabs") return "eleven_multilingual_v2";
    if (provider === "qwen3-local") return "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit";
    if (provider === "chatterbox") return "multilingual";
    if (provider === "vibevoice") return "microsoft/VibeVoice-Realtime-0.5B";
    if (provider === "gpt-sovits") return "GPT-SoVITS";
    if (provider === "qwen3-realtime") return "qwen3-tts-instruct-flash-realtime";
    return "";
}

function defaultVoice(provider: TtsConfig["provider"]): string {
    if (provider === "openai") return "marin";
    if (provider === "elevenlabs") return "JBFqnCBsd6RMkjVDRZzb";
    if (provider === "qwen3-local") return "Chelsie";
    if (provider === "vibevoice") return "Carter";
    if (provider === "qwen3-realtime") return "Cherry";
    return "";
}

function voiceOptions(defaults: string[], current: string): string[] {
    const trimmed = current.trim();
    if (!trimmed || defaults.includes(trimmed)) return defaults;
    return [trimmed, ...defaults];
}

function isStreamingProvider(provider: TtsConfig["provider"]): boolean {
    return provider === "qwen3-local" || provider === "qwen3-realtime";
}

function ttsPayload(config: TtsConfig, text: string): Record<string, unknown> {
    return {
        provider: config.provider,
        text,
        apiKey: config.apiKey,
        voiceId: config.voiceId,
        model: config.model,
        language: config.language,
        audioPromptPath: config.audioPromptPath,
        exaggeration: config.exaggeration,
        cfgWeight: config.cfgWeight,
        gptSovitsRepoPath: config.gptSovitsRepoPath,
        gptSovitsPythonPath: config.gptSovitsPythonPath,
        gptSovitsHost: config.gptSovitsHost,
        gptSovitsPort: config.gptSovitsPort,
        gptSovitsConfigPath: config.gptSovitsConfigPath,
        gptSovitsPromptText: config.gptSovitsPromptText,
        gptSovitsTextLanguage: config.gptSovitsTextLanguage,
        gptSovitsPromptLanguage: config.gptSovitsPromptLanguage,
        gptSovitsStreamingMode: config.gptSovitsStreamingMode,
        gptSovitsSpeedFactor: config.gptSovitsSpeedFactor,
        gptSovitsTopK: config.gptSovitsTopK,
        gptSovitsTopP: config.gptSovitsTopP,
        gptSovitsTemperature: config.gptSovitsTemperature,
        qwen3LocalPythonPath: config.qwen3LocalPythonPath,
        qwen3Region: config.qwen3Region,
        qwen3LanguageType: config.qwen3LanguageType,
        qwen3Instructions: config.qwen3Instructions,
        qwen3SampleRate: config.qwen3SampleRate,
    };
}

async function playAudioBase64(
    audioBase64: string,
    mimeType: string,
    volume: number,
) {
    const audio = new Audio(`data:${mimeType};base64,${audioBase64}`);
    audio.volume = Math.min(1, Math.max(0, volume));
    await new Promise<void>((resolve, reject) => {
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error("audio playback failed"));
        void audio.play().catch(reject);
    });
}

function RangeField({
    label,
    value,
    min,
    max,
    step,
    onChange,
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (value: number) => void;
}) {
    return (
        <div style={{ marginBottom: 14 }}>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 6,
                }}
            >
                <label style={{ ...css.label, marginBottom: 0 }}>{label}</label>
                <span style={{ fontFamily: "monospace", fontSize: 11 }}>
                    {value.toFixed(2)}
                </span>
            </div>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                style={{ width: "100%" }}
            />
        </div>
    );
}

async function playPreviewStream(config: TtsConfig, text: string) {
    const bridge = (window as any).jarvisBridge;
    if (!bridge?.synthesizeTtsStream || !bridge?.onTtsStreamEvent) return;

    const requestId = `tts-preview-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let playback: PreviewPcmPlayback | null = null;
    await new Promise<void>((resolve) => {
        const unsubscribe = bridge.onTtsStreamEvent((event: any) => {
            if (event?.requestId !== requestId) return;

            if (event.type === "start") {
                playback = new PreviewPcmPlayback({
                    sampleRate: Number(event.sampleRate || config.qwen3SampleRate || 24000),
                    channels: Number(event.channels || 1),
                    volume: config.volume,
                });
                return;
            }

            if (event.type === "chunk") {
                playback?.append(base64ToBytes(String(event.audioBase64 || "")));
                return;
            }

            if (event.type === "end") {
                playback?.finish(() => {
                    unsubscribe?.();
                    resolve();
                });
                if (!playback) {
                    unsubscribe?.();
                    resolve();
                }
                return;
            }

            if (event.type === "error") {
                console.warn("[TTS] preview stream failed", event.error || event);
                playback?.close();
                unsubscribe?.();
                resolve();
            }
        });

        void bridge.synthesizeTtsStream({
            ...ttsPayload(config, text),
            requestId,
        }).catch((error: unknown) => {
            console.warn("[TTS] preview stream bridge failed", error);
            playback?.close();
            unsubscribe?.();
            resolve();
        });
    });
}

class PreviewPcmPlayback {
    private context: AudioContext;
    private gain: GainNode;
    private channels: number;
    private sampleRate: number;
    private nextTime: number;
    private pending = new Uint8Array(0);
    private closed = false;
    private sources = new Set<AudioBufferSourceNode>();

    constructor(options: { sampleRate: number; channels: number; volume: number }) {
        this.sampleRate = options.sampleRate;
        this.channels = Math.max(1, Math.min(2, options.channels || 1));
        this.context = new AudioContext({ sampleRate: this.sampleRate });
        this.gain = this.context.createGain();
        this.gain.gain.value = Math.min(1, Math.max(0, options.volume));
        this.gain.connect(this.context.destination);
        this.nextTime = this.context.currentTime + 0.04;
    }

    append(bytes: Uint8Array) {
        if (this.closed || bytes.length === 0) return;
        const merged = new Uint8Array(this.pending.length + bytes.length);
        merged.set(this.pending, 0);
        merged.set(bytes, this.pending.length);

        const frameSize = this.channels * 2;
        const usableLength = Math.floor(merged.length / frameSize) * frameSize;
        this.pending = merged.slice(usableLength);
        if (usableLength === 0) return;

        const samples = new Int16Array(merged.buffer, merged.byteOffset, usableLength / 2);
        const frameCount = samples.length / this.channels;
        const buffer = this.context.createBuffer(this.channels, frameCount, this.sampleRate);
        for (let channel = 0; channel < this.channels; channel += 1) {
            const channelData = buffer.getChannelData(channel);
            for (let frame = 0; frame < frameCount; frame += 1) {
                channelData[frame] = samples[frame * this.channels + channel] / 32768;
            }
        }

        const source = this.context.createBufferSource();
        source.buffer = buffer;
        source.connect(this.gain);
        source.onended = () => this.sources.delete(source);
        const startAt = Math.max(this.context.currentTime + 0.02, this.nextTime);
        source.start(startAt);
        this.nextTime = startAt + buffer.duration;
        this.sources.add(source);
    }

    finish(onDone: () => void) {
        const delayMs = Math.max(0, (this.nextTime - this.context.currentTime) * 1000) + 50;
        window.setTimeout(() => {
            if (!this.closed) onDone();
            this.close();
        }, delayMs);
    }

    close() {
        this.closed = true;
        for (const source of this.sources) {
            try {
                source.stop();
            } catch (_) {}
        }
        this.sources.clear();
        void this.context.close();
    }
}

function base64ToBytes(value: string): Uint8Array {
    if (!value) return new Uint8Array(0);
    const binary = window.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
