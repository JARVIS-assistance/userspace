import { useCallback, useEffect, useRef, useState } from "react";
import {
    chooseCameraDevice,
    getCameraConstraints,
    isVirtualCamera,
    listCameraDevices,
    type CameraDevice,
} from "./camera";
import { css } from "./styles";
import type { CameraConfig } from "./types";

interface Props {
    config: CameraConfig;
    onChange: (patch: Partial<CameraConfig>) => void;
}

export default function CameraTab({ config, onChange }: Props) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const activePreviewConfigKeyRef = useRef("");
    const [devices, setDevices] = useState<CameraDevice[]>([]);
    const [loading, setLoading] = useState(false);
    const [previewing, setPreviewing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const previewConfigKey = [
        config.deviceId,
        config.label,
        String(config.preferPhysical),
    ].join("|");

    const stopPreview = useCallback(() => {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        activePreviewConfigKeyRef.current = "";
        if (videoRef.current) videoRef.current.srcObject = null;
        setPreviewing(false);
    }, []);

    const refreshDevices = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const listed = await listCameraDevices();
            setDevices(listed);
        } catch (err) {
            setError(String(err));
        } finally {
            setLoading(false);
        }
    }, []);

    const requestAccessAndRefresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: false,
            });
            stream.getTracks().forEach((track) => track.stop());
            const listed = await listCameraDevices();
            setDevices(listed);
        } catch (err) {
            setError(String(err));
        } finally {
            setLoading(false);
        }
    }, []);

    const startPreview = useCallback(async () => {
        setLoading(true);
        setError(null);
        stopPreview();
        try {
            let listed = devices;
            if (!listed.length) {
                listed = await listCameraDevices();
                setDevices(listed);
            }
            if (listed.some((device) => !device.label.trim())) {
                const probe = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: false,
                });
                probe.getTracks().forEach((track) => track.stop());
                listed = await listCameraDevices();
                setDevices(listed);
            }
            const stream = await navigator.mediaDevices.getUserMedia(
                getCameraConstraints(listed, config),
            );
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
            }
            activePreviewConfigKeyRef.current = previewConfigKey;
            setPreviewing(true);
        } catch (err) {
            setError(String(err));
        } finally {
            setLoading(false);
        }
    }, [config, devices, previewConfigKey, stopPreview]);

    useEffect(() => {
        void refreshDevices();
        return stopPreview;
    }, [refreshDevices, stopPreview]);

    useEffect(() => {
        if (!previewing || loading) return;
        if (activePreviewConfigKeyRef.current === previewConfigKey) return;
        void startPreview();
    }, [loading, previewConfigKey, previewing, startPreview]);

    const selected = chooseCameraDevice(devices, config);

    return (
        <div>
            <div style={{ marginBottom: 18 }}>
                <label style={css.label}>CAMERA</label>
                <select
                    style={css.select}
                    value={config.deviceId}
                    onChange={(event) => {
                        const deviceId = event.target.value;
                        const device = devices.find((d) => d.deviceId === deviceId);
                        onChange({
                            deviceId,
                            label: device?.label || "",
                        });
                    }}
                >
                    <option value="">AUTO - prefer physical camera</option>
                    {devices.map((device) => (
                        <option key={device.deviceId} value={device.deviceId}>
                            {device.label}
                            {isVirtualCamera(device) ? " (virtual)" : ""}
                        </option>
                    ))}
                </select>
                <div style={hintStyle}>
                    Current: {selected?.label || "No camera detected"}
                </div>
            </div>

            <label style={checkboxStyle}>
                <input
                    type="checkbox"
                    checked={config.preferPhysical}
                    onChange={(event) =>
                        onChange({ preferPhysical: event.target.checked })
                    }
                />
                Prefer physical cameras over OBS/virtual devices when AUTO is selected
            </label>

            <div style={{ ...css.row, marginTop: 18 }}>
                <button
                    type="button"
                    style={css.btn("ghost")}
                    disabled={loading}
                    onClick={requestAccessAndRefresh}
                >
                    REFRESH
                </button>
                <button
                    type="button"
                    style={css.btn(previewing ? "danger" : "primary")}
                    disabled={loading}
                    onClick={previewing ? stopPreview : startPreview}
                >
                    {previewing ? "STOP PREVIEW" : "TEST PREVIEW"}
                </button>
            </div>

            <video
                ref={videoRef}
                muted
                playsInline
                style={{
                    width: "100%",
                    aspectRatio: "16 / 9",
                    display: previewing ? "block" : "none",
                    objectFit: "cover",
                    background: "#000",
                    border: "1px solid rgba(120,80,30,0.25)",
                    borderRadius: 8,
                }}
            />

            {error && <div style={errorStyle}>{error}</div>}
            {!devices.length && !error && (
                <div style={hintStyle}>
                    Camera names may appear after macOS grants camera access.
                </div>
            )}
        </div>
    );
}

const hintStyle: React.CSSProperties = {
    marginTop: 8,
    color: "rgba(120,80,40,0.62)",
    fontSize: 12,
    lineHeight: 1.5,
};

const errorStyle: React.CSSProperties = {
    marginTop: 10,
    color: "rgba(220,80,60,0.85)",
    fontSize: 12,
    lineHeight: 1.5,
};

const checkboxStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    color: "rgba(210,180,140,0.78)",
    fontSize: 12,
    lineHeight: 1.5,
};
