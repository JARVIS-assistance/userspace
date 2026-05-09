interface Props {
    text: string;
    chatOpen: boolean;
}

export default function PlanToast({ text, chatOpen }: Props) {
    return (
        <div
            style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: chatOpen ? 118 : 104,
                zIndex: 55,
                display: "flex",
                justifyContent: "center",
                pointerEvents: "none",
                padding: "0 20px",
                opacity: text ? 1 : 0,
                transform: text ? "translateY(0)" : "translateY(6px)",
                transition: "opacity 240ms ease, transform 240ms ease",
            }}
        >
            <div
                style={{
                    maxWidth: 600,
                    minHeight: 18,
                    color: "rgba(255, 255, 255, 0.28)",
                    fontSize: 10,
                    lineHeight: 1.4,
                    textAlign: "center",
                    textShadow: "0 0 12px rgba(210,180,140,0.16)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                }}
            >
                {text}
            </div>
        </div>
    );
}
