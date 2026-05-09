interface Props {
    value: boolean;
    onChange: (v: boolean) => void;
    label: string;
}

export default function Toggle({ value, onChange, label }: Props) {
    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 8,
            }}
        >
            <div
                onClick={() => onChange(!value)}
                style={{
                    width: 40,
                    height: 22,
                    borderRadius: 11,
                    cursor: "pointer",
                    background: value
                        ? "rgba(120,80,30,0.6)"
                        : "rgba(60,60,60,0.6)",
                    border: "1px solid rgba(120,80,30,0.3)",
                    position: "relative",
                    transition: "background 0.2s",
                }}
            >
                <div
                    style={{
                        width: 16,
                        height: 16,
                        borderRadius: 8,
                        position: "absolute",
                        top: 2,
                        left: value ? 20 : 2,
                        background: value
                            ? "rgba(210,180,140,0.9)"
                            : "rgba(100,100,100,0.6)",
                        transition: "left 0.2s",
                    }}
                />
            </div>
            <span style={{ fontSize: 12, color: "rgba(210,180,140,0.7)" }}>
                {label}
            </span>
        </div>
    );
}
