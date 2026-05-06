import { forwardRef } from "react";

interface Props {
    x: number;
    y: number;
    value: string;
    stopVisible: boolean;
    inputDisabled: boolean;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onStop: () => void;
}

const FloatingChatInput = forwardRef<HTMLInputElement, Props>(
    function FloatingChatInput(
        { x, y, value, stopVisible, inputDisabled, onChange, onSubmit, onStop },
        ref,
    ) {
        const width = 360;
        const left = clamp(x - width / 2, 8, window.innerWidth - width - 8);
        const top = clamp(y + 16, 8, window.innerHeight - 58);

        return (
            <div
                style={{
                    position: "absolute",
                    left,
                    top,
                    zIndex: 9000,
                    width,
                    display: "flex",
                    gap: 8,
                    pointerEvents: "auto",
                    filter: "drop-shadow(0 8px 24px rgba(0,0,0,0.45))",
                }}
            >
                <input
                    ref={ref}
                    type="text"
                    value={value}
                    disabled={inputDisabled}
                    onChange={(e) => onChange(e.target.value)}
                    onKeyDown={(e) => {
                        if (inputDisabled) return;
                        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            onSubmit();
                        }
                    }}
                    placeholder={inputDisabled ? "작업 처리 중..." : "메시지를 입력하세요..."}
                    style={{
                        flex: 1,
                        minWidth: 0,
                        padding: "10px 14px",
                        background: "rgba(24,24,24,0.92)",
                        border: "1px solid rgba(120,80,30,0.45)",
                        borderRadius: 8,
                        color: "rgba(210,180,140,0.95)",
                        fontSize: 13,
                        outline: "none",
                        backdropFilter: "blur(10px)",
                        opacity: inputDisabled ? 0.55 : 1,
                        cursor: inputDisabled ? "not-allowed" : "text",
                    }}
                />
                {stopVisible && (
                    <button
                        onClick={onStop}
                        title="응답/추론 중단 (Esc)"
                        style={{
                            padding: "10px 16px",
                            background: "rgba(85,30,26,0.72)",
                            border: "1px solid rgba(220,90,70,0.55)",
                            borderRadius: 8,
                            color: "rgba(245,180,160,0.95)",
                            fontSize: 13,
                            cursor: "pointer",
                        }}
                    >
                        ■
                    </button>
                )}
                <button
                    disabled={inputDisabled}
                    onClick={onSubmit}
                    style={{
                        padding: "10px 16px",
                        background: inputDisabled
                            ? "rgba(70,60,50,0.45)"
                            : "rgba(120,80,30,0.55)",
                        border: "1px solid rgba(120,80,30,0.45)",
                        borderRadius: 8,
                        color: inputDisabled
                            ? "rgba(150,130,105,0.6)"
                            : "rgba(210,180,140,0.95)",
                        fontSize: 13,
                        cursor: inputDisabled ? "not-allowed" : "pointer",
                    }}
                >
                    ↵
                </button>
            </div>
        );
    },
);

function clamp(value: number, min: number, max: number): number {
    if (max < min) return min;
    return Math.max(min, Math.min(max, value));
}

export default FloatingChatInput;
