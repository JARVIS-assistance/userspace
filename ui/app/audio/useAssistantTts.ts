import { useCallback, useEffect, useRef } from "react";
import type { TtsConfig } from "../settings/types";

export function useAssistantTts(config: TtsConfig) {
    const configRef = useRef(config);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    configRef.current = config;

    const cancel = useCallback(() => {
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

        if (
            current.provider === "chatterbox" ||
            current.provider === "elevenlabs" ||
            current.provider === "openai"
        ) {
            void speakCommercial(current, cleaned, audioRef);
            return;
        }

        if (!("speechSynthesis" in window)) return;

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
) {
    const bridge = (window as any).jarvisBridge;
    if (!bridge?.synthesizeTts) return;

    window.dispatchEvent(new Event("jarvis-tts-start"));
    try {
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
        if (!result?.ok || !result.audioBase64) {
            console.warn("[TTS] synthesis failed", result?.error || result);
            window.dispatchEvent(new Event("jarvis-tts-end"));
            return;
        }

        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = "";
        }
        const audio = new Audio(
            `data:${result.mimeType || "audio/mpeg"};base64,${result.audioBase64}`,
        );
        audio.volume = clamp(config.volume, 0, 1);
        audio.onended = () => window.dispatchEvent(new Event("jarvis-tts-end"));
        audio.onerror = () => window.dispatchEvent(new Event("jarvis-tts-end"));
        audioRef.current = audio;
        await audio.play();
    } catch (error) {
        console.warn("[TTS] playback failed", error);
        window.dispatchEvent(new Event("jarvis-tts-end"));
    }
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
}
