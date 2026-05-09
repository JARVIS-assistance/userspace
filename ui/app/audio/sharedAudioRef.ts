export type AudioState = "idle" | "listening" | "speaking";

export const sharedAudioRef = {
    current: null as Uint8Array | null,
    active: false,
    state: "idle" as AudioState,
    speakingPulse: 0,
};

export function float32ToPcm16Base64(f32: Float32Array): string {
    const bytes = new Uint8Array(f32.length * 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < f32.length; i++) {
        const sample = Math.max(-1, Math.min(1, f32[i]));
        const value = sample < 0 ? sample * 32768 : sample * 32767;
        view.setInt16(i * 2, value, true);
    }

    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
}
