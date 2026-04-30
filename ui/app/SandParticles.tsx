import { useEffect, useRef } from "react";
import { applyPhysics } from "./particles/physics";
import { SphereLayer } from "./particles/sphere";
import type { ViewMode } from "./particles/types";
import { WaveLayer } from "./particles/wave";

export type { ViewMode };

interface Props {
    viewMode: ViewMode;
    onMinimizeDone?: () => void;
    onRestoreDone?: () => void;
    onSphereClick?: () => void;
}

const FADE_DUR = 0.25;

export default function SandParticles(props: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const propsRef = useRef(props);
    propsRef.current = props;

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const wave = new WaveLayer();
        const sphere = new SphereLayer();
        let W = 0;
        let H = 0;
        let raf = 0;
        let mode: ViewMode = "waveform";
        let modeStart = 0;
        let minFired = false;
        let resFired = false;

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

        function draw() {
            const ctx = canvas!.getContext("2d");
            if (!ctx) {
                raf = requestAnimationFrame(draw);
                return;
            }

            const pr = propsRef.current;
            const now = performance.now() / 1000;

            if (mode !== pr.viewMode) {
                mode = pr.viewMode;
                modeStart = now;
                if (mode === "minimizing") minFired = false;
                if (mode === "restoring") resFired = false;

                if (mode === "sphere") {
                    sphere.updateTargets(now, W, H);
                    sphere.snapToTargets();
                }
            }

            const elapsed = now - modeStart;

            let waveOpacity = 1;
            let sphereOpacity = 0;

            if (mode === "waveform") {
                waveOpacity = 1;
                sphereOpacity = 0;
            } else if (mode === "minimizing") {
                waveOpacity = Math.max(0, 1 - elapsed / FADE_DUR);
                sphereOpacity = 0;
            } else if (mode === "sphere") {
                waveOpacity = 0;
                sphereOpacity = Math.min(1, elapsed / 0.2);
            } else if (mode === "restoring") {
                sphereOpacity = 0;
                waveOpacity = Math.min(1, elapsed / FADE_DUR);
            }

            if (waveOpacity > 0) {
                wave.updateTargets(now, W, H);
                applyPhysics(wave.particles);
            }
            if (sphereOpacity > 0 || mode === "sphere") {
                sphere.updateTargets(now, W, H);
                applyPhysics(sphere.particles);
            }

            if (mode === "minimizing" && elapsed >= FADE_DUR && !minFired) {
                minFired = true;
                propsRef.current.onMinimizeDone?.();
            }
            if (mode === "restoring" && elapsed >= FADE_DUR && !resFired) {
                resFired = true;
                propsRef.current.onRestoreDone?.();
            }

            ctx.clearRect(0, 0, W, H);
            wave.render(ctx, waveOpacity);
            sphere.renderGlow(ctx, sphereOpacity, W, H);
            sphere.render(ctx, sphereOpacity);

            raf = requestAnimationFrame(draw);
        }

        resize();
        wave.init(W, H);
        sphere.init(W, H);
        raf = requestAnimationFrame(draw);

        const onResize = () => resize();
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
            style={{
                position: "fixed",
                top: 0,
                left: 0,
                width: "100vw",
                height: "100vh",
                cursor: props.viewMode === "sphere" ? "pointer" : "default",
                outline: "none",
            }}
        />
    );
}
