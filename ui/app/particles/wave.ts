import { sharedAudioRef } from "../audio/sharedAudioRef";
import { COLORS, paletteFor } from "./colors";
import type { Particle } from "./types";

const BAR_COUNT = 48;
const PER_BAR = 38;
const AMBIENT = 350;

export class WaveLayer {
    particles: Particle[] = [];
    private colorR: number[] = [];
    private colorG: number[] = [];
    private colorB: number[] = [];
    private colorsInit = false;
    private speakingLevel = 0;

    init(W: number, H: number) {
        this.particles = [];
        this.colorsInit = false;
        const cy = H * 0.5;
        const tw = W * 0.7;
        const sx = W * 0.15;
        const cw = tw / BAR_COUNT;
        for (let b = 0; b < BAR_COUNT; b++) {
            const bx = sx + cw * (b + 0.5);
            for (let i = 0; i < PER_BAR; i++) {
                this.particles.push({
                    x: bx + (Math.random() - 0.5) * 80,
                    y: cy + (Math.random() - 0.5) * 80,
                    tx: bx,
                    ty: cy,
                    vx: 0,
                    vy: 0,
                    s: 1.5 + Math.random() * 2,
                    ci: (Math.random() * COLORS.length) | 0,
                    a: 0.6 + Math.random() * 0.4,
                    ph: Math.random() * Math.PI * 2,
                    bar: b,
                    bp: i / (PER_BAR - 1),
                });
            }
        }
        for (let i = 0; i < AMBIENT; i++) {
            this.particles.push({
                x: Math.random() * W,
                y: Math.random() * H,
                tx: Math.random() * W,
                ty: Math.random() * H,
                vx: 0,
                vy: 0,
                s: 0.8 + Math.random() * 1.2,
                ci: (Math.random() * COLORS.length) | 0,
                a: 0.15 + Math.random() * 0.3,
                ph: Math.random() * Math.PI * 2,
                bar: -1,
                bp: 0,
            });
        }
    }

    updateTargets(now: number, W: number, H: number) {
        const centerY = H * 0.5;
        const tw = W * 0.7;
        const sx = W * 0.15;
        const cw = tw / BAR_COUNT;
        const audio = sharedAudioRef.current;
        const active = sharedAudioRef.active;
        const isSpeaking = sharedAudioRef.state === "speaking";

        if (isSpeaking) {
            const target = sharedAudioRef.speakingPulse;
            this.speakingLevel += (target - this.speakingLevel) * 0.18;
            sharedAudioRef.speakingPulse *= 0.92;
        } else {
            this.speakingLevel *= 0.9;
        }

        for (const p of this.particles) {
            if (p.bar < 0) {
                p.tx += Math.sin(now * 0.3 + p.ph) * 0.1;
                p.ty += Math.cos(now * 0.25 + p.ph) * 0.1;
                if (p.tx < 0) p.tx = 10;
                if (p.tx > W) p.tx = W - 10;
                if (p.ty < 0) p.ty = 10;
                if (p.ty > H) p.ty = H - 10;
                continue;
            }
            const bx = sx + cw * (p.bar + 0.5);
            let bH: number;
            if (active && audio && audio.length > 0) {
                const bin = ((p.bar / BAR_COUNT) * audio.length) | 0;
                bH = H * 0.05 + (audio[bin] / 255) * H * 0.35;
                bH += Math.sin(now * 3 + p.bar * 0.2) * H * 0.01;
            } else if (isSpeaking && this.speakingLevel > 0.01) {
                const wave1 = Math.sin(now * 4.0 + p.bar * 0.3) * 0.5 + 0.5;
                const wave2 = Math.sin(now * 2.5 - p.bar * 0.15) * 0.5 + 0.5;
                const wave3 = Math.sin(now * 6.0 + p.bar * 0.5) * 0.3 + 0.5;
                const combined = wave1 * 0.4 + wave2 * 0.35 + wave3 * 0.25;
                bH = H * 0.04 + combined * this.speakingLevel * H * 0.25;
            } else {
                const c =
                    (Math.sin(p.bar * 0.15 + now * 0.8) * 0.5 + 0.5) * 0.4 +
                    (Math.sin(p.bar * 0.08 - now * 0.5) * 0.5 + 0.5) * 0.35 +
                    (Math.sin(p.bar * 0.22 + now * 1.2) * 0.3 + 0.5) * 0.25;
                bH = H * 0.03 + c * H * 0.15;
            }
            const half = bH * 0.5;
            p.tx = bx + Math.sin(now * 1.5 + p.ph) * cw * 0.12;
            p.ty = centerY - half + p.bp * bH;
        }
    }

    render(ctx: CanvasRenderingContext2D, opacity: number) {
        if (opacity <= 0.001) return;
        const ps = this.particles;
        if (!this.colorsInit || this.colorR.length !== ps.length) {
            this.colorR = ps.map((p) => COLORS[p.ci][0]);
            this.colorG = ps.map((p) => COLORS[p.ci][1]);
            this.colorB = ps.map((p) => COLORS[p.ci][2]);
            this.colorsInit = true;
        }
        const palette = paletteFor(sharedAudioRef.state);
        const lerp = 0.06;
        for (let i = 0; i < ps.length; i++) {
            const p = ps[i];
            const [tr, tg, tb] = palette[p.ci];
            this.colorR[i] += (tr - this.colorR[i]) * lerp;
            this.colorG[i] += (tg - this.colorG[i]) * lerp;
            this.colorB[i] += (tb - this.colorB[i]) * lerp;
            const al = Math.min(1, p.a) * opacity;
            if (al < 0.01) continue;
            ctx.fillStyle = `rgba(${this.colorR[i] | 0},${this.colorG[i] | 0},${this.colorB[i] | 0},${al})`;
            ctx.fillRect(p.x - p.s * 0.5, p.y - p.s * 0.5, p.s, p.s);
        }
    }
}
