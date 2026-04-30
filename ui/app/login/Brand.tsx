export default function Brand() {
    return (
        <div style={{ marginBottom: 48, textAlign: "center" }}>
            <h1
                style={{
                    fontSize: 42,
                    fontWeight: 200,
                    letterSpacing: "0.35em",
                    color: "rgba(194,149,107,0.9)",
                    margin: 0,
                    textShadow: "0 0 40px rgba(194,149,107,0.3)",
                    fontFamily:
                        "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                }}
            >
                J.A.R.V.I.S
            </h1>
            <p
                style={{
                    fontSize: 11,
                    letterSpacing: "0.3em",
                    color: "rgba(120,80,40,0.5)",
                    marginTop: 8,
                    fontFamily: "monospace",
                }}
            >
                JUST A RATHER VERY INTELLIGENT SYSTEM
            </p>
        </div>
    );
}
