import { useCallback, useEffect, useRef, useState } from "react";

export type WsStatus = "connecting" | "connected" | "disconnected";

export interface WsMessage {
    type: string;
    payload: Record<string, any>;
}

interface Options {
    token: string;
    onMessage: (msg: WsMessage) => void;
}

async function resolveWsUrl(): Promise<string> {
    const bridge = (window as any).jarvisBridge;
    const config = bridge?.getUserspaceConfig
        ? await bridge.getUserspaceConfig()
        : null;
    if (typeof config?.wsUrl === "string" && config.wsUrl.trim()) {
        return config.wsUrl.trim();
    }
    if (config?.host && config?.port) {
        return `ws://${config.host}:${config.port}/ws`;
    }
    return "";
}

export function useJarvisSocket({ token, onMessage }: Options) {
    const wsRef = useRef<WebSocket | null>(null);
    const [status, setStatus] = useState<WsStatus>("connecting");
    const onMessageRef = useRef(onMessage);
    onMessageRef.current = onMessage;

    useEffect(() => {
        let destroyed = false;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;

        const connect = async () => {
            if (destroyed) return;
            setStatus("connecting");

            let wsUrl = "";
            try {
                wsUrl = await resolveWsUrl();
            } catch (_) {}

            if (!wsUrl) {
                setStatus("disconnected");
                if (!destroyed) {
                    retryTimer = setTimeout(connect, 2000);
                }
                return;
            }

            const sep = wsUrl.includes("?") ? "&" : "?";
            const authUrl = `${wsUrl}${sep}token=${encodeURIComponent(token)}`;

            const ws = new WebSocket(authUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                console.log("[WS] connected");
                setStatus("connected");
            };

            ws.onclose = () => {
                setStatus("disconnected");
                wsRef.current = null;
                if (!destroyed) {
                    console.log("[WS] disconnected, retrying in 2s...");
                    retryTimer = setTimeout(connect, 2000);
                }
            };

            ws.onerror = () => {
                // onclose will fire after this, triggering reconnect
            };

            ws.onmessage = (event) => {
                try {
                    const { type, payload = {} } = JSON.parse(event.data);
                    onMessageRef.current({ type, payload });
                } catch (_) {}
            };
        };

        connect();
        return () => {
            destroyed = true;
            if (retryTimer) clearTimeout(retryTimer);
            wsRef.current?.close();
            wsRef.current = null;
        };
    }, [token]);

    const sendEvent = useCallback(
        (type: string, payload: Record<string, unknown>) => {
            const ws = wsRef.current;
            if (ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type, payload }));
            }
        },
        [],
    );

    return { status, sendEvent, wsRef };
}
