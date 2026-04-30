import Toggle from "./Toggle";
import { css } from "./styles";
import type { ModelConfig } from "./types";

interface Props {
    model: ModelConfig;
    onChange: (m: ModelConfig) => void;
    onSave: () => void;
    onCancel: () => void;
    loading: boolean;
}

export default function ModelForm({
    model,
    onChange,
    onSave,
    onCancel,
    loading,
}: Props) {
    const set = (k: keyof ModelConfig, v: unknown) =>
        onChange({ ...model, [k]: v });

    return (
        <div>
            <div style={css.row}>
                <div style={css.half}>
                    <label style={css.label}>PROVIDER MODE</label>
                    <select
                        style={css.select}
                        value={model.provider_mode}
                        onChange={(e) => set("provider_mode", e.target.value)}
                    >
                        <option value="local">local</option>
                        <option value="token">token</option>
                    </select>
                </div>
                <div style={css.half}>
                    <label style={css.label}>PROVIDER NAME</label>
                    <input
                        style={css.input}
                        value={model.provider_name}
                        onChange={(e) => set("provider_name", e.target.value)}
                        placeholder="qwen, openai, gemini..."
                    />
                </div>
            </div>
            <div style={{ marginBottom: 12 }}>
                <label style={css.label}>MODEL NAME</label>
                <input
                    style={css.input}
                    value={model.model_name}
                    onChange={(e) => set("model_name", e.target.value)}
                    placeholder="docker.io/gemma3-qat:4B"
                />
            </div>
            <div style={{ marginBottom: 12 }}>
                <label style={css.label}>ENDPOINT</label>
                <input
                    style={css.input}
                    value={model.endpoint || ""}
                    onChange={(e) => set("endpoint", e.target.value)}
                    placeholder="https://your-api-host/v1/chat/completions"
                />
            </div>
            <div style={{ marginBottom: 12 }}>
                <label style={css.label}>API KEY</label>
                <input
                    style={css.input}
                    type="password"
                    value={model.api_key || ""}
                    onChange={(e) => set("api_key", e.target.value)}
                    placeholder="optional"
                />
            </div>
            <div style={css.row}>
                <div style={css.half}>
                    <label style={css.label}>TRANSPORT</label>
                    <select
                        style={css.select}
                        value={model.transport}
                        onChange={(e) => set("transport", e.target.value)}
                    >
                        <option value="http_sse">HTTP SSE</option>
                        <option value="websocket">WebSocket</option>
                    </select>
                </div>
                <div style={css.half}>
                    <label style={css.label}>MODALITIES (IN / OUT)</label>
                    <div
                        style={{
                            display: "flex",
                            gap: 6,
                            alignItems: "center",
                        }}
                    >
                        <input
                            style={{ ...css.input, flex: 1 }}
                            value={model.input_modalities}
                            onChange={(e) =>
                                set("input_modalities", e.target.value)
                            }
                        />
                        <span style={{ color: "rgba(120,80,40,0.4)" }}>/</span>
                        <input
                            style={{ ...css.input, flex: 1 }}
                            value={model.output_modalities}
                            onChange={(e) =>
                                set("output_modalities", e.target.value)
                            }
                        />
                    </div>
                </div>
            </div>
            <div style={{ margin: "12px 0 20px" }}>
                <Toggle
                    value={model.is_default}
                    onChange={(v) => set("is_default", v)}
                    label="DEFAULT"
                />
                <Toggle
                    value={model.supports_stream}
                    onChange={(v) => set("supports_stream", v)}
                    label="STREAM"
                />
                <Toggle
                    value={model.supports_realtime}
                    onChange={(v) => set("supports_realtime", v)}
                    label="REALTIME"
                />
            </div>
            <div
                style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}
            >
                <button style={css.btn("ghost")} onClick={onCancel}>
                    취소
                </button>
                <button
                    style={css.btn("primary")}
                    onClick={onSave}
                    disabled={
                        loading || !model.provider_name || !model.model_name
                    }
                >
                    {loading ? "저장 중..." : model.id ? "수정" : "등록"}
                </button>
            </div>
        </div>
    );
}
