interface Props {
    visible: boolean;
    onStop: () => void;
}

export default function StopButton({ visible, onStop }: Props) {
    if (!visible) return null;
    return (
        <div
            style={{
                position: "absolute",
                top: "calc(5em + 230px)", // 자막 아래쯤
                left: 0,
                right: 0,
                zIndex: 60,
                display: "flex",
                justifyContent: "center",
                pointerEvents: "none",
            }}
        >
            <button
                onClick={onStop}
                title="응답/추론 중단 (Esc)"
                style={{
                    pointerEvents: "auto",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "7px 16px 7px 12px",
                    background: "rgba(40,18,16,0.85)",
                    border: "1px solid rgba(220,90,70,0.5)",
                    borderRadius: 18,
                    color: "rgba(245,180,160,0.95)",
                    fontSize: 11,
                    fontFamily: "monospace",
                    letterSpacing: "0.18em",
                    cursor: "pointer",
                    boxShadow: "0 0 18px rgba(220,90,70,0.18)",
                    backdropFilter: "blur(6px)",
                    transition: "background 0.15s, border 0.15s",
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(60,22,20,0.95)";
                    e.currentTarget.style.border = "1px solid rgba(220,90,70,0.85)";
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(40,18,16,0.85)";
                    e.currentTarget.style.border = "1px solid rgba(220,90,70,0.5)";
                }}
            >
                <span
                    style={{
                        display: "inline-block",
                        width: 9,
                        height: 9,
                        borderRadius: 1,
                        background: "rgba(245,180,160,0.95)",
                    }}
                />
                STOP
            </button>
        </div>
    );
}
