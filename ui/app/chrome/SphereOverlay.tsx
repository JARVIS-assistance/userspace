interface Props {
    subtitle: string;
    micActive: boolean;
    onSphereClick: () => void;
}

export default function SphereOverlay({ subtitle, micActive, onSphereClick }: Props) {
    return (
        <div
            style={{
                position: "absolute",
                inset: 0,
                zIndex: 50,
                display: "flex",
                alignItems: "center",
                pointerEvents: "none",
            }}
        >
            {subtitle ? (
                <div
                    style={{
                        flex: 1,
                        padding: "8px 12px",
                        marginLeft: 12,
                        marginRight: 20,
                        background: "rgba(30,30,30,0.85)",
                        border: "1px solid rgba(120,80,30,0.4)",
                        borderRadius: 10,
                        color: "rgba(210,180,140,0.9)",
                        fontSize: 12,
                        lineHeight: 1.4,
                        maxHeight: "100%",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        pointerEvents: "auto",
                        backdropFilter: "blur(6px)",
                    }}
                >
                    {subtitle}
                </div>
            ) : micActive ? (
                <div
                    style={{
                        flex: 1,
                        padding: "8px 12px",
                        marginLeft: 12,
                        marginRight: 20,
                        color: "rgba(120,80,40,0.6)",
                        fontSize: 11,
                        fontFamily: "monospace",
                        letterSpacing: "0.15em",
                        pointerEvents: "none",
                    }}
                >
                    LISTENING...
                </div>
            ) : null}
            <div
                onClick={onSphereClick}
                style={{
                    width: 120,
                    minWidth: 120,
                    height: "100%",
                    cursor: "pointer",
                    pointerEvents: "auto",
                }}
            />
        </div>
    );
}
