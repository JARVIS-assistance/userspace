import ModelForm from "./ModelForm";
import { css } from "./styles";
import { EMPTY_MODEL, type ModelConfig, type ModelSelection } from "./types";

interface Props {
    models: ModelConfig[];
    editing: ModelConfig | null;
    loading: boolean;
    error: string | null;
    selection: ModelSelection;
    onEdit: (m: ModelConfig | null) => void;
    onSave: (m: ModelConfig) => void;
    onDelete: (m: ModelConfig) => void;
    onSaveSelection: (patch: Partial<ModelSelection>) => void;
}

export default function ModelTab({
    models,
    editing,
    loading,
    error,
    selection,
    onEdit,
    onSave,
    onDelete,
    onSaveSelection,
}: Props) {
    const realtimeModels = models.filter(
        (m) => m.id && m.is_active && m.supports_realtime,
    );
    const deepModels = models
        .filter((m) => m.id && m.is_active)
        .sort((a, b) => Number(b.supports_stream) - Number(a.supports_stream));

    const renderModelOption = (m: ModelConfig) => (
        <option key={m.id} value={m.id}>
            {m.model_name} ({m.provider_name})
        </option>
    );

    return (
        <div>
            {!editing && (
                <div style={{ ...css.card, marginBottom: 16 }}>
                    <label style={css.label}>MODEL SELECTION</label>
                    <div style={css.row}>
                        <div style={css.half}>
                            <label style={css.label}>REALTIME</label>
                            <select
                                style={css.select}
                                value={selection.realtime_model_config_id || ""}
                                onChange={(e) =>
                                    onSaveSelection({
                                        realtime_model_config_id:
                                            e.target.value || null,
                                    })
                                }
                                disabled={loading}
                            >
                                <option value="">선택 안 함</option>
                                {realtimeModels.map(renderModelOption)}
                            </select>
                        </div>
                        <div style={css.half}>
                            <label style={css.label}>DEEP</label>
                            <select
                                style={css.select}
                                value={selection.deep_model_config_id || ""}
                                onChange={(e) =>
                                    onSaveSelection({
                                        deep_model_config_id:
                                            e.target.value || null,
                                    })
                                }
                                disabled={loading}
                            >
                                <option value="">선택 안 함</option>
                                {deepModels.map(renderModelOption)}
                            </select>
                        </div>
                    </div>
                    <p
                        style={{
                            fontSize: 11,
                            color: "rgba(120,80,40,0.5)",
                            margin: 0,
                            lineHeight: 1.5,
                        }}
                    >
                        REALTIME은 활성화된 realtime 지원 모델만, DEEP은 활성화된 모델을 표시합니다.
                    </p>
                </div>
            )}
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
                                <button
                                    style={css.btn("danger")}
                                    onClick={() => onDelete(m)}
                                    disabled={loading || !m.id}
                                    title={
                                        m.id
                                            ? "모델 설정 삭제"
                                            : "저장되지 않은 모델은 삭제할 수 없습니다"
                                    }
                                >
                                    삭제
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
                            {m.supports_realtime && (
                                <span style={css.badge("rgba(80,170,140)")}>
                                    REALTIME
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
            {error && (
                <p
                    role="alert"
                    style={{
                        color: "rgba(220,80,60,0.9)",
                        fontSize: 12,
                        margin: "8px 0 0",
                    }}
                >
                    {error}
                </p>
            )}
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
