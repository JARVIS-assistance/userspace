import { useEffect, useRef, useState, useCallback } from "react";
import SandParticles, { type ViewMode } from "./SandParticles";
import SettingsModal from "./SettingsModal";

const SAMPLE_RATE = 16000;
const CHUNK_SIZE = 4096;
const FFT_SIZE = 256;

// Shared audio buffer — SandParticles reads this directly, no React re-renders
export type AudioState = "idle" | "listening" | "speaking";
export const sharedAudioRef = {
    current: null as Uint8Array | null,
    active: false,
    state: "idle" as AudioState,
    // speaking 애니메이션용: delta 도착 시 펄스
    speakingPulse: 0,
};

function float32ToInt16Array(f32: Float32Array): number[] {
    const out: number[] = new Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
        const s = Math.max(-1, Math.min(1, f32[i]));
        out[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
    }
    return out;
}

interface AppProps {
    token: string;
    onLogout: () => void;
}

export default function App({ token, onLogout }: AppProps) {
    const [micActive, setMicActive] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [userSubtitle, setUserSubtitle] = useState("");
    const [assistantSubtitle, setAssistantSubtitle] = useState("");
    const [sttState, setSttState] = useState<string>("idle");
    const [wsStatus, setWsStatus] = useState<
        "connecting" | "connected" | "disconnected"
    >("connecting");
    const [viewMode, setViewMode] = useState<ViewMode>("waveform");
    const [chatInput, setChatInput] = useState("");
    const [chatOpen, setChatOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);

    const userspaceWsRef = useRef<WebSocket | null>(null);
    const assistantDeltaBufferRef = useRef("");
    const chatInputRef = useRef<HTMLInputElement>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const workletRef = useRef<AudioWorkletNode | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const analyserTimerRef = useRef<number>(0);

    // ── TTS events ───────────────────────────────────────
    useEffect(() => {
        const onTtsStart = () => {
            setIsSpeaking(true);
            sharedAudioRef.active = true;
            sharedAudioRef.state = "speaking";
        };
        const onTtsEnd = () => {
            setIsSpeaking(false);
            sharedAudioRef.active = false;
            sharedAudioRef.state = "idle";
        };
        window.addEventListener("jarvis-tts-start", onTtsStart);
        window.addEventListener("jarvis-tts-end", onTtsEnd);
        return () => {
            window.removeEventListener("jarvis-tts-start", onTtsStart);
            window.removeEventListener("jarvis-tts-end", onTtsEnd);
        };
    }, []);

    // ── Electron window state IPC ────────────────────────
    useEffect(() => {
        const bridge = (window as any).jarvisBridge;
        if (!bridge?.onMinimizeToSphere) return;
        const c1 = bridge.onMinimizeToSphere(() => setViewMode("minimizing"));
        const c2 = bridge.onRestoreFromSphere(() => setViewMode("restoring"));
        const c3 = bridge.onSphereReady?.(() => setViewMode("sphere"));
        return () => {
            c1?.();
            c2?.();
            c3?.();
        };
    }, []);

    // ── WebSocket connection (auto-reconnect) ─────────────
    useEffect(() => {
        let destroyed = false;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        let wsUrl = "";

        const connect = async () => {
            if (destroyed) return;
            setWsStatus("connecting");
            try {
                const bridge = (window as any).jarvisBridge;
                const config = bridge?.getUserspaceConfig
                    ? await bridge.getUserspaceConfig()
                    : null;
                if (typeof config?.wsUrl === "string" && config.wsUrl.trim()) {
                    wsUrl = config.wsUrl.trim();
                } else if (config?.host && config?.port) {
                    wsUrl = `ws://${config.host}:${config.port}/ws`;
                }
            } catch (_) {}

            if (!wsUrl) {
                setWsStatus("disconnected");
                if (!destroyed) {
                    retryTimer = setTimeout(connect, 2000);
                }
                return;
            }

            // Append JWT token as query parameter
            const sep = wsUrl.includes("?") ? "&" : "?";
            const authUrl = `${wsUrl}${sep}token=${encodeURIComponent(token)}`;

            const ws = new WebSocket(authUrl);
            userspaceWsRef.current = ws;

            ws.onopen = () => {
                console.log("[WS] connected");
                setWsStatus("connected");
            };

            ws.onclose = () => {
                setWsStatus("disconnected");
                userspaceWsRef.current = null;
                // Auto-reconnect after 2s if not intentionally destroyed
                if (!destroyed) {
                    console.log("[WS] disconnected, retrying in 2s...");
                    retryTimer = setTimeout(connect, 2000);
                }
            };

            ws.onerror = () => {
                // onclose will fire after this, triggering reconnect
            };

            ws.onmessage = (event) => {
                try {
                    const { type, payload = {} } = JSON.parse(event.data);
                    // console.log("[WS] " + type + " " + JSON.stringify(payload));
                    if (type === "stt.partial") {
                        const text = String(payload.text || "");
                        if (text) setUserSubtitle(text);
                    } else if (type === "stt.final") {
                        const text = String(payload.text || "");
                        if (text) setUserSubtitle(text);
                        // User turn done → clear for assistant response
                        setIsSpeaking(true);
                        assistantDeltaBufferRef.current = "";
                        setAssistantSubtitle("");
                    } else if (type === "stt.state") {
                        setSttState(
                            String(payload.status || payload.state || "idle"),
                        );
                    } else if (
                        type === "chat.delta" ||
                        type === "conversation.delta"
                    ) {
                        assistantDeltaBufferRef.current += String(
                            payload.text || "",
                        );
                        setAssistantSubtitle(assistantDeltaBufferRef.current);
                        sharedAudioRef.speakingPulse = 1;
                    } else if (
                        type === "chat.done" ||
                        type === "conversation.done"
                    ) {
                        const t = String(payload.text || "").trim();
                        if (t) setAssistantSubtitle(t);
                        assistantDeltaBufferRef.current = "";
                    } else if (type === "conversation.thinking") {
                        setAssistantSubtitle(
                            String(payload.text || "DeepThinking..."),
                        );
                    } else if (type === "conversation.plan_step") {
                        const title = String(payload.title || "").trim();
                        if (title) setAssistantSubtitle(title);
                    } else if (type === "conversation.state") {
                        const state = String(payload.state || "idle");
                        if (state === "speaking") {
                            setIsSpeaking(true);
                            sharedAudioRef.state = "speaking";
                        } else if (state === "idle") {
                            setIsSpeaking(false);
                            sharedAudioRef.state = "idle";
                        } else if (state === "listening") {
                            setIsSpeaking(false);
                            sharedAudioRef.state = "listening";
                        }
                    }
                } catch (_) {}
            };
        };

        connect();
        return () => {
            destroyed = true;
            if (retryTimer) clearTimeout(retryTimer);
            userspaceWsRef.current?.close();
            userspaceWsRef.current = null;
        };
    }, [token]);

    const sendEvent = (type: string, payload: Record<string, unknown>) => {
        const ws = userspaceWsRef.current;
        if (ws?.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type, payload }));
    };

    // ── Audio control ────────────────────────────────────
    const stopAudio = useCallback(() => {
        cancelAnimationFrame(analyserTimerRef.current);
        try {
            workletRef.current?.disconnect();
            sourceRef.current?.disconnect();
            analyserRef.current?.disconnect();
            audioContextRef.current?.close();
            mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
        } catch (_) {}
        workletRef.current = null;
        sourceRef.current = null;
        analyserRef.current = null;
        audioContextRef.current = null;
        mediaStreamRef.current = null;
        sharedAudioRef.current = null;
        sharedAudioRef.active = false;
        sharedAudioRef.state = "idle";
    }, []);

    const stopMic = useCallback(() => {
        sendEvent("stt.stop", {});
        stopAudio();
        setMicActive(false);
        setSttState("idle");
        sharedAudioRef.state = "idle";
    }, [stopAudio]);

    const startMic = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: SAMPLE_RATE,
                    echoCancellation: true,
                    noiseSuppression: true,
                },
            });
            mediaStreamRef.current = stream;

            const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
            audioContextRef.current = ctx;
            const source = ctx.createMediaStreamSource(stream);
            sourceRef.current = source;

            // AnalyserNode for frequency data (visualization)
            const analyser = ctx.createAnalyser();
            analyser.fftSize = FFT_SIZE;
            analyser.smoothingTimeConstant = 0.75;
            analyserRef.current = analyser;
            source.connect(analyser);

            // AudioWorkletNode for PCM capture (replaces deprecated ScriptProcessorNode)
            const workletCode = `
        class PCMCapture extends AudioWorkletProcessor {
          constructor() {
            super();
            this._buf = [];
            this._count = 0;
          }
          process(inputs) {
            const ch = inputs[0]?.[0];
            if (!ch) return true;
            // Accumulate 128-sample frames into ~4096-sample chunks
            for (let i = 0; i < ch.length; i++) this._buf.push(ch[i]);
            this._count += ch.length;
            if (this._count >= 4096) {
              this.port.postMessage(new Float32Array(this._buf));
              this._buf = [];
              this._count = 0;
            }
            return true;
          }
        }
        registerProcessor('pcm-capture', PCMCapture);
      `;
            const blob = new Blob([workletCode], {
                type: "application/javascript",
            });
            const workletUrl = URL.createObjectURL(blob);
            await ctx.audioWorklet.addModule(workletUrl);
            URL.revokeObjectURL(workletUrl);

            const worklet = new AudioWorkletNode(ctx, "pcm-capture");
            workletRef.current = worklet;

            const sampleRate = ctx.sampleRate;
            worklet.port.onmessage = (e: MessageEvent<Float32Array>) => {
                const f32 = e.data;
                const ws = userspaceWsRef.current;
                if (ws?.readyState === WebSocket.OPEN) {
                    ws.send(
                        JSON.stringify({
                            type: "stt.audio.chunk",
                            payload: {
                                samples: float32ToInt16Array(f32),
                                sample_rate: sampleRate,
                            },
                        }),
                    );
                }
            };

            source.connect(worklet);

            sendEvent("stt.start", { sample_rate: sampleRate });
            setMicActive(true);
            sharedAudioRef.active = true;
            sharedAudioRef.state = "listening";
            setSttState("listening");

            // Poll analyser → write to shared ref (NO setState, NO re-render)
            const freqBuf = new Uint8Array(analyser.frequencyBinCount);
            const poll = () => {
                analyser.getByteFrequencyData(freqBuf);
                sharedAudioRef.current = freqBuf;
                analyserTimerRef.current = requestAnimationFrame(poll);
            };
            poll();
        } catch (err) {
            console.error("[STT] startMic failed:", err);
            stopAudio();
            setMicActive(false);
        }
    }, [stopAudio]);

    const toggleMic = useCallback(async () => {
        micActive ? stopMic() : await startMic();
    }, [micActive, stopMic, startMic]);

    const handleChatSubmit = useCallback(() => {
        const text = chatInput.trim();
        if (!text) return;
        setUserSubtitle(text);
        setIsSpeaking(true);
        assistantDeltaBufferRef.current = "";
        setAssistantSubtitle("");
        sendEvent("chat.request", { text });
        setChatInput("");
    }, [chatInput]);

    // ── Keyboard shortcuts ──────────────────────────────
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "p" && e.ctrlKey) {
                e.preventDefault();
                toggleMic();
            }
            // Enter to open chat, Escape to close
            if (e.key === "Enter" && !chatOpen && !e.ctrlKey && !e.metaKey) {
                const tag = (e.target as HTMLElement)?.tagName;
                if (tag === "INPUT" || tag === "TEXTAREA") return;
                e.preventDefault();
                setChatOpen(true);
                setTimeout(() => chatInputRef.current?.focus(), 50);
            }
            if (e.key === "Escape" && chatOpen) {
                setChatOpen(false);
                setChatInput("");
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [toggleMic, chatOpen]);

    useEffect(() => {
        return () => {
            stopAudio();
            userspaceWsRef.current?.close();
        };
    }, [stopAudio]);

    // ── Window controls ──────────────────────────────────
    // Fade out done → tell main to resize (don't change viewMode yet)
    const handleMinimizeDone = useCallback(() => {
        (window as any).jarvisBridge?.minimizeAnimationDone?.();
    }, []);
    const handleRestoreDone = useCallback(() => setViewMode("waveform"), []);
    const handleMinimize = () =>
        (window as any).jarvisBridge?.minimizeWindow?.();
    const handleClose = () => (window as any).jarvisBridge?.closeWindow?.();
    const handleSphereClick = () =>
        (window as any).jarvisBridge?.restoreWindow?.();

    const activeSubtitle = isSpeaking ? assistantSubtitle : userSubtitle;
    const isNormal = viewMode === "waveform" || viewMode === "restoring";
    const isSphere = viewMode === "sphere";
    const isMinimizing = viewMode === "minimizing";
    const bgColor = isSphere || isMinimizing ? "transparent" : "#000";

    return (
        <div
            style={{
                position: "relative",
                width: "100%",
                height: "100vh",
                background: bgColor,
                overflow: isSphere ? "visible" : "hidden",
            }}
        >
            <SandParticles
                viewMode={viewMode}
                onMinimizeDone={handleMinimizeDone}
                onRestoreDone={handleRestoreDone}
                onSphereClick={handleSphereClick}
            />

            {isNormal && (
                <div
                    style={
                        {
                            position: "absolute",
                            top: 0,
                            left: 0,
                            right: 0,
                            height: 40,
                            zIndex: 50,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-end",
                            WebkitAppRegion: "drag",
                        } as React.CSSProperties
                    }
                >
                    <div
                        style={
                            {
                                display: "flex",
                                gap: 4,
                                marginRight: 12,
                                WebkitAppRegion: "no-drag",
                            } as React.CSSProperties
                        }
                    >
                        <button
                            onClick={handleMinimize}
                            style={{
                                width: 28,
                                height: 28,
                                background: "none",
                                border: "none",
                                color: "#888",
                                cursor: "pointer",
                                fontSize: 14,
                            }}
                            title="Minimize"
                        >
                            &#9679;
                        </button>
                        <button
                            onClick={handleClose}
                            style={{
                                width: 28,
                                height: 28,
                                background: "none",
                                border: "none",
                                color: "#888",
                                cursor: "pointer",
                                fontSize: 14,
                            }}
                            title="Close"
                        >
                            &#10005;
                        </button>
                    </div>
                </div>
            )}

            {isSphere && (
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
                    {/* Speech bubble — left side */}
                    {activeSubtitle ? (
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
                            {activeSubtitle}
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
                    {/* Sphere click area */}
                    <div
                        onClick={handleSphereClick}
                        style={{
                            width: 120,
                            minWidth: 120,
                            height: "100%",
                            cursor: "pointer",
                            pointerEvents: "auto",
                        }}
                    />
                </div>
            )}

            {/* ── Assistant response (top) ── */}
            {isNormal && assistantSubtitle && (
                <div
                    style={{
                        position: "absolute",
                        top: "5em",
                        left: 0,
                        right: 0,
                        zIndex: 50,
                        display: "flex",
                        justifyContent: "center",
                        padding: "0 48px",
                    }}
                >
                    <p
                        style={{
                            textAlign: "center",
                            fontSize: 20,
                            color: "rgba(210,180,140,0.9)",
                            textShadow: "0 0 20px rgba(194,149,107,0.4)",
                            maxWidth: 900,
                            margin: 0,
                            lineHeight: 1.6,
                        }}
                    >
                        {assistantSubtitle}
                    </p>
                </div>
            )}

            {/* ── User subtitle + chat input (bottom) ── */}
            {isNormal && (
                <div
                    style={{
                        position: "absolute",
                        bottom: 32,
                        left: 0,
                        right: 0,
                        zIndex: 50,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        padding: "0 32px",
                        gap: 16,
                    }}
                >
                    {userSubtitle && (micActive || sttState === "listening") ? (
                        <p
                            style={{
                                textAlign: "center",
                                fontSize: 18,
                                color: "rgba(150,200,230,0.85)",
                                textShadow: "0 0 16px rgba(100,180,220,0.4)",
                                maxWidth: 1100,
                                margin: 0,
                            }}
                        >
                            {userSubtitle}
                        </p>
                    ) : (
                        <p
                            style={{
                                textAlign: "center",
                                fontSize: 13,
                                color: "rgba(120,80,40,0.5)",
                                letterSpacing: "0.2em",
                                fontFamily: "monospace",
                                margin: 0,
                            }}
                        >
                            {micActive
                                ? "LISTENING..."
                                : "PRESS ENTER TO CHAT · CTRL+P TO SPEAK"}
                        </p>
                    )}

                    {chatOpen && (
                        <div
                            style={{
                                width: "100%",
                                maxWidth: 600,
                                display: "flex",
                                gap: 8,
                            }}
                        >
                            <input
                                ref={chatInputRef}
                                type="text"
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        handleChatSubmit();
                                    }
                                }}
                                placeholder="메시지를 입력하세요..."
                                style={{
                                    flex: 1,
                                    padding: "10px 16px",
                                    background: "rgba(30,30,30,0.8)",
                                    border: "1px solid rgba(120,80,30,0.3)",
                                    borderRadius: 8,
                                    color: "rgba(210,180,140,0.9)",
                                    fontSize: 14,
                                    outline: "none",
                                    backdropFilter: "blur(8px)",
                                }}
                            />
                            <button
                                onClick={handleChatSubmit}
                                style={{
                                    padding: "10px 20px",
                                    background: "rgba(120,80,30,0.4)",
                                    border: "1px solid rgba(120,80,30,0.3)",
                                    borderRadius: 8,
                                    color: "rgba(210,180,140,0.9)",
                                    fontSize: 14,
                                    cursor: "pointer",
                                }}
                            >
                                ↵
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* ── Logout button (bottom-left, normal mode only) ── */}
            {isNormal && (
                <button
                    onClick={onLogout}
                    style={{
                        position: "absolute",
                        bottom: 14,
                        left: 18,
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
                    }}
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
            )}

            {isNormal && (
                <button
                    onClick={() => setSettingsOpen(true)}
                    style={{
                        position: "absolute",
                        bottom: 14,
                        left: 90,
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
                    }}
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
            )}

            <SettingsModal
                open={settingsOpen}
                token={token}
                onClose={() => setSettingsOpen(false)}
            />
        </div>
    );
}
