import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

const USERSPACE_WS_FALLBACK = "ws://127.0.0.1:8765/ws";
const SAMPLE_RATE = 16000;
const CHUNK_SIZE = 4096;

function float32ToInt16Array(f32: Float32Array): number[] {
    const out: number[] = new Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
        const s = Math.max(-1, Math.min(1, f32[i]));
        out[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
    }
    return out;
}

function computeRms(f32: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < f32.length; i++) {
        sum += f32[i] * f32[i];
    }
    return Math.sqrt(sum / f32.length);
}

export default function App() {
    const [micActive, setMicActive] = useState(false);
    const [micLevel, setMicLevel] = useState(0);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [userSubtitle, setUserSubtitle] = useState("");
    const [assistantSubtitle, setAssistantSubtitle] = useState("");
    const [sttState, setSttState] = useState<string>("idle");
    const [wsStatus, setWsStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");

    const ttsTimeoutRef = useRef<number | null>(null);
    const corePulseRef = useRef<HTMLDivElement | null>(null);
    const userspaceWsRef = useRef<WebSocket | null>(null);
    const assistantDeltaBufferRef = useRef("");

    const mediaStreamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const actualSampleRateRef = useRef<number>(SAMPLE_RATE);

    useEffect(() => {
        const onTtsStart = () => setIsSpeaking(true);
        const onTtsEnd = () => setIsSpeaking(false);

        window.addEventListener("jarvis-tts-start", onTtsStart);
        window.addEventListener("jarvis-tts-end", onTtsEnd);

        return () => {
            window.removeEventListener("jarvis-tts-start", onTtsStart);
            window.removeEventListener("jarvis-tts-end", onTtsEnd);
        };
    }, []);

    useEffect(() => {
        const connectUserspace = async () => {
            setWsStatus("connecting");
            try {
                const bridge = (window as any).jarvisBridge;
                const config = bridge?.getUserspaceConfig
                    ? await bridge.getUserspaceConfig()
                    : null;
                const wsUrl =
                    config?.host && config?.port
                        ? `ws://${config.host}:${config.port}/ws`
                        : USERSPACE_WS_FALLBACK;

                const ws = new WebSocket(wsUrl);
                userspaceWsRef.current = ws;

                ws.onopen = () => {
                    setWsStatus("connected");
                };

                ws.onclose = () => {
                    setWsStatus("disconnected");
                    userspaceWsRef.current = null;
                };

                ws.onmessage = (event) => {
                    try {
                        const packet = JSON.parse(event.data);
                        const type = packet?.type;
                        const payload = packet?.payload || {};

                        if (type === "stt.partial") {
                            const text = String(payload.text || "");
                            if (text) setUserSubtitle(text);
                            return;
                        }

                        if (type === "stt.final") {
                            const text = String(payload.text || "");
                            if (text) setUserSubtitle(text);
                            return;
                        }

                        if (type === "stt.state") {
                            setSttState(String(payload.state || "idle"));
                            return;
                        }

                        if (type === "chat.delta") {
                            assistantDeltaBufferRef.current += String(
                                payload.text || "",
                            );
                            setAssistantSubtitle(assistantDeltaBufferRef.current);
                            return;
                        }

                        if (type === "chat.done") {
                            const doneText = String(payload.text || "").trim();
                            if (doneText) {
                                setAssistantSubtitle(doneText);
                            }
                            assistantDeltaBufferRef.current = "";
                            return;
                        }
                    } catch (_error) {
                        void 0;
                    }
                };
            } catch (_error) {
                setWsStatus("disconnected");
                userspaceWsRef.current = null;
            }
        };

        connectUserspace();

        return () => {
            if (userspaceWsRef.current) {
                userspaceWsRef.current.close();
                userspaceWsRef.current = null;
            }
        };
    }, []);

    const sendUserspaceEvent = (type: string, payload: Record<string, unknown>) => {
        const ws = userspaceWsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type, payload }));
    };

    useEffect(() => {
        return () => {
            if (ttsTimeoutRef.current) window.clearTimeout(ttsTimeoutRef.current);
            stopAudio();
            if (userspaceWsRef.current) {
                userspaceWsRef.current.close();
                userspaceWsRef.current = null;
            }
        };
    }, []);

    const stopAudio = () => {
        try {
            processorRef.current?.disconnect();
            sourceRef.current?.disconnect();
            audioContextRef.current?.close();
            mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
        } catch (_) {
            void 0;
        }
        processorRef.current = null;
        sourceRef.current = null;
        audioContextRef.current = null;
        mediaStreamRef.current = null;
    };

    const stopMic = () => {
        sendUserspaceEvent("stt.stop", {});
        stopAudio();
        setMicActive(false);
        setMicLevel(0);
        setSttState("idle");
        if (corePulseRef.current) {
            corePulseRef.current.style.transform = "scale(1)";
        }
    };

    const startMic = async () => {
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
            actualSampleRateRef.current = ctx.sampleRate;

            const source = ctx.createMediaStreamSource(stream);
            sourceRef.current = source;

            const processor = ctx.createScriptProcessor(CHUNK_SIZE, 1, 1);
            processorRef.current = processor;

            sendUserspaceEvent("stt.start", { sample_rate: ctx.sampleRate });
            setMicActive(true);
            setSttState("listening");

            processor.onaudioprocess = (e) => {
                const f32 = e.inputBuffer.getChannelData(0);

                const rms = computeRms(f32);
                const level = Math.max(0, Math.min(100, Math.round(rms * 400)));
                setMicLevel(level);
                if (corePulseRef.current) {
                    const scale = 1 + (level / 100) * 0.32;
                    corePulseRef.current.style.transform = `scale(${scale.toFixed(3)})`;
                }

                const ws = userspaceWsRef.current;
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(
                        JSON.stringify({
                            type: "stt.audio.chunk",
                            payload: {
                                samples: float32ToInt16Array(f32),
                                sample_rate: ctx.sampleRate,
                            },
                        }),
                    );
                }
            };

            source.connect(processor);
            processor.connect(ctx.destination);
        } catch (err) {
            console.error("[STT] getUserMedia failed:", err);
            stopAudio();
            setMicActive(false);
        }
    };

    const toggleMic = async () => {
        if (micActive) {
            stopMic();
        } else {
            await startMic();
        }
    };

    const activeSubtitle = isSpeaking ? assistantSubtitle : userSubtitle;
    const responseToneFilter = isSpeaking
        ? "grayscale(0.55) brightness(1.34) contrast(1.08)"
        : "none";

    const particles = useMemo(
        () =>
            Array.from({ length: 14 }).map((_, i) => {
                const r = i % 3;
                const color =
                    r === 0 ? "#00d8ff" : r === 1 ? "#009dff" : "#0055ff";
                const x = Math.random() * 800 - 400;
                const y = Math.random() * 800 - 400;
                return {
                    key: i,
                    color,
                    x,
                    y,
                    duration: 3 + Math.random() * 2,
                    delay: Math.random() * 2,
                };
            }),
        [],
    );

    const wsStatusColor =
        wsStatus === "connected"
            ? "text-cyan-300"
            : wsStatus === "connecting"
              ? "text-yellow-300"
              : "text-rose-300";

    return (
        <div className="relative w-full h-screen bg-transparent overflow-hidden flex items-center justify-center">
            <div className="absolute inset-0 bg-black/90" />

            <div
                className="absolute top-6 left-6 z-40 border border-cyan-400/35 bg-black/55 px-4 py-3 text-cyan-100 backdrop-blur-sm transition-[filter] duration-500 ease-in-out"
                style={{ filter: responseToneFilter }}
            >
                <p className="text-xs tracking-[0.22em] text-cyan-300">
                    JARVIS STT
                </p>
                <p className={`mt-1 text-[11px] ${wsStatusColor}`}>
                    WS: {wsStatus.toUpperCase()}
                </p>
                <p className="mt-2 text-sm">
                    MIC:{" "}
                    <span className="font-bold text-cyan-200">{micLevel}%</span>
                </p>
                <p className="text-sm">
                    STT STATE:{" "}
                    <span className="font-bold text-cyan-200">
                        {sttState.toUpperCase()}
                    </span>
                </p>
                <div className="mt-3">
                    <button
                        type="button"
                        onClick={toggleMic}
                        className={`border px-4 py-2 text-xs tracking-[0.14em] transition-colors ${
                            micActive
                                ? "border-rose-400/70 text-rose-300 bg-rose-900/20"
                                : "border-cyan-300/50 text-cyan-100"
                        }`}
                    >
                        {micActive ? "● STOP STT" : "○ START STT"}
                    </button>
                </div>
            </div>

            <div
                className="relative w-[800px] h-[800px] flex items-center justify-center will-change-transform transition-[filter] duration-500 ease-in-out"
                style={{ filter: responseToneFilter }}
            >
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{
                        duration: 40,
                        repeat: Infinity,
                        ease: "linear",
                    }}
                    className="absolute w-[700px] h-[700px]"
                >
                    <svg
                        width="700"
                        height="700"
                        viewBox="0 0 700 700"
                        className="absolute inset-0"
                    >
                        <defs>
                            <linearGradient
                                id="hexGradient"
                                x1="0%"
                                y1="0%"
                                x2="100%"
                                y2="100%"
                            >
                                <stop
                                    offset="0%"
                                    stopColor="#0055ff"
                                    stopOpacity="0.9"
                                />
                                <stop
                                    offset="50%"
                                    stopColor="#0044dd"
                                    stopOpacity="0.7"
                                />
                                <stop
                                    offset="100%"
                                    stopColor="#0055ff"
                                    stopOpacity="0.9"
                                />
                            </linearGradient>
                        </defs>
                        {Array.from({ length: 6 }).map((_, i) => {
                            const angle = (i * 60 * Math.PI) / 180;
                            const nextAngle = ((i + 1) * 60 * Math.PI) / 180;
                            const radius = 320;
                            const x1 = 350 + radius * Math.cos(angle);
                            const y1 = 350 + radius * Math.sin(angle);
                            const x2 = 350 + radius * Math.cos(nextAngle);
                            const y2 = 350 + radius * Math.sin(nextAngle);
                            return (
                                <line
                                    key={i}
                                    x1={x1}
                                    y1={y1}
                                    x2={x2}
                                    y2={y2}
                                    stroke="url(#hexGradient)"
                                    strokeWidth="3"
                                    style={{
                                        filter: "drop-shadow(0 0 10px #0055ff)",
                                    }}
                                />
                            );
                        })}
                    </svg>
                </motion.div>

                {[600, 550, 500].map((size, idx) => (
                    <motion.div
                        key={size}
                        animate={{
                            rotate: idx % 2 === 0 ? 360 : -360,
                            opacity: [0.3, 0.5, 0.3],
                        }}
                        transition={{
                            rotate: {
                                duration: 15 + idx * 5,
                                repeat: Infinity,
                                ease: "linear",
                            },
                            opacity: {
                                duration: 3,
                                repeat: Infinity,
                                delay: idx * 0.3,
                                ease: "easeInOut",
                            },
                        }}
                        className="absolute"
                        style={{ width: size, height: size }}
                    >
                        <svg
                            width={size}
                            height={size}
                            viewBox={`0 0 ${size} ${size}`}
                        >
                            <defs>
                                <linearGradient
                                    id={`arcGrad${idx}`}
                                    x1="0%"
                                    y1="0%"
                                    x2="100%"
                                    y2="100%"
                                >
                                    <stop
                                        offset="0%"
                                        stopColor={
                                            idx === 1 ? "#00e1ff" : "#0055ff"
                                        }
                                        stopOpacity="0"
                                    />
                                    <stop
                                        offset="50%"
                                        stopColor={
                                            idx === 1
                                                ? "#00c8ff"
                                                : idx === 2
                                                  ? "#aaaaaa"
                                                  : "#0066ff"
                                        }
                                        stopOpacity="1"
                                    />
                                    <stop
                                        offset="100%"
                                        stopColor={
                                            idx === 1 ? "#00e1ff" : "#0055ff"
                                        }
                                        stopOpacity="0"
                                    />
                                </linearGradient>
                            </defs>
                            <circle
                                cx={size / 2}
                                cy={size / 2}
                                r={(size - 4) / 2}
                                fill="none"
                                stroke={`url(#arcGrad${idx})`}
                                strokeWidth="2"
                                strokeDasharray={`${80 + idx * 20} ${200 - idx * 30}`}
                                style={{
                                    filter: `drop-shadow(0 0 8px ${idx === 1 ? "#00d8ff" : idx === 2 ? "#4cb8ff" : "#0055ff"})`,
                                }}
                            />
                        </svg>
                    </motion.div>
                ))}

                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{
                        duration: 10,
                        repeat: Infinity,
                        ease: "linear",
                    }}
                    className="absolute w-[480px] h-[480px]"
                >
                    <svg width="480" height="480" viewBox="0 0 480 480">
                        {Array.from({ length: 120 }).map((_, i) => {
                            const angle = (i * 3 * Math.PI) / 180;
                            const isMainTick = i % 10 === 0;
                            const isMidTick = i % 5 === 0;
                            const innerRadius = isMainTick
                                ? 210
                                : isMidTick
                                  ? 220
                                  : 230;
                            const outerRadius = 240;
                            const x1 =
                                240 +
                                innerRadius * Math.cos(angle - Math.PI / 2);
                            const y1 =
                                240 +
                                innerRadius * Math.sin(angle - Math.PI / 2);
                            const x2 =
                                240 +
                                outerRadius * Math.cos(angle - Math.PI / 2);
                            const y2 =
                                240 +
                                outerRadius * Math.sin(angle - Math.PI / 2);

                            return (
                                <line
                                    key={i}
                                    x1={x1}
                                    y1={y1}
                                    x2={x2}
                                    y2={y2}
                                    stroke="#00f6ff"
                                    strokeWidth={
                                        isMainTick ? 3 : isMidTick ? 2 : 1
                                    }
                                    opacity={
                                        isMainTick ? 1 : isMidTick ? 0.7 : 0.3
                                    }
                                    style={
                                        isMainTick
                                            ? {
                                                  filter: "drop-shadow(0 0 3px #00f6ff)",
                                              }
                                            : {}
                                    }
                                />
                            );
                        })}
                    </svg>
                </motion.div>

                <motion.div
                    animate={{ rotate: -360 }}
                    transition={{
                        duration: 6,
                        repeat: Infinity,
                        ease: "linear",
                    }}
                    className="absolute w-[420px] h-[420px]"
                >
                    <svg width="420" height="420" viewBox="0 0 420 420">
                        <defs>
                            <linearGradient
                                id="ringGlow"
                                x1="0%"
                                y1="0%"
                                x2="100%"
                                y2="100%"
                            >
                                <stop
                                    offset="0%"
                                    stopColor="#7be4ff"
                                    stopOpacity="0.8"
                                />
                                <stop
                                    offset="50%"
                                    stopColor="#2ca6ff"
                                    stopOpacity="0.6"
                                />
                                <stop
                                    offset="100%"
                                    stopColor="#7be4ff"
                                    stopOpacity="0.8"
                                />
                            </linearGradient>
                        </defs>
                        {Array.from({ length: 8 }).map((_, i) => {
                            const angle = (i * 45 * Math.PI) / 180;
                            const radius = 180;
                            const x1 = 210 + (radius - 15) * Math.cos(angle);
                            const y1 = 210 + (radius - 15) * Math.sin(angle);
                            const x2 = 210 + (radius + 15) * Math.cos(angle);
                            const y2 = 210 + (radius + 15) * Math.sin(angle);
                            return (
                                <line
                                    key={i}
                                    x1={x1}
                                    y1={y1}
                                    x2={x2}
                                    y2={y2}
                                    stroke="url(#ringGlow)"
                                    strokeWidth="2"
                                    opacity="0.6"
                                />
                            );
                        })}
                    </svg>
                </motion.div>

                <motion.div animate={{ scale: 1 }} className="relative z-10">
                    <div
                        className="absolute inset-0 rounded-full"
                        style={{
                            width: 280,
                            height: 280,
                            left: "50%",
                            top: "50%",
                            transform: "translate(-50%, -50%)",
                            background:
                                "radial-gradient(circle, rgba(255, 255, 255, 0.3) 0%, rgba(0, 85, 255, 0.2) 50%, transparent 70%)",
                            filter: "blur(20px)",
                        }}
                    />

                    <div
                        ref={corePulseRef}
                        className="relative w-64 h-64 rounded-full flex items-center justify-center cursor-pointer"
                        style={{
                            background:
                                "radial-gradient(circle at 30% 30%, rgba(0, 100, 200, 0.5), rgba(0, 30, 80, 0.9), black)",
                            border: micActive ? "3px solid #00f6ff" : "3px solid #0055ff",
                            transition: "transform 90ms linear, border-color 300ms ease",
                            boxShadow: micActive
                                ? `0 0 60px rgba(0, 246, 255, 0.9), inset 0 0 60px rgba(0, 246, 255, 0.2), inset 0 0 20px rgba(0, 0, 0, 0.8)`
                                : `0 0 40px rgba(0, 85, 255, 0.8), inset 0 0 60px rgba(0, 85, 255, 0.3), inset 0 0 20px rgba(0, 0, 0, 0.8)`,
                        }}
                        onClick={toggleMic}
                    >
                        {[180, 150, 120].map((size, idx) => (
                            <motion.div
                                key={size}
                                animate={{
                                    rotate: idx % 2 === 0 ? 360 : -360,
                                    opacity: micActive ? [0.5, 0.9, 0.5] : [0.3, 0.6, 0.3],
                                }}
                                transition={{
                                    rotate: {
                                        duration: 10 + idx * 5,
                                        repeat: Infinity,
                                        ease: "linear",
                                    },
                                    opacity: {
                                        duration: micActive ? 1 : 2,
                                        repeat: Infinity,
                                        delay: idx * 0.3,
                                    },
                                }}
                                className="absolute rounded-full border-2"
                                style={{
                                    width: size,
                                    height: size,
                                    borderStyle: "dashed",
                                    borderWidth: 1,
                                    borderColor:
                                        idx === 0
                                            ? "rgba(255, 255, 255, 0.4)"
                                            : idx === 1
                                              ? "rgba(170, 170, 170, 0.4)"
                                              : "rgba(0, 85, 255, 0.3)",
                                }}
                            />
                        ))}

                        <motion.div
                            animate={{ rotate: 360 }}
                            transition={{
                                duration: micActive ? 8 : 20,
                                repeat: Infinity,
                                ease: "linear",
                            }}
                            className="absolute inset-0"
                        >
                            <div className="absolute top-1/2 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent opacity-50" />
                            <div className="absolute top-0 bottom-0 left-1/2 w-[2px] bg-gradient-to-b from-transparent via-cyan-400 to-transparent opacity-50" />
                            <div
                                className="absolute inset-0"
                                style={{ transform: "rotate(45deg)" }}
                            >
                                <div className="absolute top-1/2 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-400/30 to-transparent" />
                                <div className="absolute top-0 bottom-0 left-1/2 w-[1px] bg-gradient-to-b from-transparent via-cyan-400/30 to-transparent" />
                            </div>
                        </motion.div>

                        <div className="relative z-10 flex items-center justify-center">
                            <motion.div
                                animate={{ opacity: micActive ? [1, 0.5, 1] : [0.75, 1, 0.75] }}
                                transition={{
                                    duration: micActive ? 0.8 : 2,
                                    repeat: Infinity,
                                    ease: "easeInOut",
                                }}
                                className="w-4 h-4 rounded-full"
                                style={{
                                    backgroundColor: micActive ? "#ff4444" : "#00f6ff",
                                    boxShadow: micActive
                                        ? "0 0 20px #ff4444, 0 0 40px #ff2222, inset 0 0 10px #fff"
                                        : "0 0 20px #00f6ff, 0 0 40px #00f6ff, inset 0 0 10px #fff",
                                }}
                            />
                        </div>
                    </div>
                </motion.div>

                {particles.map((particle) => (
                    <motion.div
                        key={particle.key}
                        initial={{
                            x: particle.x,
                            y: particle.y,
                            scale: 0,
                            opacity: 0,
                        }}
                        animate={{
                            x: [particle.x, particle.x * 0.88, particle.x],
                            y: [particle.y, particle.y * 0.88, particle.y],
                            scale: [0, 1, 0],
                            opacity: [0, 0.7, 0],
                        }}
                        transition={{
                            duration: particle.duration,
                            repeat: Infinity,
                            delay: particle.delay,
                            ease: "easeInOut",
                        }}
                        className="absolute w-1 h-1 rounded-full"
                        style={{
                            backgroundColor: particle.color,
                            boxShadow: `0 0 6px ${particle.color}`,
                        }}
                    />
                ))}

                {[
                    { top: 0, left: 0, rotate: 0 },
                    { top: 0, right: 0, rotate: 90 },
                    { bottom: 0, right: 0, rotate: 180 },
                    { bottom: 0, left: 0, rotate: 270 },
                ].map((pos, idx) => (
                    <motion.div
                        key={idx}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: idx * 0.1, duration: 0.5 }}
                        className="absolute w-32 h-32"
                        style={pos}
                    >
                        <svg width="128" height="128" viewBox="0 0 128 128">
                            <path
                                d="M 0 30 L 0 0 L 30 0 M 0 30 L 10 30 M 30 0 L 30 10"
                                stroke="#00f6ff"
                                strokeWidth="2"
                                fill="none"
                                style={{
                                    filter: "drop-shadow(0 0 5px #00f6ff)",
                                }}
                            />
                        </svg>
                    </motion.div>
                ))}
            </div>

            {activeSubtitle ? (
                <p
                    className="absolute bottom-8 left-1/2 z-50 w-[min(92vw,1100px)] -translate-x-1/2 text-center text-2xl font-medium text-cyan-100"
                    style={{ textShadow: "0 0 12px rgba(0, 246, 255, 0.65)" }}
                >
                    {activeSubtitle}
                </p>
            ) : (
                <p className="absolute bottom-8 left-1/2 z-50 -translate-x-1/2 text-center text-sm text-cyan-400/50 tracking-[0.2em]">
                    {micActive ? "LISTENING..." : "CLICK CORE TO START STT"}
                </p>
            )}
        </div>
    );
}
