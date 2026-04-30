import { FeedEntry, FeedStatus } from "./types";

interface Props {
    feed: FeedEntry[];
    onDismiss: (actionId: string) => void;
}

export default function ActionFeed({ feed, onDismiss }: Props) {
    const visibleFeed = feed.filter(
        (entry) => !(entry.kind === "step" && entry.status === "completed"),
    );
    if (visibleFeed.length === 0) return null;

    return (
        <div
            style={{
                position: "fixed",
                top: 50,
                right: 14,
                zIndex: 8000,
                display: "flex",
                flexDirection: "column",
                gap: 6,
                width: 280,
                pointerEvents: "none",
            }}
        >
            {visibleFeed.map((entry) => (
                <FeedRow
                    key={entry.action_id}
                    entry={entry}
                    onDismiss={() => onDismiss(entry.action_id)}
                />
            ))}
        </div>
    );
}

function FeedRow({
    entry,
    onDismiss,
}: {
    entry: FeedEntry;
    onDismiss: () => void;
}) {
    const palette = STATUS_PALETTE[entry.status];
    const isStep = entry.kind === "step";
    return (
        <div
            style={{
                background: isStep ? "rgba(18,18,18,0.68)" : "rgba(20,20,20,0.85)",
                border: `1px solid ${isStep ? "rgba(120,120,120,0.16)" : palette.border}`,
                borderLeft: `3px solid ${isStep ? "rgba(130,130,130,0.28)" : palette.accent}`,
                borderRadius: 6,
                padding: "8px 10px 9px",
                fontSize: 11,
                fontFamily: "monospace",
                color: "rgba(210,180,140,0.9)",
                pointerEvents: "auto",
                backdropFilter: "blur(6px)",
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: 3,
                }}
            >
                <span
                    style={{
                        color: palette.accent,
                        opacity: isStep ? 0.48 : 1,
                        fontSize: 9,
                        letterSpacing: "0.18em",
                    }}
                >
                    {statusLabel(entry.status)}
                </span>
                <span
                    style={{
                        color: "rgba(150,170,200,0.7)",
                        opacity: isStep ? 0.5 : 1,
                        fontSize: 9,
                        letterSpacing: "0.1em",
                    }}
                >
                    {entry.type}
                </span>
                <button
                    onClick={onDismiss}
                    style={{
                        marginLeft: "auto",
                        background: "none",
                        border: "none",
                        color: "rgba(120,100,80,0.5)",
                        cursor: "pointer",
                        fontSize: 11,
                        padding: 0,
                        lineHeight: 1,
                    }}
                    title="Dismiss"
                >
                    {"✕"}
                </button>
            </div>
            {entry.description && (
                <div
                    style={{
                        color: "rgba(210,180,140,0.85)",
                        opacity: isStep ? 0.58 : 1,
                        fontSize: 11,
                        lineHeight: 1.35,
                        wordBreak: "break-word",
                    }}
                >
                    {formatDescription(entry)}
                </div>
            )}
            {entry.error && (
                <div
                    style={{
                        marginTop: 3,
                        color: "rgba(220,120,90,0.85)",
                        fontSize: 10,
                        wordBreak: "break-word",
                    }}
                >
                    {formatError(entry.error)}
                </div>
            )}
        </div>
    );
}

const STATUS_PALETTE: Record<
    FeedStatus,
    { accent: string; border: string }
> = {
    started: {
        accent: "rgba(150,200,230,0.85)",
        border: "rgba(100,150,200,0.25)",
    },
    completed: {
        accent: "rgba(150,200,140,0.85)",
        border: "rgba(110,170,110,0.3)",
    },
    failed: {
        accent: "rgba(220,120,90,0.85)",
        border: "rgba(180,80,60,0.35)",
    },
    rejected: {
        accent: "rgba(180,150,100,0.8)",
        border: "rgba(150,120,80,0.3)",
    },
    timeout: {
        accent: "rgba(210,160,80,0.85)",
        border: "rgba(180,130,60,0.35)",
    },
};

function statusLabel(status: FeedStatus): string {
    if (status === "started") return "RUNNING";
    return status.toUpperCase();
}

function formatDescription(entry: FeedEntry): string {
    if (entry.kind === "step") return entry.description;
    if (entry.status !== "started") {
        return terminalDescription(entry);
    }
    return `${stripProgressSuffix(entry.description)} 하는중...`;
}

function terminalDescription(entry: FeedEntry): string {
    const output = entry.output || {};
    const command = String(output.command || "");
    if (
        entry.status === "completed"
        && entry.type === "browser_control"
        && command === "select_result"
    ) {
        const index = Number(output.index || 1);
        const title = firstLine(output.title);
        return title
            ? `${index}번째 검색 결과를 열었습니다: ${title}`
            : `${index}번째 검색 결과를 열었습니다.`;
    }
    return entry.description;
}

function firstLine(value: unknown): string {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .split(/\s{2,}|\n/u)[0]
        .slice(0, 80);
}

function formatError(error: string): string {
    if (/JavaScript from Apple Events|Apple Events/i.test(error)) {
        return "Chrome에서 보기 > 개발자 > Apple Events의 JavaScript 허용을 켠 뒤 다시 시도하세요.";
    }
    if (/no active browser tab/i.test(error)) {
        return "활성 브라우저 탭을 앞으로 가져온 뒤 다시 시도하세요.";
    }
    if (/timed out|timeout/i.test(error)) {
        return "결과가 제시간에 확인되지 않았습니다.";
    }
    return error;
}

function stripProgressSuffix(value: string): string {
    return value
        .replace(/\s*하는중\.{0,3}\s*$/u, "")
        .replace(/\s*진행중\.{0,3}\s*$/u, "")
        .trim();
}
