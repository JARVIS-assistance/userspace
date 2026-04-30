import { css } from "./styles";
import { PERSONA_ICONS, type Persona } from "./types";

interface Props {
    persona: Persona;
    onChange: (u: Partial<Persona>) => void;
}

export default function PersonaTab({ persona, onChange }: Props) {
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
