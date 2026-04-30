interface Props {
    text: string;
    dim?: boolean;
}

export default function AssistantSubtitle({ text, dim = false }: Props) {
    if (!text) return null;
    return (
        <div
            style={{
                position: "absolute",
                top: "5em",
                left: 0,
                right: 0,
                zIndex: 50,
                display: "flex",
                justifyContent: "center",
                padding: "0 48px",
            }}
        >
            <p
                style={{
                    textAlign: "center",
                    fontSize: 18,
                    color: dim
                        ? "rgba(210,180,140,0.45)"
                        : "rgba(210,180,140,0.9)",
                    textShadow: dim
                        ? "0 0 14px rgba(194,149,107,0.18)"
                        : "0 0 20px rgba(194,149,107,0.4)",
                    fontStyle: dim ? "italic" : "normal",
                    maxWidth: 900,
                    maxHeight: "42vh",
                    margin: 0,
                    lineHeight: 1.55,
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 12,
                    WebkitBoxOrient: "vertical",
                    transition: "color 0.2s ease, opacity 0.2s ease",
                }}
            >
                {text}
            </p>
        </div>
    );
}
