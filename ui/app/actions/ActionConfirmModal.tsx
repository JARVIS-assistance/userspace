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

                <div style={riskStyle(action)}>
                    {riskLabel(action)}
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

                <div style={summaryBoxStyle}>
                    {humanSummary(action)}
                </div>

                <details style={detailsStyle}>
                    <summary style={{ cursor: "pointer" }}>debug details</summary>
                    <dl
                        style={{
                            margin: "10px 0 0",
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
                                value={truncate(JSON.stringify(action.args), 400)}
                            />
                        )}
                    </dl>
                </details>

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

function humanSummary(action: PendingConfirm["action"]): string {
    const command = String(action.command || "").replace("_", ".").toLowerCase();
    const args = action.args || {};
    if (
        (action.type === "browser" && (command === "search" || command === "browser.search"))
        || action.type === "browser.search"
    ) {
        const query = String(args.query || action.payload || "");
        const browser = String(args.browser || "configured default");
        const generatedUrl = String(args.generated_url || args.url || previewSearchUrl(query, args));
        return `Search "${query}" in ${browser}. URL: ${generatedUrl}`;
    }
    if (
        (action.type === "browser" && (command === "navigate" || command === "browser.navigate"))
        || action.type === "browser.navigate"
    ) {
        return `Navigate browser to ${String(args.url || action.target || action.payload || "")}`;
    }
    if (
        (action.type === "browser" && (command === "open" || command === "browser.open" || !command))
        || action.type === "browser.open"
    ) {
        return `Open ${String(args.browser || "configured browser")}`;
    }
    return action.description || `${action.type} ${action.command || ""}`.trim();
}

function previewSearchUrl(query: string, args: Record<string, unknown>): string {
    const engine = String(args.engine || args.search_engine || "configured engine").toLowerCase();
    const encoded = encodeURIComponent(query).replace(/%20/g, "+");
    if (!query) return "generated by userspace";
    if (engine === "naver") return `https://search.naver.com/search.naver?query=${encoded}`;
    if (engine === "duckduckgo") return `https://duckduckgo.com/?q=${encoded}`;
    if (engine === "google") return `https://www.google.com/search?q=${encoded}`;
    return `generated by userspace (${engine})`;
}

function riskLabel(action: PendingConfirm["action"]): string {
    const command = String(action.command || "").toLowerCase();
    if (
        action.type === "terminal"
        || action.type === "file_write"
        || action.type === "mouse_click"
        || action.type === "mouse_drag"
        || command.includes("click")
        || command.includes("type")
    ) {
        return "HIGH RISK";
    }
    return "CONFIRM";
}

function riskStyle(action: PendingConfirm["action"]): React.CSSProperties {
    const high = riskLabel(action) === "HIGH RISK";
    return {
        display: "inline-block",
        marginBottom: 8,
        padding: "3px 7px",
        borderRadius: 4,
        fontSize: 10,
        fontFamily: "monospace",
        letterSpacing: "0.12em",
        color: high ? "rgba(255,170,130,0.95)" : "rgba(150,190,230,0.9)",
        border: high
            ? "1px solid rgba(220,100,70,0.45)"
            : "1px solid rgba(100,150,200,0.35)",
    };
}

const summaryBoxStyle: React.CSSProperties = {
    margin: "12px 0",
    padding: "10px 12px",
    background: "rgba(220,150,80,0.08)",
    border: "1px solid rgba(220,150,80,0.18)",
    borderRadius: 6,
    color: "rgba(230,200,160,0.92)",
    fontSize: 13,
    lineHeight: 1.45,
};

const detailsStyle: React.CSSProperties = {
    margin: "12px 0 18px",
    color: "rgba(150,130,110,0.85)",
    fontSize: 11,
    fontFamily: "monospace",
};
