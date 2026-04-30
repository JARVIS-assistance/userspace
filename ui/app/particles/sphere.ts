import { sharedAudioRef } from "../audio/sharedAudioRef";
import { COLORS, paletteFor } from "./colors";
import { getAudioLevel, isMiniMode } from "./physics";
import type { Particle } from "./types";

const SPHERE_COUNT = 600;

export class SphereLayer {
    particles: Particle[] = [];
    private colorR: number[] = [];
    private colorG: number[] = [];
    private colorB: number[] = [];
    private smoothLevel = 0;
    private glowR = 222;
    private glowG = 184;
    private glowB = 135;

    init(W: number, H: number) {
        this.particles = [];
        this.colorR = [];
        this.colorG = [];
        this.colorB = [];
        const cx = W * 0.85;
        const cy = H * 0.15;
        for (let i = 0; i < SPHERE_COUNT; i++) {
            const ci = (Math.random() * COLORS.length) | 0;
            this.particles.push({
                x: cx + (Math.random() - 0.5) * 10,
                y: cy + (Math.random() - 0.5) * 10,
                tx: cx,
                ty: cy,
                vx: 0,
                vy: 0,
                s: 1.2 + Math.random() * 1.5,
                ci,
                a: 0.5 + Math.random() * 0.5,
                ph: Math.random() * Math.PI * 2,
                bar: -1,
                bp: 0,
            });
            this.colorR.push(COLORS[ci][0]);
            this.colorG.push(COLORS[ci][1]);
            this.colorB.push(COLORS[ci][2]);
        }
    }

    updateTargets(now: number, W: number, H: number) {
        const mini = isMiniMode(H);
        const cx = mini ? W - H * 0.5 : W * 0.85;
        const cy = mini ? H * 0.5 : H * 0.15;
        const baseR = mini ? H * 0.32 : Math.min(W, H) * 0.055;

        const target = getAudioLevel();
        this.smoothLevel += (target - this.smoothLevel) * 0.15;
        const pulse = 1 + this.smoothLevel * 0.2;
        const r = baseR * pulse;

        const ga = Math.PI * (3 - Math.sqrt(5));
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            const t = i / this.particles.length;
            const y3 = 1 - 2 * t;
            const rr = Math.sqrt(1 - y3 * y3);
            const th = ga * i + now * 0.4;
            const px = rr * Math.cos(th);
            const pz = rr * Math.sin(th);
            const pe = 1 / (1.8 - pz * 0.4);
            p.tx = cx + px * r * pe;
            p.ty = cy + y3 * r * pe;
        }
    }

    snapToTargets() {
        for (const p of this.particles) {
            p.x = p.tx;
            p.y = p.ty;
            p.vx = 0;
            p.vy = 0;
        }
    }

    render(ctx: CanvasRenderingContext2D, opacity: number) {
        if (opacity <= 0.001) return;
        const palette = paletteFor(sharedAudioRef.state);
        const lerp = 0.08;
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
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

    renderGlow(ctx: CanvasRenderingContext2D, opacity: number, W: number, H: number) {
        if (opacity <= 0.01) return;
        const state = sharedAudioRef.state;
        const tR = state === "listening" ? 100 : state === "speaking" ? 240 : 222;
        const tG = state === "listening" ? 180 : state === "speaking" ? 170 : 184;
        const tB = state === "listening" ? 220 : state === "speaking" ? 60 : 135;
        this.glowR += (tR - this.glowR) * 0.08;
        this.glowG += (tG - this.glowG) * 0.08;
        this.glowB += (tB - this.glowB) * 0.08;
        const cr = this.glowR | 0;
        const cg = this.glowG | 0;
        const cb = this.glowB | 0;

        const mini = isMiniMode(H);
        const gx = mini ? W - H * 0.5 : W * 0.85;
        const gy = mini ? H * 0.5 : H * 0.15;
        const gr = mini ? H * 0.45 : Math.min(W, H) * 0.09;
        const a = 0.15 * opacity;
        const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
        grad.addColorStop(0, `rgba(${cr},${cg},${cb},${a})`);
        grad.addColorStop(0.6, `rgba(${cr},${cg},${cb},${a * 0.4})`);
        grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(gx, gy, gr, 0, Math.PI * 2);
        ctx.fill();
    }
}
