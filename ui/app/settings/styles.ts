export const css = {
    overlay: {
        position: "fixed" as const,
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(8px)",
        zIndex: 9000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    modal: {
        background: "#111",
        border: "1px solid rgba(120,80,30,0.3)",
        borderRadius: 14,
        width: 520,
        maxHeight: "85vh",
        overflow: "auto",
        padding: "28px 32px",
        color: "rgba(210,180,140,0.9)",
        fontSize: 14,
    },
    header: {
        display: "flex" as const,
        justifyContent: "space-between" as const,
        alignItems: "center" as const,
        marginBottom: 24,
    },
    title: {
        fontSize: 18,
        fontWeight: 300 as const,
        letterSpacing: "0.15em",
        color: "rgba(194,149,107,0.9)",
        margin: 0,
    },
    closeBtn: {
        background: "none",
        border: "none",
        color: "rgba(120,80,40,0.5)",
        fontSize: 18,
        cursor: "pointer",
        padding: "4px 8px",
    },
    tabs: {
        display: "flex" as const,
        gap: 0,
        marginBottom: 24,
        borderBottom: "1px solid rgba(120,80,30,0.2)",
    },
    tab: (on: boolean): React.CSSProperties => ({
        padding: "10px 20px",
        background: "none",
        border: "none",
        borderBottom: on
            ? "2px solid rgba(194,149,107,0.8)"
            : "2px solid transparent",
        color: on ? "rgba(210,180,140,0.9)" : "rgba(120,80,40,0.5)",
        fontSize: 13,
        letterSpacing: "0.1em",
        cursor: "pointer",
    }),
    label: {
        display: "block" as const,
        fontSize: 11,
        letterSpacing: "0.1em",
        color: "rgba(120,80,40,0.6)",
        marginBottom: 6,
        fontFamily: "monospace",
    },
    input: {
        width: "100%",
        padding: "10px 14px",
        background: "rgba(30,30,30,0.8)",
        border: "1px solid rgba(120,80,30,0.25)",
        borderRadius: 6,
        color: "rgba(210,180,140,0.9)",
        fontSize: 13,
        outline: "none",
        boxSizing: "border-box" as const,
    },
    select: {
        width: "100%",
        padding: "10px 14px",
        background: "rgba(30,30,30,0.8)",
        border: "1px solid rgba(120,80,30,0.25)",
        borderRadius: 6,
        color: "rgba(210,180,140,0.9)",
        fontSize: 13,
        outline: "none",
        boxSizing: "border-box" as const,
        appearance: "none" as const,
    },
    row: { display: "flex" as const, gap: 12, marginBottom: 12 },
    half: { flex: 1 },
    btn: (v: "primary" | "ghost" | "danger"): React.CSSProperties => ({
        padding: "9px 18px",
        borderRadius: 6,
        fontSize: 12,
        letterSpacing: "0.08em",
        cursor: "pointer",
        border:
            v === "danger"
                ? "1px solid rgba(220,80,60,0.4)"
                : "1px solid rgba(120,80,30,0.3)",
        background:
            v === "primary"
                ? "rgba(120,80,30,0.35)"
                : v === "danger"
                  ? "rgba(220,80,60,0.15)"
                  : "transparent",
        color:
            v === "danger" ? "rgba(220,80,60,0.8)" : "rgba(210,180,140,0.85)",
    }),
    card: {
        border: "1px solid rgba(120,80,30,0.2)",
        borderRadius: 8,
        padding: "14px 16px",
        marginBottom: 10,
        background: "rgba(20,20,20,0.6)",
    },
    badge: (c: string): React.CSSProperties => ({
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 10,
        letterSpacing: "0.08em",
        fontFamily: "monospace",
        background: `${c}20`,
        color: c,
        marginRight: 6,
    }),
    iconBtn: (on: boolean): React.CSSProperties => ({
        width: 44,
        height: 44,
        borderRadius: 10,
        fontSize: 22,
        cursor: "pointer",
        border: on
            ? "2px solid rgba(194,149,107,0.8)"
            : "1px solid rgba(120,80,30,0.2)",
        background: on ? "rgba(120,80,30,0.25)" : "rgba(30,30,30,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    }),
};
