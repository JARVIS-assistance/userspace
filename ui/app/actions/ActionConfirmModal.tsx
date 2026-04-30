import { useEffect, useState } from "react";
import { PendingConfirm } from "./types";

interface Props {
    pending: PendingConfirm | null;
    onRespond: (actionId: string, accepted: boolean, reason?: string) => void;
}

export default function ActionConfirmModal({ pending, onRespond }: Props) {
    const [remaining, setRemaining] = useState(0);

    useEffect(() => {
        if (!pending) return;
        const deadline = pending.timestamp + pending.timeout_sec * 1000;
        const tick = () => {
            const r = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
            setRemaining(r);
        };
        tick();
        const id = window.setInterval(tick, 250);
        return () => window.clearInterval(id);
    }, [pending]);

    if (!pending) return null;

    const { action_id, action } = pending;

    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.65)",
                backdropFilter: "blur(6px)",
                zIndex: 9500,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 12,
            }}
        >
            <div
                style={{
                    background: "#111",
                    border: "1px solid rgba(220,150,80,0.45)",
                    borderRadius: 8,
                    width: 520,
                    maxWidth: "calc(100vw - 24px)",
                    maxHeight: "calc(100vh - 24px)",
                    overflowY: "auto",
                    padding: "18px 22px",
                    color: "rgba(210,180,140,0.92)",
                    boxShadow: "0 0 60px rgba(220,150,80,0.2)",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        marginBottom: 14,
                    }}
                >
                    <span
                        style={{
                            fontSize: 11,
                            letterSpacing: "0.18em",
                            color: "rgba(220,150,80,0.85)",
                            fontFamily: "monospace",
                        }}
                    >
                        ACTION REQUIRES CONFIRMATION
                    </span>
                    <span
                        style={{
                            marginLeft: "auto",
                            fontSize: 11,
                            color: "rgba(150,180,210,0.75)",
                            fontFamily: "monospace",
                        }}
                    >
                        {remaining}s
                    </span>
                </div>

                <h3
                    style={{
                        margin: 0,
                        fontSize: 16,
                        fontWeight: 400,
                        letterSpacing: "0.04em",
                        color: "rgba(230,200,160,0.95)",
                    }}
                >
                    {action.description || action.type}
                </h3>

                <dl
                    style={{
                        margin: "14px 0 18px",
                        display: "grid",
                        gridTemplateColumns: "auto 1fr",
                        rowGap: 4,
                        columnGap: 14,
                        fontSize: 12,
                        fontFamily: "monospace",
                    }}
                >
                    <Field label="type" value={action.type} />
                    {action.command && <Field label="command" value={action.command} />}
                    {action.target && <Field label="target" value={action.target} />}
                    {action.payload && (
                        <Field label="payload" value={truncate(action.payload, 120)} />
                    )}
                    {action.args && Object.keys(action.args).length > 0 && (
                        <Field
                            label="args"
                            value={truncate(JSON.stringify(action.args), 200)}
                        />
                    )}
                </dl>

                <p
                    style={{
                        fontSize: 11,
                        color: "rgba(120,80,40,0.7)",
                        margin: "0 0 18px",
                        fontFamily: "monospace",
                        letterSpacing: "0.05em",
                    }}
                >
                    action_id: {action_id}
                </p>

                <div
                    style={{
                        display: "flex",
                        gap: 10,
                        justifyContent: "flex-end",
                        position: "sticky",
                        bottom: 0,
                        paddingTop: 8,
                        background: "#111",
                    }}
                >
                    <button
                        onClick={() => onRespond(action_id, false)}
                        style={btnStyle("ghost")}
                    >
                        REJECT
                    </button>
                    <button
                        onClick={() => onRespond(action_id, true)}
                        style={btnStyle("primary")}
                        autoFocus
                    >
                        APPROVE
                    </button>
                </div>
            </div>
        </div>
    );
}

function Field({ label, value }: { label: string; value: string }) {
    return (
        <>
            <dt style={{ color: "rgba(120,80,40,0.65)" }}>{label}</dt>
            <dd
                style={{
                    margin: 0,
                    color: "rgba(210,180,140,0.9)",
                    wordBreak: "break-all",
                }}
            >
                {value}
            </dd>
        </>
    );
}

function btnStyle(v: "primary" | "ghost"): React.CSSProperties {
    return {
        padding: "9px 22px",
        borderRadius: 6,
        fontSize: 12,
        fontFamily: "monospace",
        letterSpacing: "0.15em",
        cursor: "pointer",
        border:
            v === "primary"
                ? "1px solid rgba(220,150,80,0.55)"
                : "1px solid rgba(120,80,30,0.3)",
        background:
            v === "primary" ? "rgba(220,150,80,0.3)" : "transparent",
        color:
            v === "primary"
                ? "rgba(245,220,180,0.95)"
                : "rgba(180,160,140,0.7)",
    };
}

function truncate(s: string, n: number): string {
    return s.length > n ? s.slice(0, n) + "…" : s;
}
