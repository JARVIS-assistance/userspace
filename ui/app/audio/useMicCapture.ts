import { useCallback, useEffect, useRef, useState } from "react";
import { float32ToInt16Array, sharedAudioRef } from "./sharedAudioRef";

const SAMPLE_RATE = 16000;
const FFT_SIZE = 256;
const CHUNK_SAMPLES = 1024;

const WORKLET_CODE = `
const CHUNK_SAMPLES = ${CHUNK_SAMPLES};

class PCMCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = [];
    this._count = 0;
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) this._buf.push(ch[i]);
    this._count += ch.length;
    if (this._count >= CHUNK_SAMPLES) {
      this.port.postMessage(new Float32Array(this._buf));
      this._buf = [];
      this._count = 0;
    }
    return true;
  }
}
registerProcessor('pcm-capture', PCMCapture);
`;

interface Options {
    sendEvent: (type: string, payload: Record<string, unknown>) => void;
    wsRef: React.MutableRefObject<WebSocket | null>;
}

export function useMicCapture({ sendEvent, wsRef }: Options) {
    const [active, setActive] = useState(false);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const workletRef = useRef<AudioWorkletNode | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const analyserTimerRef = useRef<number>(0);

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

    const stop = useCallback(() => {
        sendEvent("stt.stop", {});
        stopAudio();
        setActive(false);
        sharedAudioRef.state = "idle";
    }, [sendEvent, stopAudio]);

    const start = useCallback(async () => {
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

            const analyser = ctx.createAnalyser();
            analyser.fftSize = FFT_SIZE;
            analyser.smoothingTimeConstant = 0.75;
            analyserRef.current = analyser;
            source.connect(analyser);

            const blob = new Blob([WORKLET_CODE], {
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
                const ws = wsRef.current;
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
            setActive(true);
            sharedAudioRef.active = true;
            sharedAudioRef.state = "listening";

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
            setActive(false);
        }
    }, [sendEvent, wsRef, stopAudio]);

    const toggle = useCallback(async () => {
        if (active) stop();
        else await start();
    }, [active, stop, start]);

    useEffect(() => {
        return () => stopAudio();
    }, [stopAudio]);

    return { active, start, stop, toggle };
}
