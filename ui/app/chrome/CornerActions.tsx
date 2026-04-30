interface Props {
    onLogout: () => void;
    onOpenSettings: () => void;
}

const baseBtn: React.CSSProperties = {
    position: "absolute",
    bottom: 14,
    zIndex: 50,
    background: "none",
    border: "none",
    color: "rgba(120,80,40,0.35)",
    fontSize: 11,
    fontFamily: "monospace",
    letterSpacing: "0.1em",
    cursor: "pointer",
    padding: "4px 8px",
    transition: "color 0.2s ease",
};

export default function CornerActions({ onLogout, onOpenSettings }: Props) {
    return (
        <>
            <button
                onClick={onLogout}
                style={{ ...baseBtn, left: 18 }}
                onMouseEnter={(e) =>
                    (e.currentTarget.style.color = "rgba(220,80,60,0.7)")
                }
                onMouseLeave={(e) =>
                    (e.currentTarget.style.color = "rgba(120,80,40,0.35)")
                }
                title="Logout"
            >
                LOGOUT
            </button>
            <button
                onClick={onOpenSettings}
                style={{ ...baseBtn, left: 90 }}
                onMouseEnter={(e) =>
                    (e.currentTarget.style.color = "rgba(194,149,107,0.7)")
                }
                onMouseLeave={(e) =>
                    (e.currentTarget.style.color = "rgba(120,80,40,0.35)")
                }
                title="Settings"
            >
                SETTINGS
            </button>
        </>
    );
}
