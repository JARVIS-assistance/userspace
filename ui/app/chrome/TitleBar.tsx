interface Props {
    onMinimize: () => void;
    onClose: () => void;
}

export default function TitleBar({ onMinimize, onClose }: Props) {
    return (
        <div
            style={
                {
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 40,
                    zIndex: 50,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    WebkitAppRegion: "drag",
                } as React.CSSProperties
            }
        >
            <div
                style={
                    {
                        display: "flex",
                        gap: 4,
                        marginRight: 12,
                        WebkitAppRegion: "no-drag",
                    } as React.CSSProperties
                }
            >
                <button
                    onClick={onMinimize}
                    style={{
                        width: 28,
                        height: 28,
                        background: "none",
                        border: "none",
                        color: "#888",
                        cursor: "pointer",
                        fontSize: 14,
                    }}
                    title="Minimize"
                >
                    &#9679;
                </button>
                <button
                    onClick={onClose}
                    style={{
                        width: 28,
                        height: 28,
                        background: "none",
                        border: "none",
                        color: "#888",
                        cursor: "pointer",
                        fontSize: 14,
                    }}
                    title="Close"
                >
                    &#10005;
                </button>
            </div>
        </div>
    );
}
