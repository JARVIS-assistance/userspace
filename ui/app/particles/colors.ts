export type RGB = [number, number, number];

export const COLORS: RGB[] = [
    [194, 149, 107], [212, 167, 106], [222, 184, 135], [196, 168, 130],
    [184, 149, 106], [232, 201, 155], [160, 130, 90], [245, 222, 179],
];

// Listening (input): cyan/blue tint
export const COLORS_LISTEN: RGB[] = [
    [100, 180, 220], [120, 195, 230], [80, 160, 210], [140, 200, 235],
    [90, 170, 215], [110, 190, 225], [70, 150, 200], [150, 210, 240],
];

// Speaking (output): warm amber/orange tint
export const COLORS_SPEAK: RGB[] = [
    [230, 160, 60], [240, 175, 70], [220, 145, 50], [245, 185, 80],
    [210, 135, 45], [235, 170, 65], [250, 195, 90], [225, 155, 55],
];

export function paletteFor(state: string): RGB[] {
    if (state === "listening") return COLORS_LISTEN;
    if (state === "speaking") return COLORS_SPEAK;
    return COLORS;
}
