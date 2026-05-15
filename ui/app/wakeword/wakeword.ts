import type { WakewordConfig, WakewordSample } from "../settings/types";

export const WAKEWORD_SAMPLE_RATE = 16000;
const FEATURE_FRAMES = 32;
const MIN_AUDIO_SECONDS = 0.35;
const DEFAULT_RECORD_MS = 1500;

export async function recordWakewordSample(
    durationMs = DEFAULT_RECORD_MS,
): Promise<WakewordSample> {
    const audio = await captureAudio(durationMs);
    const fingerprint = createWakewordFingerprint(audio);
    return {
        id: `wake-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        createdAt: Date.now(),
        durationMs,
        fingerprint,
    };
}

export function createWakewordFingerprint(audio: Float32Array): number[][] {
    const trimmed = trimSilence(audio);
    const source = trimmed.length >= WAKEWORD_SAMPLE_RATE * MIN_AUDIO_SECONDS
        ? trimmed
        : audio;
    const frameSize = Math.max(1, Math.floor(source.length / FEATURE_FRAMES));
    const features: number[][] = [];
    for (let i = 0; i < FEATURE_FRAMES; i += 1) {
        const start = i * frameSize;
        const end = i === FEATURE_FRAMES - 1
            ? source.length
            : Math.min(source.length, start + frameSize);
        features.push(frameFeatures(source.subarray(start, end)));
    }
    return normalizeFingerprint(features);
}

export function matchWakeword(
    fingerprint: number[][],
    config: WakewordConfig,
): { matched: boolean; hits: number; bestDistance: number } {
    const distances = config.samples
        .map((sample) => normalizedDtw(fingerprint, sample.fingerprint))
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b);
    const hits = distances.filter((value) => value <= config.threshold).length;
    return {
        matched: hits >= Math.min(2, config.samples.length),
        hits,
        bestDistance: distances[0] ?? Number.POSITIVE_INFINITY,
    };
}

export function rms(audio: Float32Array): number {
    if (audio.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < audio.length; i += 1) {
        sum += audio[i] * audio[i];
    }
    return Math.sqrt(sum / audio.length);
}

export function trimSilence(audio: Float32Array): Float32Array {
    if (audio.length === 0) return audio;
    const frame = Math.max(160, Math.floor(WAKEWORD_SAMPLE_RATE * 0.02));
    const frameRms: number[] = [];
    for (let offset = 0; offset < audio.length; offset += frame) {
        frameRms.push(rms(audio.subarray(offset, Math.min(audio.length, offset + frame))));
    }
    const sorted = [...frameRms].sort((a, b) => a - b);
    const floor = sorted[Math.floor(sorted.length * 0.35)] ?? 0.004;
    const threshold = Math.max(0.008, floor * 2.2);
    let first = 0;
    let last = frameRms.length - 1;
    while (first < frameRms.length && frameRms[first] < threshold) first += 1;
    while (last > first && frameRms[last] < threshold) last -= 1;
    const pad = Math.floor(WAKEWORD_SAMPLE_RATE * 0.08);
    const start = Math.max(0, first * frame - pad);
    const end = Math.min(audio.length, (last + 1) * frame + pad);
    return audio.subarray(start, end);
}

function frameFeatures(frame: Float32Array): number[] {
    if (frame.length === 0) return [0, 0, 0, 0, 0, 0];
    let sumSq = 0;
    let absSum = 0;
    let peak = 0;
    let zc = 0;
    let diff = 0;
    let positive = 0;
    let prev = frame[0];
    for (let i = 0; i < frame.length; i += 1) {
        const value = frame[i];
        const abs = Math.abs(value);
        sumSq += value * value;
        absSum += abs;
        peak = Math.max(peak, abs);
        if (value >= 0) positive += 1;
        if (i > 0) {
            if ((value >= 0) !== (prev >= 0)) zc += 1;
            diff += Math.abs(value - prev);
        }
        prev = value;
    }
    return [
        Math.sqrt(sumSq / frame.length),
        absSum / frame.length,
        peak,
        zc / Math.max(1, frame.length - 1),
        diff / Math.max(1, frame.length - 1),
        positive / frame.length,
    ];
}

function normalizeFingerprint(features: number[][]): number[][] {
    const cols = features[0]?.length ?? 0;
    const means = Array(cols).fill(0);
    const stds = Array(cols).fill(0);
    for (const row of features) {
        for (let i = 0; i < cols; i += 1) means[i] += row[i] ?? 0;
    }
    for (let i = 0; i < cols; i += 1) means[i] /= Math.max(1, features.length);
    for (const row of features) {
        for (let i = 0; i < cols; i += 1) {
            const delta = (row[i] ?? 0) - means[i];
            stds[i] += delta * delta;
        }
    }
    for (let i = 0; i < cols; i += 1) {
        stds[i] = Math.sqrt(stds[i] / Math.max(1, features.length)) || 1;
    }
    return features.map((row) =>
        row.map((value, i) => ((value ?? 0) - means[i]) / stds[i]),
    );
}

function normalizedDtw(a: number[][], b: number[][]): number {
    if (a.length === 0 || b.length === 0) return Number.POSITIVE_INFINITY;
    const rows = a.length + 1;
    const cols = b.length + 1;
    const dp = Array.from({ length: rows }, () => Array(cols).fill(Number.POSITIVE_INFINITY));
    dp[0][0] = 0;
    for (let i = 1; i < rows; i += 1) {
        for (let j = 1; j < cols; j += 1) {
            const cost = featureDistance(a[i - 1], b[j - 1]);
            dp[i][j] = cost + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
    }
    return dp[a.length][b.length] / (a.length + b.length);
}

function featureDistance(a: number[], b: number[]): number {
    const len = Math.max(a.length, b.length);
    let sum = 0;
    for (let i = 0; i < len; i += 1) {
        const delta = (a[i] ?? 0) - (b[i] ?? 0);
        sum += delta * delta;
    }
    return Math.sqrt(sum / Math.max(1, len));
}

async function captureAudio(durationMs: number): Promise<Float32Array> {
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
            channelCount: 1,
            sampleRate: WAKEWORD_SAMPLE_RATE,
            echoCancellation: true,
            noiseSuppression: true,
        },
    });
    const context = new AudioContext({ sampleRate: WAKEWORD_SAMPLE_RATE });
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(1024, 1, 1);
    const chunks: Float32Array[] = [];
    processor.onaudioprocess = (event) => {
        chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    source.connect(processor);
    processor.connect(context.destination);
    await new Promise((resolve) => window.setTimeout(resolve, durationMs));
    processor.disconnect();
    source.disconnect();
    await context.close();
    stream.getTracks().forEach((track) => track.stop());
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const audio = new Float32Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        audio.set(chunk, offset);
        offset += chunk.length;
    }
    return audio;
}
