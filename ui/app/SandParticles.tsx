import { useEffect, useRef } from "react";
import { sharedAudioRef } from "./App";

export type ViewMode = "waveform" | "minimizing" | "sphere" | "restoring";

interface Props {
  viewMode: ViewMode;
  onMinimizeDone?: () => void;
  onRestoreDone?: () => void;
  onSphereClick?: () => void;
}

const COLORS: Array<[number, number, number]> = [
  [194, 149, 107], [212, 167, 106], [222, 184, 135], [196, 168, 130],
  [184, 149, 106], [232, 201, 155], [160, 130, 90], [245, 222, 179],
];
// Listening (input): cyan/blue tint
const COLORS_LISTEN: Array<[number, number, number]> = [
  [100, 180, 220], [120, 195, 230], [80, 160, 210], [140, 200, 235],
  [90, 170, 215], [110, 190, 225], [70, 150, 200], [150, 210, 240],
];
// Speaking (output): warm amber/orange tint
const COLORS_SPEAK: Array<[number, number, number]> = [
  [230, 160, 60], [240, 175, 70], [220, 145, 50], [245, 185, 80],
  [210, 135, 45], [235, 170, 65], [250, 195, 90], [225, 155, 55],
];
const BAR_COUNT = 48;
const PER_BAR = 38;
const AMBIENT = 350;
const SPHERE_COUNT = 600;
const FADE_DUR = 0.25; // seconds for fade in/out

interface P {
  x: number; y: number; tx: number; ty: number;
  vx: number; vy: number; s: number; ci: number;
  a: number; ph: number; bar: number; bp: number;
}

