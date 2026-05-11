interface Props {
    onLogout: () => void;
    onOpenSettings: () => void;
}

const baseBtn: React.CSSProperties = {
    position: "absolute",
    top: 52,
    zIndex: 70,
    background: "rgba(20,20,20,0.72)",
    border: "1px solid rgba(120,80,30,0.34)",
    borderRadius: 6,
    color: "rgba(210,180,140,0.82)",
    fontSize: 11,
    fontFamily: "monospace",
    letterSpacing: "0.1em",
    cursor: "pointer",
    padding: "8px 11px",
    backdropFilter: "blur(8px)",
    transition: "border-color 0.2s ease, color 0.2s ease, background 0.2s ease",
};

export default function CornerActions({ onLogout, onOpenSettings }: Props) {
    return (
        <>
            <button
                onClick={onLogout}
                style={{ ...baseBtn, right: 116 }}
                onMouseEnter={(e) =>
                    Object.assign(e.currentTarget.style, {
                        borderColor: "rgba(220,80,60,0.48)",
                        color: "rgba(245,150,130,0.95)",
                        background: "rgba(45,20,18,0.72)",
                    })
                }
                onMouseLeave={(e) =>
                    Object.assign(e.currentTarget.style, {
                        borderColor: "rgba(120,80,30,0.34)",
                        color: "rgba(210,180,140,0.82)",
                        background: "rgba(20,20,20,0.72)",
                    })
                }
                title="Logout"
            >
                LOGOUT
            </button>
            <button
                onClick={onOpenSettings}
                style={{ ...baseBtn, right: 18 }}
                onMouseEnter={(e) =>
                    Object.assign(e.currentTarget.style, {
                        borderColor: "rgba(194,149,107,0.62)",
                        color: "rgba(235,205,170,0.96)",
                        background: "rgba(38,28,18,0.78)",
                    })
                }
                onMouseLeave={(e) =>
                    Object.assign(e.currentTarget.style, {
                        borderColor: "rgba(120,80,30,0.34)",
                        color: "rgba(210,180,140,0.82)",
                        background: "rgba(20,20,20,0.72)",
                    })
                }
                title="Settings"
            >
                SETTINGS
            </button>
        </>
    );
}
