import { css } from "./styles";
import { PERSONA_ICONS, type Persona } from "./types";

interface Props {
    persona: Persona;
    loading: boolean;
    error: string | null;
    onChange: (u: Partial<Persona>) => void;
    onSave: () => void;
}

export default function PersonaTab({
    persona,
    loading,
    error,
    onChange,
    onSave,
}: Props) {
    return (
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
                            style={css.iconBtn(persona.icon === ic)}
                            onClick={() => onChange({ icon: ic })}
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
                    value={persona.name}
                    onChange={(e) => onChange({ name: e.target.value })}
                    placeholder="J.A.R.V.I.S"
                />
            </div>
            <div style={css.row}>
                <div style={css.half}>
                    <label style={css.label}>TONE</label>
                    <input
                        style={css.input}
                        value={persona.tone}
                        onChange={(e) => onChange({ tone: e.target.value })}
                        placeholder="casual"
                    />
                </div>
                <div style={css.half}>
                    <label style={css.label}>ALIAS</label>
                    <input
                        style={css.input}
                        value={persona.alias}
                        onChange={(e) => onChange({ alias: e.target.value })}
                        placeholder="friend"
                    />
                </div>
            </div>
            <div style={{ marginBottom: 20 }}>
                <label style={css.label}>DESCRIPTION</label>
                <textarea
                    value={persona.description}
                    onChange={(e) => onChange({ description: e.target.value })}
                    placeholder="AI personality / role description..."
                    rows={4}
                    style={{
                        ...css.input,
                        resize: "vertical" as const,
                        lineHeight: 1.5,
                    }}
                />
            </div>
            <div style={{ marginBottom: 20 }}>
                <label style={css.label}>PROMPT TEMPLATE</label>
                <textarea
                    value={persona.prompt_template}
                    onChange={(e) =>
                        onChange({ prompt_template: e.target.value })
                    }
                    placeholder="친구처럼 짧고 자연스럽게 말해."
                    rows={5}
                    style={{
                        ...css.input,
                        resize: "vertical" as const,
                        lineHeight: 1.5,
                    }}
                />
            </div>
            {error && (
                <p
                    role="alert"
                    style={{
                        color: "rgba(220,80,60,0.9)",
                        fontSize: 12,
                        margin: "0 0 12px",
                    }}
                >
                    {error}
                </p>
            )}
            <div
                style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    marginBottom: 20,
                }}
            >
                <button
                    style={css.btn("primary")}
                    onClick={onSave}
                    disabled={loading}
                >
                    {loading ? "저장 중..." : "페르소나 저장"}
                </button>
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
                    {persona.icon}
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
                    {persona.name || "J.A.R.V.I.S"}
                </div>
                <div
                    style={{
                        fontSize: 11,
                        color: "rgba(120,80,40,0.5)",
                        fontFamily: "monospace",
                        letterSpacing: "0.1em",
                    }}
                >
                    {persona.description || "..."}
                </div>
            </div>
        </div>
    );
}
