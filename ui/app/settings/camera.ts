import type { CameraConfig } from "./types";

const VIRTUAL_CAMERA_RE = /\b(obs|virtual|snap camera|mmhmm|camo|manycam)\b/i;

export interface CameraDevice {
    deviceId: string;
    label: string;
}

export function isVirtualCamera(device: CameraDevice): boolean {
    return VIRTUAL_CAMERA_RE.test(device.label);
}

export async function listCameraDevices(): Promise<CameraDevice[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
        .filter((device) => device.kind === "videoinput")
        .map((device, index) => ({
            deviceId: device.deviceId,
            label: device.label || `Camera ${index + 1}`,
        }));
}

export function chooseCameraDevice(
    devices: CameraDevice[],
    config: CameraConfig,
): CameraDevice | null {
    if (!devices.length) return null;

    if (config.deviceId) {
        const exact = devices.find((device) => device.deviceId === config.deviceId);
        if (exact) return exact;
    }

    if (config.label) {
        const matchingLabel = devices.find((device) => device.label === config.label);
        if (matchingLabel) return matchingLabel;
    }

    if (config.preferPhysical) {
        const physical = devices.find((device) => !isVirtualCamera(device));
        if (physical) return physical;
    }

    return devices[0];
}

export function getCameraConstraints(
    devices: CameraDevice[],
    config: CameraConfig,
): MediaStreamConstraints {
    const selected = chooseCameraDevice(devices, config);
    if (!selected) {
        return { video: true, audio: false };
    }
    return {
        video: { deviceId: { exact: selected.deviceId } },
        audio: false,
    };
}
