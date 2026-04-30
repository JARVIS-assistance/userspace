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

    const preview = () => {
        if (config.provider !== "browser" || !("speechSynthesis" in window)) return;
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(
            "안녕하세요. 자비스 음성 응답 테스트입니다.",
        );
        if (selectedVoice) utterance.voice = selectedVoice;
        utterance.lang = selectedVoice?.lang || "ko-KR";
        utterance.rate = config.rate;
        utterance.pitch = config.pitch;
        utterance.volume = config.volume;
        window.speechSynthesis.speak(utterance);
    };

    const supported = "speechSynthesis" in window;

    return (
        <div>
            <div style={{ marginBottom: 18 }}>
                <label style={css.label}>VOICE RESPONSE</label>
                <button
                    style={css.btn(config.enabled ? "primary" : "ghost")}
                    onClick={() => onChange({ enabled: !config.enabled })}
                    disabled={!supported}
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
                disabled={config.provider !== "browser" || !supported}
            >
                TEST SYSTEM VOICE
            </button>
        </div>
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
    return "";
}

function defaultVoice(provider: TtsConfig["provider"]): string {
    if (provider === "openai") return "marin";
    if (provider === "elevenlabs") return "JBFqnCBsd6RMkjVDRZzb";
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
