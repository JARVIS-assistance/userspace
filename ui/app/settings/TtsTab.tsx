import { useEffect, useMemo, useState } from "react";
import { css } from "./styles";
import type { TtsConfig } from "./types";

interface Props {
    config: TtsConfig;
    onChange: (patch: Partial<TtsConfig>) => void;
}

export default function TtsTab({ config, onChange }: Props) {
    const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

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
        const text = "안녕하세요. 자비스 음성 응답 테스트입니다.";
        if (config.provider === "browser") {
            if (!("speechSynthesis" in window)) return;
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            if (selectedVoice) utterance.voice = selectedVoice;
            utterance.lang = selectedVoice?.lang || "ko-KR";
            utterance.rate = config.rate;
            utterance.pitch = config.pitch;
            utterance.volume = config.volume;
            window.speechSynthesis.speak(utterance);
            return;
        }

        const bridge = (window as any).jarvisBridge;
        if (!bridge?.synthesizeTts) return;
        const result = await bridge.synthesizeTts({
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
            gptSovitsSpeedFactor: config.gptSovitsSpeedFactor,
            gptSovitsTopK: config.gptSovitsTopK,
            gptSovitsTopP: config.gptSovitsTopP,
            gptSovitsTemperature: config.gptSovitsTemperature,
        });
        if (!result?.ok || !result.audioBase64) {
            console.warn("[TTS] preview failed", result?.error || result);
            return;
        }
        const audio = new Audio(
            `data:${result.mimeType || "audio/wav"};base64,${result.audioBase64}`,
        );
        audio.volume = config.volume;
        await audio.play();
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
                    <option value="browser">Browser / System TTS</option>
                    <option value="chatterbox">Chatterbox-TTS Local</option>
                    <option value="vibevoice">VibeVoice Realtime Local</option>
                    <option value="gpt-sovits">GPT-SoVITS Local</option>
                    <option value="elevenlabs">ElevenLabs</option>
                    <option value="openai">OpenAI</option>
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
                disabled={config.provider === "browser" && !supported}
            >
                TEST VOICE
            </button>
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
    if (provider === "chatterbox") return "multilingual";
    if (provider === "vibevoice") return "microsoft/VibeVoice-Realtime-0.5B";
    if (provider === "gpt-sovits") return "GPT-SoVITS";
    return "";
}

function defaultVoice(provider: TtsConfig["provider"]): string {
    if (provider === "openai") return "marin";
    if (provider === "elevenlabs") return "JBFqnCBsd6RMkjVDRZzb";
    if (provider === "vibevoice") return "Carter";
    return "";
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
