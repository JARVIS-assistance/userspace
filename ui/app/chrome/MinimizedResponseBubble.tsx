import type { FeedEntry } from "../actions/types";

interface Props {
    conversationText: string;
    conversationDim: boolean;
    planText: string;
    feed: FeedEntry[];
    chatOpen?: boolean;
    inputPosition?: { x: number; y: number } | null;
}

export default function MinimizedResponseBubble({
    conversationText,
    conversationDim,
    planText,
    feed,
    chatOpen = false,
    inputPosition = null,
}: Props) {
    void planText;
    void feed;
    const show = Boolean(conversationText.trim());

    if (!show) return null;

    const chatBubbleStyle = chatOpen
        ? {
              left: clamp(
                  (inputPosition?.x ?? window.innerWidth / 2) + 12,
                  12,
                  window.innerWidth - 320 - 12,
              ),
              top: clamp(
                  (inputPosition?.y ?? 96) - 74,
                  10,
                  window.innerHeight - 150,
              ),
              right: "auto",
              width: "min(320px, calc(100vw - 24px))",
          }
        : {};

    return (
        <div
            style={{
                position: "absolute",
                top: 14,
                right: 126,
                zIndex: 8500,
                width: "min(320px, calc(100vw - 150px))",
                maxHeight: chatOpen ? 70 : 112,
                padding: "10px 12px",
                background: "rgba(18,18,18,0.9)",
                border: "1px solid rgba(120,80,30,0.38)",
                borderRadius: 12,
                color: "rgba(220,190,150,0.95)",
                backdropFilter: "blur(12px)",
                overflow: "hidden",
                boxShadow: "0 10px 28px rgba(0,0,0,0.28)",
                pointerEvents: "none",
                ...chatBubbleStyle,
            }}
        >
            {!chatOpen && (
                <div
                    style={{
                        position: "absolute",
                        right: -6,
                        top: 52,
                        width: 12,
                        height: 12,
                        background: "rgba(18,18,18,0.9)",
                        borderRight: "1px solid rgba(120,80,30,0.38)",
                        borderTop: "1px solid rgba(120,80,30,0.38)",
                        transform: "rotate(45deg)",
                    }}
                />
            )}
            {conversationText.trim() && (
                <div
                    style={{
                        color: conversationDim
                            ? "rgba(210,180,140,0.58)"
                            : "rgba(230,205,170,0.96)",
                        fontSize: 13,
                        lineHeight: 1.45,
                        maxHeight: chatOpen ? 50 : 90,
                        overflow: "hidden",
                        display: "-webkit-box",
                        WebkitLineClamp: chatOpen ? 2 : 4,
                        WebkitBoxOrient: "vertical",
                        wordBreak: "break-word",
                    }}
                >
                    {conversationText}
                </div>
            )}
        </div>
    );
}

function clamp(value: number, min: number, max: number): number {
    if (max < min) return min;
    return Math.max(min, Math.min(max, value));
}
