import { sharedAudioRef } from "../audio/sharedAudioRef";
import type { Particle } from "./types";

export function applyPhysics(particles: Particle[]) {
    for (const p of particles) {
        const dx = p.tx - p.x;
        const dy = p.ty - p.y;
        p.vx = (p.vx + dx * 0.035) * 0.88;
        p.vy = (p.vy + dy * 0.035) * 0.88;
        p.x += p.vx;
        p.y += p.vy;
    }
}

export function isMiniMode(H: number): boolean {
    return H < 300;
}

export function getAudioLevel(): number {
    const audio = sharedAudioRef.current;
    if (!sharedAudioRef.active || !audio || audio.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < audio.length; i++) sum += audio[i];
    return sum / (audio.length * 255);
}
