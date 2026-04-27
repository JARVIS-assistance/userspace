import { useState, useEffect, useCallback } from "react";

const API_BASE_FALLBACK = "http://127.0.0.1:8001";
const STORAGE_KEY = "jarvis_settings";

// ── 타입 ──

interface ModelConfig {
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

interface Persona {
    icon: string;
    name: string;
    description: string;
}

interface SettingsData {
    models: ModelConfig[];
    persona: Persona;
}

const PERSONA_ICONS = [
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

const DEFAULT_PERSONA: Persona = {
    icon: "\u{1F916}",
    name: "J.A.R.V.I.S",
    description: "Just A Rather Very Intelligent System",
};

const EMPTY_MODEL: ModelConfig = {
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

async function resolveApiBase(): Promise<string> {
    try {
        const bridge = (window as any).jarvisBridge;
        if (bridge?.getUserspaceConfig) {
            const config = await bridge.getUserspaceConfig();
            const candidate =
                typeof config?.authApiBase === "string"
                    ? config.authApiBase.trim()
                    : "";
            if (candidate) return candidate.replace(/\/+$/, "");
        }
    } catch (_) {}

    return API_BASE_FALLBACK;
}

function loadLocal(): SettingsData {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch (_) {}
    return { models: [], persona: DEFAULT_PERSONA };
}

function saveLocal(data: SettingsData) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ── 스타일 ──

const css = {
    overlay: {
        position: "fixed" as const,
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(8px)",
        zIndex: 9000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    modal: {
        background: "#111",
        border: "1px solid rgba(120,80,30,0.3)",
        borderRadius: 14,
        width: 520,
        maxHeight: "85vh",
        overflow: "auto",
        padding: "28px 32px",
        color: "rgba(210,180,140,0.9)",
        fontSize: 14,
    },
    header: {
        display: "flex" as const,
        justifyContent: "space-between" as const,
        alignItems: "center" as const,
        marginBottom: 24,
    },
    title: {
        fontSize: 18,
        fontWeight: 300 as const,
        letterSpacing: "0.15em",
        color: "rgba(194,149,107,0.9)",
        margin: 0,
    },
    closeBtn: {
        background: "none",
        border: "none",
        color: "rgba(120,80,40,0.5)",
        fontSize: 18,
        cursor: "pointer",
        padding: "4px 8px",
    },
    tabs: {
        display: "flex" as const,
        gap: 0,
        marginBottom: 24,
        borderBottom: "1px solid rgba(120,80,30,0.2)",
    },
    tab: (on: boolean): React.CSSProperties => ({
        padding: "10px 20px",
        background: "none",
        border: "none",
        borderBottom: on
            ? "2px solid rgba(194,149,107,0.8)"
            : "2px solid transparent",
        color: on ? "rgba(210,180,140,0.9)" : "rgba(120,80,40,0.5)",
        fontSize: 13,
        letterSpacing: "0.1em",
        cursor: "pointer",
    }),
    label: {
        display: "block" as const,
        fontSize: 11,
        letterSpacing: "0.1em",
        color: "rgba(120,80,40,0.6)",
        marginBottom: 6,
        fontFamily: "monospace",
    },
    input: {
        width: "100%",
        padding: "10px 14px",
        background: "rgba(30,30,30,0.8)",
        border: "1px solid rgba(120,80,30,0.25)",
        borderRadius: 6,
        color: "rgba(210,180,140,0.9)",
        fontSize: 13,
        outline: "none",
        boxSizing: "border-box" as const,
    },
    select: {
        width: "100%",
        padding: "10px 14px",
        background: "rgba(30,30,30,0.8)",
        border: "1px solid rgba(120,80,30,0.25)",
        borderRadius: 6,
        color: "rgba(210,180,140,0.9)",
        fontSize: 13,
        outline: "none",
        boxSizing: "border-box" as const,
        appearance: "none" as const,
    },
    row: { display: "flex" as const, gap: 12, marginBottom: 12 },
    half: { flex: 1 },
    btn: (v: "primary" | "ghost" | "danger"): React.CSSProperties => ({
        padding: "9px 18px",
        borderRadius: 6,
        fontSize: 12,
        letterSpacing: "0.08em",
        cursor: "pointer",
        border:
            v === "danger"
                ? "1px solid rgba(220,80,60,0.4)"
                : "1px solid rgba(120,80,30,0.3)",
        background:
            v === "primary"
                ? "rgba(120,80,30,0.35)"
                : v === "danger"
                  ? "rgba(220,80,60,0.15)"
                  : "transparent",
        color:
            v === "danger" ? "rgba(220,80,60,0.8)" : "rgba(210,180,140,0.85)",
    }),
    card: {
        border: "1px solid rgba(120,80,30,0.2)",
        borderRadius: 8,
        padding: "14px 16px",
        marginBottom: 10,
        background: "rgba(20,20,20,0.6)",
    },
    badge: (c: string): React.CSSProperties => ({
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 10,
        letterSpacing: "0.08em",
        fontFamily: "monospace",
        background: `${c}20`,
        color: c,
        marginRight: 6,
    }),
    iconBtn: (on: boolean): React.CSSProperties => ({
        width: 44,
        height: 44,
        borderRadius: 10,
        fontSize: 22,
        cursor: "pointer",
        border: on
            ? "2px solid rgba(194,149,107,0.8)"
            : "1px solid rgba(120,80,30,0.2)",
        background: on ? "rgba(120,80,30,0.25)" : "rgba(30,30,30,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    }),
};

// ── 토글 ──

function Toggle({
    value,
    onChange,
    label,
}: {
    value: boolean;
    onChange: (v: boolean) => void;
    label: string;
}) {
    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 8,
            }}
        >
            <div
                onClick={() => onChange(!value)}
                style={{
                    width: 40,
                    height: 22,
                    borderRadius: 11,
                    cursor: "pointer",
                    background: value
                        ? "rgba(120,80,30,0.6)"
                        : "rgba(60,60,60,0.6)",
                    border: "1px solid rgba(120,80,30,0.3)",
                    position: "relative",
                    transition: "background 0.2s",
                }}
            >
                <div
                    style={{
                        width: 16,
                        height: 16,
                        borderRadius: 8,
                        position: "absolute",
                        top: 2,
                        left: value ? 20 : 2,
                        background: value
                            ? "rgba(210,180,140,0.9)"
                            : "rgba(100,100,100,0.6)",
                        transition: "left 0.2s",
                    }}
                />
            </div>
            <span style={{ fontSize: 12, color: "rgba(210,180,140,0.7)" }}>
                {label}
            </span>
        </div>
    );
}

// ── 모델 편집 폼 ──

function ModelForm({
    model,
    onChange,
    onSave,
    onCancel,
    loading,
}: {
    model: ModelConfig;
    onChange: (m: ModelConfig) => void;
    onSave: () => void;
    onCancel: () => void;
    loading: boolean;
}) {
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
                    placeholder="https://qwen.breakpack.cc/v1/chat/completions"
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

// ── 메인 ──

interface Props {
    open: boolean;
    token: string;
    onClose: () => void;
}

export default function SettingsModal({ open, token, onClose }: Props) {
    const [tab, setTab] = useState<"model" | "persona">("model");
    const [data, setData] = useState<SettingsData>(loadLocal);
    const [editing, setEditing] = useState<ModelConfig | null>(null);
    const [loading, setLoading] = useState(false);

    const hdrs = useCallback(
        (): Record<string, string> => ({
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        }),
        [token],
    );

    const sync = useCallback(async () => {
        setLoading(true);
        try {
            const apiBase = await resolveApiBase();
            const res = await fetch(`${apiBase}/chat/model-config`, {
                headers: hdrs(),
            });
            if (res.ok) {
                const models: ModelConfig[] = await res.json();
                setData((prev) => {
                    const next = { ...prev, models };
                    saveLocal(next);
                    return next;
                });
            }
        } catch (_) {}
        setLoading(false);
    }, [hdrs]);

    useEffect(() => {
        if (open) sync();
    }, [open, sync]);

    const saveModel = useCallback(
        async (m: ModelConfig) => {
            setLoading(true);
            try {
                const isNew = !m.id;
                const apiBase = await resolveApiBase();
                const res = await fetch(
                    isNew
                        ? `${apiBase}/chat/model-config`
                        : `${apiBase}/chat/model-config/${m.id}`,
                    {
                        method: isNew ? "POST" : "PUT",
                        headers: hdrs(),
                        body: JSON.stringify({
                            provider_mode: m.provider_mode,
                            provider_name: m.provider_name,
                            model_name: m.model_name,
                            api_key: m.api_key || undefined,
                            endpoint: m.endpoint || undefined,
                            is_default: m.is_default,
                            supports_stream: m.supports_stream,
                            supports_realtime: m.supports_realtime,
                            transport: m.transport,
                            input_modalities: m.input_modalities,
                            output_modalities: m.output_modalities,
                        }),
                    },
                );
                if (res.ok) {
                    await sync();
                    setEditing(null);
                }
            } catch (_) {}
            setLoading(false);
        },
        [hdrs, sync],
    );

    const setPerson = useCallback((u: Partial<Persona>) => {
        setData((prev) => {
            const next = { ...prev, persona: { ...prev.persona, ...u } };
            saveLocal(next);
            return next;
        });
    }, []);

    if (!open) return null;

    return (
        <div style={css.overlay} onClick={onClose}>
            <div style={css.modal} onClick={(e) => e.stopPropagation()}>
                <div style={css.header}>
                    <h2 style={css.title}>SETTINGS</h2>
                    <button style={css.closeBtn} onClick={onClose}>
                        {"\u2715"}
                    </button>
                </div>

                <div style={css.tabs}>
                    <button
                        style={css.tab(tab === "model")}
                        onClick={() => setTab("model")}
                    >
                        MODEL
                    </button>
                    <button
                        style={css.tab(tab === "persona")}
                        onClick={() => setTab("persona")}
                    >
                        PERSONA
                    </button>
                </div>

                {/* ── MODEL ── */}
                {tab === "model" && (
                    <div>
                        {data.models.length === 0 && !editing && (
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
                            data.models.map((m) => (
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
                                        <div
                                            style={{ display: "flex", gap: 6 }}
                                        >
                                            <button
                                                style={css.btn("ghost")}
                                                onClick={() =>
                                                    setEditing({ ...m })
                                                }
                                            >
                                                수정
                                            </button>
                                        </div>
                                    </div>
                                    <div>
                                        {m.is_default && (
                                            <span
                                                style={css.badge(
                                                    "rgba(194,149,107)",
                                                )}
                                            >
                                                DEFAULT
                                            </span>
                                        )}
                                        <span
                                            style={css.badge(
                                                "rgba(140,160,180)",
                                            )}
                                        >
                                            {m.provider_mode}
                                        </span>
                                        <span
                                            style={css.badge(
                                                "rgba(140,160,180)",
                                            )}
                                        >
                                            {m.provider_name}
                                        </span>
                                        {m.supports_stream && (
                                            <span
                                                style={css.badge(
                                                    "rgba(100,180,220)",
                                                )}
                                            >
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
                                onChange={setEditing}
                                onSave={() => saveModel(editing)}
                                onCancel={() => setEditing(null)}
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
                                    onClick={() =>
                                        setEditing({ ...EMPTY_MODEL })
                                    }
                                >
                                    + 모델 추가
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* ── PERSONA ── */}
                {tab === "persona" && (
                    <div>
                        <div style={{ marginBottom: 20 }}>
                            <label style={css.label}>ICON</label>
                            <div
                                style={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: 8,
                                }}
                            >
                                {PERSONA_ICONS.map((ic) => (
                                    <button
                                        key={ic}
                                        style={css.iconBtn(
                                            data.persona.icon === ic,
                                        )}
                                        onClick={() => setPerson({ icon: ic })}
                                    >
                                        {ic}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div style={{ marginBottom: 16 }}>
                            <label style={css.label}>NAME</label>
                            <input
                                style={css.input}
                                value={data.persona.name}
                                onChange={(e) =>
                                    setPerson({ name: e.target.value })
                                }
                                placeholder="J.A.R.V.I.S"
                            />
                        </div>
                        <div style={{ marginBottom: 20 }}>
                            <label style={css.label}>DESCRIPTION</label>
                            <textarea
                                value={data.persona.description}
                                onChange={(e) =>
                                    setPerson({ description: e.target.value })
                                }
                                placeholder="AI personality / role description..."
                                rows={4}
                                style={{
                                    ...css.input,
                                    resize: "vertical" as const,
                                    lineHeight: 1.5,
                                }}
                            />
                        </div>
                        <div
                            style={{
                                border: "1px solid rgba(120,80,30,0.2)",
                                borderRadius: 10,
                                padding: 20,
                                textAlign: "center",
                                background: "rgba(20,20,20,0.5)",
                            }}
                        >
                            <div style={{ fontSize: 40, marginBottom: 8 }}>
                                {data.persona.icon}
                            </div>
                            <div
                                style={{
                                    fontSize: 16,
                                    fontWeight: 300,
                                    letterSpacing: "0.15em",
                                    color: "rgba(194,149,107,0.9)",
                                    marginBottom: 4,
                                }}
                            >
                                {data.persona.name || "J.A.R.V.I.S"}
                            </div>
                            <div
                                style={{
                                    fontSize: 11,
                                    color: "rgba(120,80,40,0.5)",
                                    fontFamily: "monospace",
                                    letterSpacing: "0.1em",
                                }}
                            >
                                {data.persona.description || "..."}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
