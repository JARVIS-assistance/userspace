export type AudioState = "idle" | "listening" | "speaking";

export const sharedAudioRef = {
    current: null as Uint8Array | null,
    active: false,
    state: "idle" as AudioState,
    speakingPulse: 0,
};

export function float32ToInt16Array(f32: Float32Array): number[] {
    const out: number[] = new Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
        const s = Math.max(-1, Math.min(1, f32[i]));
        out[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
    }
    return out;
}
