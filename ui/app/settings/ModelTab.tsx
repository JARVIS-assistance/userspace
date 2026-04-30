import ModelForm from "./ModelForm";
import { css } from "./styles";
import { EMPTY_MODEL, type ModelConfig } from "./types";

interface Props {
    models: ModelConfig[];
    editing: ModelConfig | null;
    loading: boolean;
    onEdit: (m: ModelConfig | null) => void;
    onSave: (m: ModelConfig) => void;
}

export default function ModelTab({
    models,
    editing,
    loading,
    onEdit,
    onSave,
}: Props) {
    return (
        <div>
            {models.length === 0 && !editing && (
                <p
                    style={{
                        color: "rgba(120,80,40,0.5)",
                        fontSize: 13,
                        textAlign: "center",
                        padding: "20px 0",
                    }}
                >
                    {loading ? "LOADING..." : "NO MODELS"}
                </p>
            )}
            {!editing &&
                models.map((m) => (
                    <div key={m.id} style={css.card}>
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                marginBottom: 8,
                            }}
                        >
                            <span style={{ fontWeight: 500 }}>
                                {m.model_name}
                            </span>
                            <div style={{ display: "flex", gap: 6 }}>
                                <button
                                    style={css.btn("ghost")}
                                    onClick={() => onEdit({ ...m })}
                                >
                                    수정
                                </button>
                            </div>
                        </div>
                        <div>
                            {m.is_default && (
                                <span
                                    style={css.badge("rgba(194,149,107)")}
                                >
                                    DEFAULT
                                </span>
                            )}
                            <span style={css.badge("rgba(140,160,180)")}>
                                {m.provider_mode}
                            </span>
                            <span style={css.badge("rgba(140,160,180)")}>
                                {m.provider_name}
                            </span>
                            {m.supports_stream && (
                                <span style={css.badge("rgba(100,180,220)")}>
                                    STREAM
                                </span>
                            )}
                        </div>
                        {m.endpoint && (
                            <p
                                style={{
                                    fontSize: 11,
                                    color: "rgba(120,80,40,0.4)",
                                    margin: "6px 0 0",
                                    fontFamily: "monospace",
                                    wordBreak: "break-all" as const,
                                }}
                            >
                                {m.endpoint}
                            </p>
                        )}
                    </div>
                ))}
            {editing && (
                <ModelForm
                    model={editing}
                    onChange={onEdit}
                    onSave={() => onSave(editing)}
                    onCancel={() => onEdit(null)}
                    loading={loading}
                />
            )}
            {!editing && (
                <div
                    style={{
                        display: "flex",
                        justifyContent: "center",
                        marginTop: 16,
                    }}
                >
                    <button
                        style={css.btn("primary")}
                        onClick={() => onEdit({ ...EMPTY_MODEL })}
                    >
                        + 모델 추가
                    </button>
                </div>
            )}
        </div>
    );
}
