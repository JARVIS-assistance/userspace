import { css } from "./styles";
import type { VisualConfig } from "./types";

interface Props {
    config: VisualConfig;
    onChange: (patch: Partial<VisualConfig>) => void;
}

const MIN_DENSITY = 0.25;
const MAX_DENSITY = 1;

export default function VisualTab({ config, onChange }: Props) {
    const density = clampDensity(config.particleDensity);

    return (
        <div>
            <div style={{ marginBottom: 18 }}>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: 6,
                    }}
                >
                    <label style={{ ...css.label, marginBottom: 0 }}>DOT COUNT</label>
                    <span style={{ fontFamily: "monospace", fontSize: 11 }}>
                        {Math.round(density * 100)}%
                    </span>
                </div>
                <input
                    type="range"
                    min={MIN_DENSITY}
                    max={MAX_DENSITY}
                    step={0.05}
                    value={density}
                    onChange={(e) =>
                        onChange({ particleDensity: Number(e.target.value) })
                    }
                    style={{ width: "100%" }}
                />
                <div
                    style={{
                        marginTop: 8,
                        color: "rgba(120,80,40,0.62)",
                        fontSize: 12,
                        lineHeight: 1.5,
                    }}
                >
                    Lower values reduce the waveform background particles.
                </div>
            </div>
        </div>
    );
}

function clampDensity(value: number): number {
    if (!Number.isFinite(value)) return MAX_DENSITY;
    return Math.min(MAX_DENSITY, Math.max(MIN_DENSITY, value));
}