export default function SandParticles(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let wave: P[] = [];      // waveform particles
    let sphere: P[] = [];    // sphere particles
    let W = 0, H = 0;
    let raf = 0;
    let mode: ViewMode = "waveform";
    let modeStart = 0;
    let minFired = false, resFired = false;
    // Smooth color blend: [r, g, b] per particle slot, lerped each frame
    let sphereColorR: number[] = [];
    let sphereColorG: number[] = [];
    let sphereColorB: number[] = [];

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      W = window.innerWidth;
      H = window.innerHeight;
      canvas!.width = W * dpr;
      canvas!.height = H * dpr;
      canvas!.style.width = W + "px";
      canvas!.style.height = H + "px";
      const ctx = canvas!.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function initWave() {
      wave = [];
      const cy = H * 0.5, tw = W * 0.7, sx = W * 0.15, cw = tw / BAR_COUNT;
      for (let b = 0; b < BAR_COUNT; b++) {
        const bx = sx + cw * (b + 0.5);
        for (let i = 0; i < PER_BAR; i++) {
          wave.push({
            x: bx + (Math.random() - 0.5) * 80,
            y: cy + (Math.random() - 0.5) * 80,
            tx: bx, ty: cy, vx: 0, vy: 0,
            s: 1.5 + Math.random() * 2,
            ci: (Math.random() * COLORS.length) | 0,
            a: 0.6 + Math.random() * 0.4,
            ph: Math.random() * Math.PI * 2,
            bar: b, bp: i / (PER_BAR - 1),
          });
        }
      }
      for (let i = 0; i < AMBIENT; i++) {
        wave.push({
          x: Math.random() * W, y: Math.random() * H,
          tx: Math.random() * W, ty: Math.random() * H,
          vx: 0, vy: 0,
          s: 0.8 + Math.random() * 1.2,
          ci: (Math.random() * COLORS.length) | 0,
          a: 0.15 + Math.random() * 0.3,
          ph: Math.random() * Math.PI * 2,
          bar: -1, bp: 0,
        });
      }
    }

    function initSphere() {
      sphere = [];
      sphereColorR = [];
      sphereColorG = [];
      sphereColorB = [];
      // Sphere particles — positioned at sphere center, will be placed by targets
      const cx = W * 0.85, cy = H * 0.15;
      for (let i = 0; i < SPHERE_COUNT; i++) {
        const ci = (Math.random() * COLORS.length) | 0;
        sphere.push({
          x: cx + (Math.random() - 0.5) * 10,
          y: cy + (Math.random() - 0.5) * 10,
          tx: cx, ty: cy, vx: 0, vy: 0,
          s: 1.2 + Math.random() * 1.5,
          ci,
          a: 0.5 + Math.random() * 0.5,
          ph: Math.random() * Math.PI * 2,
          bar: -1, bp: 0,
        });
        sphereColorR.push(COLORS[ci][0]);
        sphereColorG.push(COLORS[ci][1]);
        sphereColorB.push(COLORS[ci][2]);
      }
    }

    // ── speaking 시 가상 오디오 레벨 (delta pulse 기반) ──
    let speakingLevel = 0;

    // ── update waveform targets ──
    function updateWaveTargets(now: number) {
      const centerY = H * 0.5, tw = W * 0.7, sx = W * 0.15, cw = tw / BAR_COUNT;
      const audio = sharedAudioRef.current;
      const active = sharedAudioRef.active;
      const isSpeaking = sharedAudioRef.state === "speaking";

      // speaking 펄스: delta 도착 시 1로 점프, 점차 감쇠
      if (isSpeaking) {
        const target = sharedAudioRef.speakingPulse;
        speakingLevel += (target - speakingLevel) * 0.18;
        sharedAudioRef.speakingPulse *= 0.92; // 자연 감쇠
      } else {
        speakingLevel *= 0.9;
      }

      for (const p of wave) {
        if (p.bar < 0) {
          p.tx += Math.sin(now * 0.3 + p.ph) * 0.1;
          p.ty += Math.cos(now * 0.25 + p.ph) * 0.1;
          if (p.tx < 0) p.tx = 10; if (p.tx > W) p.tx = W - 10;
          if (p.ty < 0) p.ty = 10; if (p.ty > H) p.ty = H - 10;
          continue;
        }
        const bx = sx + cw * (p.bar + 0.5);
        let bH: number;
        if (active && audio && audio.length > 0) {
          // 마이크 입력 애니메이션
          const bin = (p.bar / BAR_COUNT * audio.length) | 0;
          bH = H * 0.05 + (audio[bin] / 255) * H * 0.35;
          bH += Math.sin(now * 3 + p.bar * 0.2) * H * 0.01;
        } else if (isSpeaking && speakingLevel > 0.01) {
          // AI 응답 애니메이션: 바별로 다른 위상의 파형
          const wave1 = Math.sin(now * 4.0 + p.bar * 0.3) * 0.5 + 0.5;
          const wave2 = Math.sin(now * 2.5 - p.bar * 0.15) * 0.5 + 0.5;
          const wave3 = Math.sin(now * 6.0 + p.bar * 0.5) * 0.3 + 0.5;
          const combined = wave1 * 0.4 + wave2 * 0.35 + wave3 * 0.25;
          bH = H * 0.04 + combined * speakingLevel * H * 0.25;
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

    // ── audio level (0–1) for sphere pulse ──
    let smoothLevel = 0;
    function getAudioLevel(): number {
      const audio = sharedAudioRef.current;
      if (!sharedAudioRef.active || !audio || audio.length === 0) return 0;
      let sum = 0;
      for (let i = 0; i < audio.length; i++) sum += audio[i];
      return sum / (audio.length * 255);
    }

    // ── update sphere targets ──
    function isMiniMode() { return H < 300; }
    function updateSphereTargets(now: number) {
      const mini = isMiniMode();
      const cx = mini ? W - H * 0.5 : W * 0.85;
      const cy = mini ? H * 0.5 : H * 0.15;
      const baseR = mini ? H * 0.32 : Math.min(W, H) * 0.055;

      // Pulse: smooth audio level → scale radius by up to 20%
      const target = getAudioLevel();
      smoothLevel += (target - smoothLevel) * 0.15;
      const pulse = 1 + smoothLevel * 0.2;
      const r = baseR * pulse;

      const ga = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < sphere.length; i++) {
        const p = sphere[i];
        const t = i / sphere.length;
        const y3 = 1 - 2 * t;
        const rr = Math.sqrt(1 - y3 * y3);
        const th = ga * i + now * 0.4;
        const px = rr * Math.cos(th), pz = rr * Math.sin(th);
        const pe = 1 / (1.8 - pz * 0.4);
        p.tx = cx + px * r * pe;
        p.ty = cy + y3 * r * pe;
      }
    }

    // ── apply physics to a particle set ──
    function physics(ps: P[]) {
      for (const p of ps) {
        const dx = p.tx - p.x, dy = p.ty - p.y;
        p.vx = (p.vx + dx * 0.035) * 0.88;
        p.vy = (p.vy + dy * 0.035) * 0.88;
        p.x += p.vx;
        p.y += p.vy;
      }
    }

    // ── waveform 파티클 색상 블렌딩 ──
    let waveColorR: number[] = [];
    let waveColorG: number[] = [];
    let waveColorB: number[] = [];
    let waveColorsInit = false;

    function renderParticles(ctx: CanvasRenderingContext2D, ps: P[], opacity: number) {
      if (opacity <= 0.001) return;
      if (!waveColorsInit || waveColorR.length !== ps.length) {
        waveColorR = ps.map(p => COLORS[p.ci][0]);
        waveColorG = ps.map(p => COLORS[p.ci][1]);
        waveColorB = ps.map(p => COLORS[p.ci][2]);
        waveColorsInit = true;
      }
      const state = sharedAudioRef.state;
      const palette = state === "listening" ? COLORS_LISTEN
                    : state === "speaking" ? COLORS_SPEAK
                    : COLORS;
      const lerp = 0.06;
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        const [tr, tg, tb] = palette[p.ci];
        waveColorR[i] += (tr - waveColorR[i]) * lerp;
        waveColorG[i] += (tg - waveColorG[i]) * lerp;
        waveColorB[i] += (tb - waveColorB[i]) * lerp;
        const al = Math.min(1, p.a) * opacity;
        if (al < 0.01) continue;
        ctx.fillStyle = `rgba(${waveColorR[i] | 0},${waveColorG[i] | 0},${waveColorB[i] | 0},${al})`;
        ctx.fillRect(p.x - p.s * 0.5, p.y - p.s * 0.5, p.s, p.s);
      }
    }

    // ── render sphere particles with state-based color ──
    function renderSphereParticles(ctx: CanvasRenderingContext2D, opacity: number) {
      if (opacity <= 0.001) return;
      const state = sharedAudioRef.state;
      const palette = state === "listening" ? COLORS_LISTEN
                    : state === "speaking" ? COLORS_SPEAK
                    : COLORS;
      const lerp = 0.08; // smooth color transition speed
      for (let i = 0; i < sphere.length; i++) {
        const p = sphere[i];
        const [tr, tg, tb] = palette[p.ci];
        sphereColorR[i] += (tr - sphereColorR[i]) * lerp;
        sphereColorG[i] += (tg - sphereColorG[i]) * lerp;
        sphereColorB[i] += (tb - sphereColorB[i]) * lerp;
        const al = Math.min(1, p.a) * opacity;
        if (al < 0.01) continue;
        ctx.fillStyle = `rgba(${sphereColorR[i] | 0},${sphereColorG[i] | 0},${sphereColorB[i] | 0},${al})`;
        ctx.fillRect(p.x - p.s * 0.5, p.y - p.s * 0.5, p.s, p.s);
      }
    }

    // ── sphere glow ──
    let glowR = 222, glowG = 184, glowB = 135; // smooth glow color
    function renderSphereGlow(ctx: CanvasRenderingContext2D, opacity: number) {
      if (opacity <= 0.01) return;
      const state = sharedAudioRef.state;
      const tR = state === "listening" ? 100 : state === "speaking" ? 240 : 222;
      const tG = state === "listening" ? 180 : state === "speaking" ? 170 : 184;
      const tB = state === "listening" ? 220 : state === "speaking" ? 60 : 135;
      glowR += (tR - glowR) * 0.08;
      glowG += (tG - glowG) * 0.08;
      glowB += (tB - glowB) * 0.08;
      const cr = glowR | 0, cg = glowG | 0, cb = glowB | 0;

      const mini = isMiniMode();
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

    // ── main draw loop ──
    function draw() {
      const ctx = canvas!.getContext("2d");
      if (!ctx) { raf = requestAnimationFrame(draw); return; }

      const pr = propsRef.current;
      const now = performance.now() / 1000;

      // detect mode change
      if (mode !== pr.viewMode) {
        mode = pr.viewMode;
        modeStart = now;
        if (mode === "minimizing") minFired = false;
        if (mode === "restoring") resFired = false;

        // Snap sphere particles to their targets so they don't wobble on fade in
        if (mode === "sphere") {
          updateSphereTargets(now);
          for (const p of sphere) {
            p.x = p.tx;
            p.y = p.ty;
            p.vx = 0;
            p.vy = 0;
          }
        }
      }

      const elapsed = now - modeStart;

      // ── compute opacities ──
      // minimizing: wave fades out only (sphere waits for window resize)
      // sphere: sphere fades in (after window has resized)
      // restoring: wave fades in (after window has restored)
      let waveOpacity = 1;
      let sphereOpacity = 0;

      if (mode === "waveform") {
        waveOpacity = 1;
        sphereOpacity = 0;
      } else if (mode === "minimizing") {
        // Only fade out waveform. Sphere stays hidden.
        waveOpacity = Math.max(0, 1 - elapsed / FADE_DUR);
        sphereOpacity = 0;
      } else if (mode === "sphere") {
        // Quick fade in sphere (window already resized)
        waveOpacity = 0;
        sphereOpacity = Math.min(1, elapsed / 0.2);
      } else if (mode === "restoring") {
        // Wave fades in (window already restored)
        sphereOpacity = 0;
        waveOpacity = Math.min(1, elapsed / FADE_DUR);
      }

      // ── update targets + physics ──
      if (waveOpacity > 0) {
        updateWaveTargets(now);
        physics(wave);
      }
      if (sphereOpacity > 0 || mode === "sphere") {
        updateSphereTargets(now);
        physics(sphere);
      }

      // ── check transitions ──
      // minimizing: fire after waveform fully faded out
      if (mode === "minimizing" && elapsed >= FADE_DUR && !minFired) {
        minFired = true;
        propsRef.current.onMinimizeDone?.();
      }
      // restoring: fire after waveform fully faded in
      if (mode === "restoring" && elapsed >= FADE_DUR && !resFired) {
        resFired = true;
        propsRef.current.onRestoreDone?.();
      }

      // ── render ──
      ctx.clearRect(0, 0, W, H);
      renderParticles(ctx, wave, waveOpacity);
      renderSphereGlow(ctx, sphereOpacity);
      renderSphereParticles(ctx, sphereOpacity);

      raf = requestAnimationFrame(draw);
    }

    resize();
    initWave();
    initSphere();
    raf = requestAnimationFrame(draw);

    const onResize = () => {
      resize();
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const handleCanvasClick = () => {
    if (propsRef.current.viewMode === "sphere") {
      propsRef.current.onSphereClick?.();
    }
  };

  return (
    <canvas
      ref={canvasRef}
      onClick={handleCanvasClick}
      style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", cursor: props.viewMode === "sphere" ? "pointer" : "default", outline: "none" }}
    />
  );
}
