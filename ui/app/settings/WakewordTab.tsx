import { useState } from "react";
import { recordWakewordSample } from "../wakeword/wakeword";
import { css } from "./styles";
import type { WakewordConfig } from "./types";

interface Props {
    config: WakewordConfig;
    onChange: (patch: Partial<WakewordConfig>) => void;
}

export default function WakewordTab({ config, onChange }: Props) {
    const [recording, setRecording] = useState(false);
    const [error, setError] = useState("");
    const ready = config.samples.length >= config.requiredSamples;

    const addSample = async () => {
        if (recording) return;
        setRecording(true);
        setError("");
        try {
            const sample = await recordWakewordSample();
            onChange({
                samples: [...config.samples, sample].slice(-config.requiredSamples),
            });
        } catch (err) {
            console.warn("[wakeword] sample recording failed", err);
            setError("마이크 녹음에 실패했습니다. 브라우저/앱 마이크 권한을 확인하세요.");
        } finally {
            setRecording(false);
        }
    };

    const removeSample = (id: string) => {
        onChange({
            enabled: false,
            samples: config.samples.filter((sample) => sample.id !== id),
        });
    };

    const clearSamples = () => {
        onChange({ enabled: false, samples: [] });
    };

    return (
        <div>
            <div style={css.card}>
                <label style={css.label}>WAKEWORD</label>
                <input
                    value={config.phraseLabel}
                    onChange={(e) => onChange({ phraseLabel: e.target.value })}
                    style={css.input}
                    placeholder="Jarvis"
                />
            </div>

            <div style={css.card}>
                <label style={css.label}>STATUS</label>
                <div style={{ fontFamily: "monospace", fontSize: 12, marginBottom: 10 }}>
                    {config.samples.length}/{config.requiredSamples} samples
                    {" · "}
                    {ready ? "READY" : "NEEDS RECORDING"}
                </div>
                <label
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        opacity: ready ? 1 : 0.55,
                    }}
                >
                    <input
                        type="checkbox"
                        checked={config.enabled && ready}
                        disabled={!ready}
                        onChange={(e) => onChange({ enabled: e.target.checked })}
                    />
                    <span>Enable wakeword standby</span>
                </label>
            </div>

            <div style={css.card}>
                <label style={css.label}>REGISTRATION</label>
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                    <button
                        type="button"
                        style={css.btn("primary")}
                        disabled={recording}
                        onClick={addSample}
                    >
                        {recording ? "RECORDING..." : "RECORD SAMPLE"}
                    </button>
                    <button
                        type="button"
                        style={css.btn("ghost")}
                        disabled={recording || config.samples.length === 0}
                        onClick={clearSamples}
                    >
                        CLEAR
                    </button>
                </div>
                <div
                    style={{
                        color: "rgba(120,80,40,0.66)",
                        fontSize: 12,
                        lineHeight: 1.45,
                        marginBottom: 12,
                    }}
                >
                    Press record, say the wakeword once, then repeat until three samples are saved.
                </div>
                {error && (
                    <div style={{ color: "rgba(220,90,70,0.9)", fontSize: 12 }}>
                        {error}
                    </div>
                )}
                {config.samples.map((sample, index) => (
                    <div
                        key={sample.id}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            borderTop: "1px solid rgba(120,80,30,0.16)",
                            paddingTop: 8,
                            marginTop: 8,
                        }}
                    >
                        <span style={{ fontFamily: "monospace", fontSize: 12 }}>
                            SAMPLE {index + 1} · {new Date(sample.createdAt).toLocaleTimeString()}
                        </span>
                        <button
                            type="button"
                            style={css.btn("danger")}
                            onClick={() => removeSample(sample.id)}
                        >
                            DELETE
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
