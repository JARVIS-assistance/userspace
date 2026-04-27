import { useState, useRef, useEffect, useCallback } from "react";

const AUTH_BASE_URL_FALLBACK = "http://127.0.0.1:8001";

async function resolveAuthBaseUrl(): Promise<string> {
    try {
        const bridge = (window as any).jarvisBridge;
        if (bridge?.getUserspaceConfig) {
            const config = await bridge.getUserspaceConfig();
            const candidate =
                typeof config?.authApiBase === "string"
                    ? config.authApiBase.trim()
                    : "";
            if (candidate) return candidate.replace(/\/+$/, "");
        }
    } catch (_) {}

    return AUTH_BASE_URL_FALLBACK;
}

type Mode = "login" | "register";

interface Props {
    onLoginSuccess: (token: string) => void;
}

const INPUT_STYLE: React.CSSProperties = {
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

const INPUT_ERROR_BORDER = "1px solid rgba(220,80,60,0.6)";

export default function LoginScreen({ onLoginSuccess }: Props) {
    const [mode, setMode] = useState<Mode>("login");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [name, setName] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [ready, setReady] = useState(false);
    const [fadeOut, setFadeOut] = useState(false);
    const emailRef = useRef<HTMLInputElement>(null);
    const passwordRef = useRef<HTMLInputElement>(null);
    const nameRef = useRef<HTMLInputElement>(null);

    // Try auto-login with stored token on mount
    useEffect(() => {
        const tryAutoLogin = async () => {
            const stored = localStorage.getItem("jarvis_token");
            if (!stored) {
                setReady(true);
                setTimeout(() => emailRef.current?.focus(), 100);
                return;
            }

            try {
                const authBaseUrl = await resolveAuthBaseUrl();
                const res = await fetch(`${authBaseUrl}/auth/me`, {
                    headers: { Authorization: `Bearer ${stored}` },
                });
                if (res.ok) {
                    setFadeOut(true);
                    setTimeout(() => onLoginSuccess(stored), 600);
                    return;
                }
            } catch (_) {}

            localStorage.removeItem("jarvis_token");
            setReady(true);
            setTimeout(() => emailRef.current?.focus(), 100);
        };

        tryAutoLogin();
    }, [onLoginSuccess]);

    const switchMode = useCallback(() => {
        setMode((m) => (m === "login" ? "register" : "login"));
        setError("");
        setPassword("");
        setName("");
        setTimeout(() => emailRef.current?.focus(), 50);
    }, []);

    const handleSubmit = useCallback(async () => {
        if (!email.trim() || !password.trim() || loading) return;
        if (mode === "register" && !name.trim()) return;
        setLoading(true);
        setError("");

        try {
            const authBaseUrl = await resolveAuthBaseUrl();
            if (mode === "register") {
                // ── Register ──
                const regRes = await fetch(`${authBaseUrl}/auth/signup`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        email: email.trim(),
                        password: password.trim(),
                        name: name.trim(),
                    }),
                });
                const regData = await regRes.json();

                if (regRes.ok && regData.access_token) {
                    localStorage.setItem("jarvis_token", regData.access_token);
                    setFadeOut(true);
                    setTimeout(() => onLoginSuccess(regData.access_token), 600);
                } else {
                    setError(regData.detail || regData.message || "Registration failed");
                    setPassword("");
                    passwordRef.current?.focus();
                }
            } else {
                // ── Login ──
                const res = await fetch(`${authBaseUrl}/auth/login`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        username: email.trim(),
                        password: password.trim(),
                    }),
                });
                const data = await res.json();

                if (res.ok && data.access_token) {
                    localStorage.setItem("jarvis_token", data.access_token);
                    setFadeOut(true);
                    setTimeout(() => onLoginSuccess(data.access_token), 600);
                } else {
                    setError(data.detail || data.message || "Authentication failed");
                    setPassword("");
                    passwordRef.current?.focus();
                }
            }
        } catch (err) {
            setError("Cannot connect to server");
        } finally {
            setLoading(false);
        }
    }, [email, password, name, loading, mode, onLoginSuccess]);

    const isLogin = mode === "login";

    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                background: "#000",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 9999,
                opacity: fadeOut ? 0 : 1,
                transition: "opacity 0.5s ease",
            }}
        >
            {/* Title bar drag region */}
            <div
                style={
                    {
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        height: 40,
                        WebkitAppRegion: "drag",
                    } as React.CSSProperties
                }
            />

            {/* Close button */}
            <button
                onClick={() => (window as any).jarvisBridge?.closeWindow?.()}
                style={
                    {
                        position: "absolute",
                        top: 10,
                        right: 14,
                        width: 28,
                        height: 28,
                        background: "none",
                        border: "none",
                        color: "#555",
                        cursor: "pointer",
                        fontSize: 14,
                        WebkitAppRegion: "no-drag",
                    } as React.CSSProperties
                }
                title="Close"
            >
                &#10005;
            </button>

            {/* JARVIS logo text */}
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

            {/* Form */}
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 12,
                    width: 320,
                }}
            >
                {!ready ? (
                    <p
                        style={{
                            fontSize: 13,
                            color: "rgba(120,80,40,0.6)",
                            fontFamily: "monospace",
                            letterSpacing: "0.15em",
                            animation: "pulse 1.5s ease-in-out infinite",
                        }}
                    >
                        INITIALIZING...
                    </p>
                ) : (
                    <>
                        {/* Name field — register only */}
                        {!isLogin && (
                            <input
                                ref={nameRef}
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        emailRef.current?.focus();
                                    }
                                }}
                                placeholder="Name"
                                autoComplete="name"
                                style={{
                                    ...INPUT_STYLE,
                                    border: error ? INPUT_ERROR_BORDER : INPUT_STYLE.border,
                                }}
                            />
                        )}

                        <input
                            ref={emailRef}
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    passwordRef.current?.focus();
                                }
                            }}
                            placeholder="Email"
                            autoFocus
                            autoComplete="email"
                            style={{
                                ...INPUT_STYLE,
                                border: error ? INPUT_ERROR_BORDER : INPUT_STYLE.border,
                            }}
                        />

                        <input
                            ref={passwordRef}
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    handleSubmit();
                                }
                            }}
                            placeholder="Password"
                            autoComplete={isLogin ? "current-password" : "new-password"}
                            style={{
                                ...INPUT_STYLE,
                                border: error ? INPUT_ERROR_BORDER : INPUT_STYLE.border,
                            }}
                        />

                        <button
                            onClick={handleSubmit}
                            disabled={
                                loading ||
                                !email.trim() ||
                                !password.trim() ||
                                (!isLogin && !name.trim())
                            }
                            style={{
                                width: "100%",
                                padding: "11px 0",
                                marginTop: 4,
                                background: loading
                                    ? "rgba(80,60,30,0.3)"
                                    : "rgba(120,80,30,0.35)",
                                border: "1px solid rgba(120,80,30,0.3)",
                                borderRadius: 8,
                                color: "rgba(210,180,140,0.85)",
                                fontSize: 14,
                                letterSpacing: "0.2em",
                                cursor: loading ? "wait" : "pointer",
                                transition: "all 0.2s ease",
                            }}
                        >
                            {loading
                                ? "VERIFYING..."
                                : isLogin
                                  ? "AUTHENTICATE"
                                  : "CREATE ACCOUNT"}
                        </button>

                        {error && (
                            <p
                                style={{
                                    fontSize: 12,
                                    color: "rgba(220,80,60,0.8)",
                                    margin: 0,
                                    fontFamily: "monospace",
                                }}
                            >
                                {error}
                            </p>
                        )}

                        {/* Toggle login / register */}
                        <p
                            style={{
                                fontSize: 12,
                                color: "rgba(120,80,40,0.5)",
                                margin: "8px 0 0",
                                fontFamily: "monospace",
                            }}
                        >
                            {isLogin ? "Don't have an account? " : "Already have an account? "}
                            <span
                                onClick={switchMode}
                                style={{
                                    color: "rgba(194,149,107,0.8)",
                                    cursor: "pointer",
                                    textDecoration: "underline",
                                    textUnderlineOffset: 3,
                                }}
                            >
                                {isLogin ? "Sign up" : "Sign in"}
                            </span>
                        </p>
                    </>
                )}
            </div>

            {/* CSS animation */}
            <style>{`
                @keyframes pulse {
                    0%, 100% { opacity: 0.4; }
                    50% { opacity: 1; }
                }
            `}</style>
        </div>
    );
}
