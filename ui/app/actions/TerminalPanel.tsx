import { formatFeedDescription, statusLabel } from "./ActionFeed";
import type { FeedEntry } from "./types";

interface Props {
    entry: FeedEntry;
    onClose: () => void;
}

export default function TerminalPanel({ entry, onClose }: Props) {
    const output = entry.output || {};
    const stdout = stringValue(output.stdout);
    const stderr = stringValue(output.stderr);
    const cwd = stringValue(output.cwd);
    const returnCode = typeof output.exit_code === "number"
        ? output.exit_code
        : output.returncode;
    const truncated = output.truncated === true;
    const description = entry.description || entry.type;
    const isRunning = entry.status === "running" || entry.status === "queued";
    const hasOutput = stdout || stderr || entry.error;

    return (
        <section
            aria-label="Terminal action"
            style={{
                position: "fixed",
                left: 16,
                top: 62,
                bottom: 82,
                width: "min(430px, calc(100vw - 32px))",
                zIndex: 7600,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                color: "rgba(235,225,210,0.94)",
                background: "rgba(10,10,10,0.86)",
                border: "1px solid rgba(190,145,80,0.32)",
                borderRadius: 8,
                boxShadow: "0 20px 54px rgba(0,0,0,0.42)",
                backdropFilter: "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
            }}
        >
            <header
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 12px 8px",
                    borderBottom: "1px solid rgba(190,145,80,0.18)",
                    fontFamily: "monospace",
                }}
            >
                <span
                    style={{
                        color: statusColor(entry.status),
                        fontSize: 10,
                        letterSpacing: "0.14em",
                    }}
                >
                    {statusLabel(entry.status)}
                </span>
                <span
                    style={{
                        color: "rgba(150,170,200,0.72)",
                        fontSize: 10,
                        letterSpacing: "0.1em",
                    }}
                >
                    TERMINAL
                </span>
                <button
                    type="button"
                    onClick={onClose}
                    title="Close terminal output"
                    style={{
                        marginLeft: "auto",
                        border: "none",
                        background: "transparent",
                        color: "rgba(210,180,140,0.64)",
                        cursor: "pointer",
                        fontSize: 14,
                        lineHeight: 1,
                        padding: 2,
                    }}
                >
                    {"✕"}
                </button>
            </header>

            <div
                style={{
                    padding: "10px 12px 8px",
                    borderBottom: "1px solid rgba(190,145,80,0.12)",
                    fontFamily: "monospace",
                    fontSize: 11,
                    lineHeight: 1.42,
                }}
            >
                <div
                    style={{
                        color: "rgba(235,210,170,0.92)",
                        wordBreak: "break-word",
                    }}
                >
                    $ {formatFeedDescription(entry) || description}
                </div>
                {cwd && (
                    <div
                        style={{
                            marginTop: 4,
                            color: "rgba(160,170,185,0.62)",
                            wordBreak: "break-word",
                        }}
                    >
                        cwd: {cwd}
                    </div>
                )}
                {typeof returnCode === "number" && (
                    <div
                        style={{
                            marginTop: 4,
                            color: "rgba(160,170,185,0.62)",
                        }}
                    >
                        exit: {returnCode}
                    </div>
                )}
            </div>

            <div
                style={{
                    flex: 1,
                    overflow: "auto",
                    padding: 12,
                    fontFamily: "monospace",
                    fontSize: 11,
                    lineHeight: 1.45,
                    color: "rgba(230,230,220,0.88)",
                }}
            >
                {!hasOutput && isRunning && (
                    <div style={{ color: "rgba(210,180,140,0.7)" }}>
                        명령 실행 중...
                    </div>
                )}
                {stdout && <TerminalBlock label="stdout" text={stdout} />}
                {stderr && (
                    <TerminalBlock
                        label="stderr"
                        text={stderr}
                        color="rgba(245,145,110,0.9)"
                    />
                )}
                {entry.error && (
                    <TerminalBlock
                        label="error"
                        text={entry.error}
                        color="rgba(245,120,110,0.92)"
                    />
                )}
                {truncated && (
                    <div
                        style={{
                            marginTop: 10,
                            color: "rgba(230,180,90,0.86)",
                        }}
                    >
                        출력이 길어 일부만 표시했습니다.
                    </div>
                )}
            </div>
        </section>
    );
}

function TerminalBlock({
    label,
    text,
    color = "rgba(230,230,220,0.88)",
}: {
    label: string;
    text: string;
    color?: string;
}) {
    return (
        <div style={{ marginBottom: 12 }}>
            <div
                style={{
                    marginBottom: 4,
                    color: "rgba(150,170,200,0.62)",
                    fontSize: 10,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                }}
            >
                {label}
            </div>
            <pre
                style={{
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    color,
                    font: "inherit",
                }}
            >
                {text}
            </pre>
        </div>
    );
}

function stringValue(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function statusColor(status: FeedEntry["status"]): string {
    if (status === "completed") return "rgba(150,210,150,0.92)";
    if (status === "failed" || status === "timeout" || status === "invalid") {
        return "rgba(235,125,95,0.92)";
    }
    if (status === "waiting_confirmation") return "rgba(235,190,95,0.92)";
    return "rgba(150,205,235,0.9)";
}
