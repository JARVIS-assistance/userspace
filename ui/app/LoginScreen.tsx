import { useEffect, useState } from "react";
import AuthForm from "./login/AuthForm";
import { verifyToken } from "./login/auth";
import Brand from "./login/Brand";

interface Props {
    onLoginSuccess: (token: string) => void;
}

export default function LoginScreen({ onLoginSuccess }: Props) {
    const [ready, setReady] = useState(false);
    const [fadeOut, setFadeOut] = useState(false);

    useEffect(() => {
        const tryAutoLogin = async () => {
            const stored = localStorage.getItem("jarvis_token");
            if (!stored) {
                setReady(true);
                return;
            }

            if (await verifyToken(stored)) {
                setFadeOut(true);
                setTimeout(() => onLoginSuccess(stored), 600);
                return;
            }

            localStorage.removeItem("jarvis_token");
            setReady(true);
        };

        tryAutoLogin();
    }, [onLoginSuccess]);

    const handleAuthenticated = (token: string) => {
        localStorage.setItem("jarvis_token", token);
        setFadeOut(true);
        setTimeout(() => onLoginSuccess(token), 600);
    };

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

            <Brand />

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
                    <AuthForm onAuthenticated={handleAuthenticated} />
                )}
            </div>

            <style>{`
                @keyframes pulse {
                    0%, 100% { opacity: 0.4; }
                    50% { opacity: 1; }
                }
            `}</style>
        </div>
    );
}
