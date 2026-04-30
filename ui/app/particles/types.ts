export type ViewMode = "waveform" | "minimizing" | "sphere" | "restoring";

export interface Particle {
    x: number;
    y: number;
    tx: number;
    ty: number;
    vx: number;
    vy: number;
    s: number;
    ci: number;
    a: number;
    ph: number;
    bar: number;
    bp: number;
}
