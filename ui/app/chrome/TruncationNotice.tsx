interface Props {
    visible: boolean;
    onContinueDeep: () => void;
    onDismiss: () => void;
}

export default function TruncationNotice({
    visible,
    onContinueDeep,
    onDismiss,
}: Props) {
    if (!visible) return null;

    return (
        <div
            style={{
                position: "fixed",
                right: 18,
                bottom: 92,
                zIndex: 7600,
                width: "min(360px, calc(100vw - 36px))",
                padding: "12px 14px",
                border: "1px solid rgba(190,145,80,0.32)",
                borderRadius: 8,
                background: "rgba(12,12,12,0.88)",
                color: "rgba(235,225,210,0.9)",
                boxShadow: "0 14px 38px rgba(0,0,0,0.38)",
                backdropFilter: "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
                fontSize: 12,
                lineHeight: 1.45,
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 8,
                    fontFamily: "monospace",
                    color: "rgba(230,185,110,0.9)",
                    letterSpacing: "0.08em",
                }}
            >
                <span>LIMIT</span>
                <button
                    type="button"
                    onClick={onDismiss}
                    title="닫기"
                    style={{
                        marginLeft: "auto",
                        border: "none",
                        background: "transparent",
                        color: "rgba(210,180,140,0.58)",
                        cursor: "pointer",
                        fontSize: 13,
                        lineHeight: 1,
                        padding: 2,
                    }}
                >
                    {"✕"}
                </button>
            </div>
            <div style={{ marginBottom: 10 }}>
                응답이 길어져 일부가 생략됐어요. 자세한 답변으로 전환할 수 있습니다.
            </div>
            <button
                type="button"
                onClick={onContinueDeep}
                style={{
                    border: "1px solid rgba(150,120,220,0.42)",
                    background: "rgba(150,120,220,0.16)",
                    color: "rgba(230,220,255,0.94)",
                    borderRadius: 6,
                    padding: "7px 10px",
                    fontSize: 12,
                    cursor: "pointer",
                }}
            >
                자세한 답변으로 이어보기
            </button>
        </div>
    );
}
