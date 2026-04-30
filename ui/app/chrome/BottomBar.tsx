import { forwardRef } from "react";

interface Props {
    userSubtitle: string;
    sttListening: boolean;
    micActive: boolean;
    chatOpen: boolean;
    chatInput: string;
    stopVisible: boolean;
    onChatInputChange: (v: string) => void;
    onChatSubmit: () => void;
    onStop: () => void;
}

const ChatInput = forwardRef<HTMLInputElement, {
    value: string;
    stopVisible: boolean;
    onChange: (v: string) => void;
    onSubmit: () => void;
    onStop: () => void;
}>(function ChatInput({ value, stopVisible, onChange, onSubmit, onStop }, ref) {
    return (
        <div
            style={{
                width: "100%",
                maxWidth: 600,
                display: "flex",
                gap: 8,
            }}
        >
            <input
                ref={ref}
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => {
                    // 한글 IME composition 중의 Enter는 무시
                    // (마지막 음절이 다음 frame에 다시 submit되는 버그 방지)
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                    if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        onSubmit();
                    }
                }}
                placeholder="메시지를 입력하세요..."
                style={{
                    flex: 1,
                    padding: "10px 16px",
                    background: "rgba(30,30,30,0.8)",
                    border: "1px solid rgba(120,80,30,0.3)",
                    borderRadius: 8,
                    color: "rgba(210,180,140,0.9)",
                    fontSize: 14,
                    outline: "none",
                    backdropFilter: "blur(8px)",
                }}
            />
            {stopVisible && (
                <button
                    onClick={onStop}
                    title="응답/추론 중단 (Esc)"
                    style={{
                        padding: "10px 20px",
                        background: "rgba(85,30,26,0.55)",
                        border: "1px solid rgba(220,90,70,0.45)",
                        borderRadius: 8,
                        color: "rgba(245,180,160,0.95)",
                        fontSize: 14,
                        cursor: "pointer",
                    }}
                >
                    ■
                </button>
            )}
            <button
                onClick={onSubmit}
                style={{
                    padding: "10px 20px",
                    background: "rgba(120,80,30,0.4)",
                    border: "1px solid rgba(120,80,30,0.3)",
                    borderRadius: 8,
                    color: "rgba(210,180,140,0.9)",
                    fontSize: 14,
                    cursor: "pointer",
                }}
            >
                ↵
            </button>
        </div>
    );
});

const BottomBar = forwardRef<HTMLInputElement, Props>(function BottomBar(
    {
        userSubtitle,
        sttListening,
        micActive,
        chatOpen,
        chatInput,
        stopVisible,
        onChatInputChange,
        onChatSubmit,
        onStop,
    },
    chatInputRef,
) {
    return (
        <div
            style={{
                position: "absolute",
                bottom: 32,
                left: 0,
                right: 0,
                zIndex: 50,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                padding: "0 32px",
                gap: 16,
            }}
        >
            {userSubtitle && (micActive || sttListening) ? (
                <p
                    style={{
                        textAlign: "center",
                        fontSize: 18,
                        color: "rgba(150,200,230,0.85)",
                        textShadow: "0 0 16px rgba(100,180,220,0.4)",
                        maxWidth: 1100,
                        margin: 0,
                    }}
                >
                    {userSubtitle}
                </p>
            ) : (
                <p
                    style={{
                        textAlign: "center",
                        fontSize: 13,
                        color: "rgba(120,80,40,0.5)",
                        letterSpacing: "0.2em",
                        fontFamily: "monospace",
                        margin: 0,
                    }}
                >
                    {micActive
                        ? "LISTENING..."
                        : "PRESS ENTER TO CHAT · CTRL+P TO SPEAK"}
                </p>
            )}

            {chatOpen && (
                <ChatInput
                    ref={chatInputRef}
                    value={chatInput}
                    stopVisible={stopVisible}
                    onChange={onChatInputChange}
                    onSubmit={onChatSubmit}
                    onStop={onStop}
                />
            )}
        </div>
    );
});

export default BottomBar;
