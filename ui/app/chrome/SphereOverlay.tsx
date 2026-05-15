import type { MouseEvent } from "react";

interface Props {
    subtitle: string;
    micActive: boolean;
    onSphereClick: () => void;
    onSphereDoubleClick?: (event: MouseEvent) => void;
    onMouseDown?: (event: MouseEvent) => void;
}

export default function SphereOverlay({
    subtitle,
    micActive,
    onSphereClick,
    onSphereDoubleClick,
    onMouseDown,
}: Props) {
    const handleMouseDown = (event: MouseEvent) => {
        event.stopPropagation();
        onMouseDown?.(event);
    };

    return (
        <div
            style={{
                position: "absolute",
                inset: 0,
                zIndex: 50,
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                pointerEvents: "none",
            }}
        >
            {subtitle ? (
                <div
                    style={{
                        flex: 1,
                        padding: "8px 12px",
                        marginLeft: 12,
                        marginRight: 20,
                        background: "rgba(30,30,30,0.85)",
                        border: "1px solid rgba(120,80,30,0.4)",
                        borderRadius: 10,
                        color: "rgba(210,180,140,0.9)",
                        fontSize: 12,
                        lineHeight: 1.4,
                        maxHeight: "100%",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        pointerEvents: "auto",
                        backdropFilter: "blur(6px)",
                    }}
                >
                    {subtitle}
                </div>
            ) : micActive ? (
                <div
                    style={{
                        flex: 1,
                        padding: "8px 12px",
                        marginLeft: 12,
                        marginRight: 20,
                        color: "rgba(120,80,40,0.6)",
                        fontSize: 11,
                        fontFamily: "monospace",
                        letterSpacing: "0.15em",
                        pointerEvents: "none",
                    }}
                >
                    LISTENING...
                </div>
            ) : null}
            <div
                data-minimized-interactive="true"
                onMouseDown={handleMouseDown}
                title="드래그해서 이동"
                style={{
                    position: "relative",
                    width: 120,
                    minWidth: 120,
                    height: "100%",
                    cursor: "grab",
                    pointerEvents: "auto",
                    WebkitAppRegion: "drag",
                }}
            >
                <button
                    data-minimized-interactive="true"
                    type="button"
                    onMouseDown={handleMouseDown}
                    onClick={onSphereClick}
                    onDoubleClick={onSphereDoubleClick}
                    title="더블클릭해서 원래 창으로 복원"
                    style={{
                        position: "absolute",
                        right: 26,
                        top: "50%",
                        width: 68,
                        height: 68,
                        transform: "translateY(-50%)",
                        border: 0,
                        padding: 0,
                        background: "transparent",
                        cursor: "grab",
                        WebkitAppRegion: "no-drag",
                    }}
                />
            </div>
        </div>
    );
}
