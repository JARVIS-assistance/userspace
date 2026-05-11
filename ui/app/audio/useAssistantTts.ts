import { useCallback, useEffect, useRef } from "react";
import type { TtsConfig } from "../settings/types";

export function useAssistantTts(config: TtsConfig) {
    const configRef = useRef(config);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const streamCleanupRef = useRef<(() => void) | null>(null);
    const streamRequestIdRef = useRef<string>("");
    const requestIdRef = useRef(0);
    const cacheRef = useRef<Map<string, string>>(new Map());
    configRef.current = config;

    const cancel = useCallback(() => {
        requestIdRef.current += 1;
        const bridge = (window as any).jarvisBridge;
        if (streamRequestIdRef.current && bridge?.cancelTtsStream) {
            bridge.cancelTtsStream(streamRequestIdRef.current);
        }
        streamRequestIdRef.current = "";
        streamCleanupRef.current?.();
        streamCleanupRef.current = null;
        if ("speechSynthesis" in window) window.speechSynthesis.cancel();
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = "";
            audioRef.current = null;
        }
        window.dispatchEvent(new Event("jarvis-tts-end"));
    }, []);

    const speak = useCallback((text: string) => {
        const current = configRef.current;
        const cleaned = text.replace(/\s+/g, " ").trim();
        if (!current.enabled || !cleaned) return;

        if (current.provider === "gpt-sovits") {
            const requestId = ++requestIdRef.current;
            const streamRequestId = `tts-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            streamRequestIdRef.current = streamRequestId;
            streamCleanupRef.current?.();
            void speakGptSovitsStream(
                current,
                cleaned,
                streamRequestId,
                requestIdRef,
                requestId,
                streamCleanupRef,
                audioRef,
            );
            return;
        }

        if (
            current.provider === "chatterbox" ||
            current.provider === "vibevoice" ||
            current.provider === "elevenlabs" ||
            current.provider === "openai"
        ) {
            const requestId = ++requestIdRef.current;
            void speakCommercial(current, cleaned, audioRef, cacheRef.current, requestIdRef, requestId);
            return;
        }

        if (!("speechSynthesis" in window)) return;

        requestIdRef.current += 1;
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(cleaned);
        const voices = window.speechSynthesis.getVoices();
        const voice = voices.find((item) => item.voiceURI === current.voiceURI);
        if (voice) utterance.voice = voice;
        utterance.lang = voice?.lang || "ko-KR";
        utterance.rate = clamp(current.rate, 0.5, 1.6);
        utterance.pitch = clamp(current.pitch, 0.5, 1.5);
        utterance.volume = clamp(current.volume, 0, 1);
        utterance.onstart = () =>
            window.dispatchEvent(new Event("jarvis-tts-start"));
        utterance.onend = () => window.dispatchEvent(new Event("jarvis-tts-end"));
        utterance.onerror = () => window.dispatchEvent(new Event("jarvis-tts-end"));
        window.speechSynthesis.speak(utterance);
    }, []);

    useEffect(() => cancel, [cancel]);

    return { speak, cancel };
}

async function speakCommercial(
    config: TtsConfig,
    text: string,
    audioRef: React.MutableRefObject<HTMLAudioElement | null>,
    cache: Map<string, string>,
    requestIdRef: React.MutableRefObject<number>,
    requestId: number,
) {
    const bridge = (window as any).jarvisBridge;
    if (!bridge?.synthesizeTts) return;

    window.dispatchEvent(new Event("jarvis-tts-start"));
    try {
        const cacheKey = ttsCacheKey(config, text);
        let source = cache.get(cacheKey);
        if (!source) {
            const result = await bridge.synthesizeTts({
                provider: config.provider,
                text,
                apiKey: config.apiKey,
                voiceId: config.voiceId,
                model: config.model,
                language: config.language,
                audioPromptPath: config.audioPromptPath,
                exaggeration: config.exaggeration,
                cfgWeight: config.cfgWeight,
            });
            if (requestId !== requestIdRef.current) return;
            if (!result?.ok || !result.audioBase64) {
                console.warn("[TTS] synthesis failed", result?.error || result);
                window.dispatchEvent(new Event("jarvis-tts-end"));
                return;
            }
            source = `data:${result.mimeType || "audio/mpeg"};base64,${result.audioBase64}`;
            cache.set(cacheKey, source);
            trimCache(cache, 8);
        } else if (requestId !== requestIdRef.current) {
            return;
        }

        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = "";
        }
        const audio = new Audio(source);
        audio.volume = clamp(config.volume, 0, 1);
        audio.onended = () => {
            if (requestId === requestIdRef.current) {
                window.dispatchEvent(new Event("jarvis-tts-end"));
            }
        };
        audio.onerror = () => {
            if (requestId === requestIdRef.current) {
                window.dispatchEvent(new Event("jarvis-tts-end"));
            }
        };
        audioRef.current = audio;
        await audio.play();
    } catch (error) {
        console.warn("[TTS] playback failed", error);
        window.dispatchEvent(new Event("jarvis-tts-end"));
    }
}

function ttsCacheKey(config: TtsConfig, text: string): string {
    return JSON.stringify({
        provider: config.provider,
        text,
        voiceId: config.voiceId,
        model: config.model,
        language: config.language,
        audioPromptPath: config.audioPromptPath,
        exaggeration: config.exaggeration,
        cfgWeight: config.cfgWeight,
    });
}

function trimCache(cache: Map<string, string>, maxEntries: number) {
    while (cache.size > maxEntries) {
        const oldest = cache.keys().next().value;
        if (!oldest) return;
        cache.delete(oldest);
    }
}

async function speakGptSovitsStream(
    config: TtsConfig,
    text: string,
    streamRequestId: string,
    requestIdRef: React.MutableRefObject<number>,
    requestId: number,
    cleanupRef: React.MutableRefObject<(() => void) | null>,
    audioRef: React.MutableRefObject<HTMLAudioElement | null>,
) {
    const bridge = (window as any).jarvisBridge;
    if (!bridge?.synthesizeTtsStream || !bridge?.onTtsStreamEvent) return;

    let playback: PcmStreamPlayback | null = null;
    let fallbackPlayed = false;
    const unsubscribe = bridge.onTtsStreamEvent((event: any) => {
        if (event?.requestId !== streamRequestId || requestId !== requestIdRef.current) {
            return;
        }

        if (event.type === "start") {
            playback = new PcmStreamPlayback({
                sampleRate: Number(event.sampleRate || 32000),
                channels: Number(event.channels || 1),
                volume: clamp(config.volume, 0, 1),
                onPlaybackStart: () => window.dispatchEvent(new Event("jarvis-tts-start")),
            });
            cleanupRef.current = () => {
                playback?.close();
                unsubscribe?.();
            };
            return;
        }

        if (event.type === "chunk") {
            playback?.append(base64ToUint8Array(String(event.audioBase64 || "")));
            return;
        }

        if (event.type === "fallback" && event.audioBase64) {
            fallbackPlayed = true;
            void playFallbackAudio(config, event, audioRef, requestIdRef, requestId);
            return;
        }

        if (event.type === "error") {
            console.warn("[TTS] GPT-SoVITS streaming failed", event.error || event);
            if (!fallbackPlayed) window.dispatchEvent(new Event("jarvis-tts-end"));
            cleanupRef.current?.();
            cleanupRef.current = null;
            return;
        }

        if (event.type === "end") {
            playback?.finish(() => {
                if (requestId === requestIdRef.current) {
                    window.dispatchEvent(new Event("jarvis-tts-end"));
                }
            });
            if (!playback && !fallbackPlayed) {
                window.dispatchEvent(new Event("jarvis-tts-end"));
            }
            unsubscribe?.();
            cleanupRef.current = playback ? () => playback?.close() : null;
        }
    });

    cleanupRef.current = () => {
        playback?.close();
        unsubscribe?.();
    };

    try {
        await bridge.synthesizeTtsStream({
            ...gptSovitsPayload(config, text),
            requestId: streamRequestId,
        });
    } catch (error) {
        console.warn("[TTS] GPT-SoVITS stream bridge failed", error);
        if (requestId === requestIdRef.current) {
            window.dispatchEvent(new Event("jarvis-tts-end"));
        }
        cleanupRef.current?.();
        cleanupRef.current = null;
    }
}

function gptSovitsPayload(config: TtsConfig, text: string): Record<string, unknown> {
    return {
        provider: config.provider,
        text,
        language: config.language,
        audioPromptPath: config.audioPromptPath,
        gptSovitsRepoPath: config.gptSovitsRepoPath,
        gptSovitsPythonPath: config.gptSovitsPythonPath,
        gptSovitsHost: config.gptSovitsHost,
        gptSovitsPort: config.gptSovitsPort,
        gptSovitsConfigPath: config.gptSovitsConfigPath,
        gptSovitsPromptText: config.gptSovitsPromptText,
        gptSovitsTextLanguage: config.gptSovitsTextLanguage,
        gptSovitsPromptLanguage: config.gptSovitsPromptLanguage,
        gptSovitsStreamingMode: config.gptSovitsStreamingMode,
        gptSovitsSpeedFactor: config.gptSovitsSpeedFactor,
        gptSovitsTopK: config.gptSovitsTopK,
        gptSovitsTopP: config.gptSovitsTopP,
        gptSovitsTemperature: config.gptSovitsTemperature,
    };
}

async function playFallbackAudio(
    config: TtsConfig,
    event: any,
    audioRef: React.MutableRefObject<HTMLAudioElement | null>,
    requestIdRef: React.MutableRefObject<number>,
    requestId: number,
) {
    if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
    }
    window.dispatchEvent(new Event("jarvis-tts-start"));
    const audio = new Audio(
        `data:${event.mimeType || "audio/wav"};base64,${event.audioBase64}`,
    );
    audio.volume = clamp(config.volume, 0, 1);
    audio.onended = () => {
        if (requestId === requestIdRef.current) {
            window.dispatchEvent(new Event("jarvis-tts-end"));
        }
    };
    audio.onerror = () => {
        if (requestId === requestIdRef.current) {
            window.dispatchEvent(new Event("jarvis-tts-end"));
        }
    };
    audioRef.current = audio;
    await audio.play();
}

class PcmStreamPlayback {
    private context: AudioContext;
    private gain: GainNode;
    private channels: number;
    private sampleRate: number;
    private nextTime: number;
    private pending = new Uint8Array(0);
    private started = false;
    private closed = false;
    private sources = new Set<AudioBufferSourceNode>();
    private onPlaybackStart: () => void;

    constructor(options: {
        sampleRate: number;
        channels: number;
        volume: number;
        onPlaybackStart: () => void;
    }) {
        this.sampleRate = options.sampleRate;
        this.channels = Math.max(1, Math.min(2, options.channels || 1));
        this.context = new AudioContext({ sampleRate: this.sampleRate });
        this.gain = this.context.createGain();
        this.gain.gain.value = options.volume;
        this.gain.connect(this.context.destination);
        this.nextTime = this.context.currentTime + 0.04;
        this.onPlaybackStart = options.onPlaybackStart;
    }

    append(bytes: Uint8Array) {
        if (this.closed || bytes.length === 0) return;
        const merged = new Uint8Array(this.pending.length + bytes.length);
        merged.set(this.pending, 0);
        merged.set(bytes, this.pending.length);

        const frameSize = this.channels * 2;
        const usableLength = Math.floor(merged.length / frameSize) * frameSize;
        this.pending = merged.slice(usableLength);
        if (usableLength === 0) return;

        const samples = new Int16Array(
            merged.buffer,
            merged.byteOffset,
            usableLength / 2,
        );
        const frameCount = samples.length / this.channels;
        const buffer = this.context.createBuffer(
            this.channels,
            frameCount,
            this.sampleRate,
        );

        for (let channel = 0; channel < this.channels; channel += 1) {
            const channelData = buffer.getChannelData(channel);
            for (let frame = 0; frame < frameCount; frame += 1) {
                channelData[frame] = samples[frame * this.channels + channel] / 32768;
            }
        }

        const source = this.context.createBufferSource();
        source.buffer = buffer;
        source.connect(this.gain);
        source.onended = () => this.sources.delete(source);
        const startAt = Math.max(this.context.currentTime + 0.02, this.nextTime);
        source.start(startAt);
        this.nextTime = startAt + buffer.duration;
        this.sources.add(source);

        if (!this.started) {
            this.started = true;
            this.onPlaybackStart();
        }
    }

    finish(onDone: () => void) {
        if (this.closed) return;
        const delayMs = Math.max(0, (this.nextTime - this.context.currentTime) * 1000) + 50;
        window.setTimeout(() => {
            if (!this.closed) onDone();
        }, delayMs);
    }

    close() {
        this.closed = true;
        for (const source of this.sources) {
            try {
                source.stop();
            } catch (_) {}
        }
        this.sources.clear();
        void this.context.close();
    }
}

function base64ToUint8Array(value: string): Uint8Array {
    if (!value) return new Uint8Array(0);
    const binary = window.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
}
