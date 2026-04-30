export const INPUT_STYLE: React.CSSProperties = {
    width: "100%",
    padding: "12px 18px",
    background: "rgba(30,30,30,0.8)",
    border: "1px solid rgba(120,80,30,0.3)",
    borderRadius: 8,
    color: "rgba(210,180,140,0.9)",
    fontSize: 15,
    outline: "none",
    letterSpacing: "0.05em",
    transition: "border-color 0.3s ease",
};

export const INPUT_ERROR_BORDER = "1px solid rgba(220,80,60,0.6)";

export const SUBMIT_BTN_STYLE = (loading: boolean): React.CSSProperties => ({
    width: "100%",
    padding: "11px 0",
    marginTop: 4,
    background: loading ? "rgba(80,60,30,0.3)" : "rgba(120,80,30,0.35)",
    border: "1px solid rgba(120,80,30,0.3)",
    borderRadius: 8,
    color: "rgba(210,180,140,0.85)",
    fontSize: 14,
    letterSpacing: "0.2em",
    cursor: loading ? "wait" : "pointer",
    transition: "all 0.2s ease",
});
