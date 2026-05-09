import { useEffect, useRef, useState } from "react";
import { login, signup, type Mode } from "./auth";
import { INPUT_ERROR_BORDER, INPUT_STYLE, SUBMIT_BTN_STYLE } from "./styles";

interface Props {
    onAuthenticated: (token: string) => void;
}

export default function AuthForm({ onAuthenticated }: Props) {
    const [mode, setMode] = useState<Mode>("login");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [name, setName] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const emailRef = useRef<HTMLInputElement>(null);
    const passwordRef = useRef<HTMLInputElement>(null);
    const nameRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const t = setTimeout(() => emailRef.current?.focus(), 100);
        return () => clearTimeout(t);
    }, []);

    const switchMode = () => {
        setMode((m) => (m === "login" ? "register" : "login"));
        setError("");
        setPassword("");
        setName("");
        setTimeout(() => emailRef.current?.focus(), 50);
    };

    const handleSubmit = async () => {
        if (!email.trim() || !password.trim() || loading) return;
        if (mode === "register" && !name.trim()) return;
        setLoading(true);
        setError("");

        const result =
            mode === "register"
                ? await signup(email.trim(), password.trim(), name.trim())
                : await login(email.trim(), password.trim());

        if (result.token) {
            onAuthenticated(result.token);
        } else {
            setError(result.error || "Authentication failed");
            setPassword("");
            passwordRef.current?.focus();
        }
        setLoading(false);
    };

    const isLogin = mode === "login";
    const inputBorder = error ? INPUT_ERROR_BORDER : INPUT_STYLE.border;

    return (
        <>
            {!isLogin && (
                <input
                    ref={nameRef}
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                        if (e.key === "Enter") {
                            e.preventDefault();
                            emailRef.current?.focus();
                        }
                    }}
                    placeholder="Name"
                    autoComplete="name"
                    style={{ ...INPUT_STYLE, border: inputBorder }}
                />
            )}

            <input
                ref={emailRef}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                    if (e.key === "Enter") {
                        e.preventDefault();
                        passwordRef.current?.focus();
                    }
                }}
                placeholder="Email"
                autoFocus
                autoComplete="email"
                style={{ ...INPUT_STYLE, border: inputBorder }}
            />

            <input
                ref={passwordRef}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                    if (e.key === "Enter") {
                        e.preventDefault();
                        handleSubmit();
                    }
                }}
                placeholder="Password"
                autoComplete={isLogin ? "current-password" : "new-password"}
                style={{ ...INPUT_STYLE, border: inputBorder }}
            />

            <button
                onClick={handleSubmit}
                disabled={
                    loading ||
                    !email.trim() ||
                    !password.trim() ||
                    (!isLogin && !name.trim())
                }
                style={SUBMIT_BTN_STYLE(loading)}
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
    );
}
