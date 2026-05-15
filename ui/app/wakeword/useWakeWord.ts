import { useEffect, useRef, useState } from "react";
import type { WakewordConfig } from "../settings/types";
import {
    createWakewordFingerprint,
    matchWakeword,
    rms,
    WAKEWORD_SAMPLE_RATE,
} from "./wakeword";

interface Options {
    config: WakewordConfig;
    enabled: boolean;
    onDetected: () => void;
}

type WakewordStatus = "off" | "listening" | "error";

const START_MULTIPLIER = 3.2;
const END_MULTIPLIER = 1.8;
const MIN_START_RMS = 0.012;
const CALIBRATION_MS = 900;
const MIN_CANDIDATE_MS = 360;
const MAX_CANDIDATE_MS = 1900;
const END_SILENCE_MS = 450;
const DEBOUNCE_MS = 3000;

export function useWakeWord({ config, enabled, onDetected }: Options) {
    const [status, setStatus] = useState<WakewordStatus>("off");
    const onDetectedRef = useRef(onDetected);
    const lastDetectedRef = useRef(0);
    onDetectedRef.current = onDetected;

    useEffect(() => {
        if (!enabled) {
            setStatus("off");
            return;
        }

        let cancelled = false;
        let stream: MediaStream | null = null;
        let context: AudioContext | null = null;
        let source: MediaStreamAudioSourceNode | null = null;
        let processor: ScriptProcessorNode | null = null;
        const calibration: number[] = [];
        let noise = 0.004;
        let isCapturing = false;
        let silenceMs = 0;
        let candidateSamples = 0;
        const candidate: Float32Array[] = [];

        const stop = async () => {
            try {
                processor?.disconnect();
                source?.disconnect();
                stream?.getTracks().forEach((track) => track.stop());
                if (context && context.state !== "closed") await context.close();
            } catch (_) {}
        };

        const start = async () => {
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        channelCount: 1,
                        sampleRate: WAKEWORD_SAMPLE_RATE,
                        echoCancellation: true,
                        noiseSuppression: true,
                    },
                });
                if (cancelled) {
                    await stop();
                    return;
                }
                context = new AudioContext({ sampleRate: WAKEWORD_SAMPLE_RATE });
                source = context.createMediaStreamSource(stream);
                processor = context.createScriptProcessor(1024, 1, 1);
                processor.onaudioprocess = (event) => {
                    if (cancelled) return;
                    const input = new Float32Array(event.inputBuffer.getChannelData(0));
                    processChunk(input, context?.sampleRate || WAKEWORD_SAMPLE_RATE);
                };
                source.connect(processor);
                processor.connect(context.destination);
                setStatus("listening");
            } catch (err) {
                console.warn("[wakeword] listener failed", err);
                setStatus("error");
                await stop();
            }
        };

        const processChunk = (chunk: Float32Array, sampleRate: number) => {
            const chunkMs = (chunk.length / sampleRate) * 1000;
            const level = rms(chunk);
            if (calibration.length * chunkMs < CALIBRATION_MS) {
                calibration.push(level);
                const sorted = [...calibration].sort((a, b) => a - b);
                noise = Math.max(0.004, sorted[Math.floor(sorted.length * 0.35)] ?? noise);
                return;
            }
            const startThreshold = Math.max(MIN_START_RMS, noise * START_MULTIPLIER);
            const endThreshold = Math.max(0.008, noise * END_MULTIPLIER);
            if (!isCapturing && level >= startThreshold) {
                isCapturing = true;
                silenceMs = 0;
                candidateSamples = 0;
                candidate.length = 0;
            }
            if (!isCapturing) {
                noise = Math.max(0.004, noise * 0.96 + level * 0.04);
                return;
            }
            candidate.push(chunk);
            candidateSamples += chunk.length;
            silenceMs = level < endThreshold ? silenceMs + chunkMs : 0;
            const candidateMs = (candidateSamples / sampleRate) * 1000;
            if (
                candidateMs >= MAX_CANDIDATE_MS
                || (candidateMs >= MIN_CANDIDATE_MS && silenceMs >= END_SILENCE_MS)
            ) {
                evaluateCandidate(joinChunks(candidate));
                isCapturing = false;
                silenceMs = 0;
                candidateSamples = 0;
                candidate.length = 0;
            }
        };

        const evaluateCandidate = (audio: Float32Array) => {
            const now = Date.now();
            if (now - lastDetectedRef.current < DEBOUNCE_MS) return;
            const fingerprint = createWakewordFingerprint(audio);
            const result = matchWakeword(fingerprint, config);
            if (!result.matched) return;
            lastDetectedRef.current = now;
            onDetectedRef.current();
        };

        void start();
        return () => {
            cancelled = true;
            void stop();
        };
    }, [config, enabled]);

    return { status };
}

function joinChunks(chunks: Float32Array[]): Float32Array {
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Float32Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}
