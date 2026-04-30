import { useCallback, useEffect, useRef, useState } from "react";
import SandParticles, { type ViewMode } from "./SandParticles";
import SettingsModal from "./SettingsModal";
import ActionConfirmModal from "./actions/ActionConfirmModal";
import ActionFeed from "./actions/ActionFeed";
import { cleanAssistantText, displayDoneText, displayPlanStep } from "./actions/text";
import { useActionState } from "./actions/useActionState";
import { sharedAudioRef } from "./audio/sharedAudioRef";
import { useAssistantTts } from "./audio/useAssistantTts";
import { useMicCapture } from "./audio/useMicCapture";
import AssistantSubtitle from "./chrome/AssistantSubtitle";
import BottomBar from "./chrome/BottomBar";
import CornerActions from "./chrome/CornerActions";
import FloatingChatInput from "./chrome/FloatingChatInput";
import SphereOverlay from "./chrome/SphereOverlay";
import TitleBar from "./chrome/TitleBar";
import type { ActionsConfig } from "./settings/actionsConfig";
import { loadLocal, saveLocal } from "./settings/storage";
import type { SettingsData } from "./settings/types";
import { useJarvisSocket, type WsMessage } from "./ws/useJarvisSocket";

export { sharedAudioRef } from "./audio/sharedAudioRef";
export type { AudioState } from "./audio/sharedAudioRef";

interface AppProps {
    token: string;
    onLogout: () => void;
}

export default function App({ token, onLogout }: AppProps) {
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [userSubtitle, setUserSubtitle] = useState("");
    const [assistantSubtitle, setAssistantSubtitle] = useState("");
    // step/thinking 등 "진행 중" 표시일 때 살짝 옅게 보여주기 위한 플래그
    const [assistantSubtitleDim, setAssistantSubtitleDim] = useState(false);
    const [sttState, setSttState] = useState<string>("idle");
    const [viewMode, setViewMode] = useState<ViewMode>("waveform");
    const [chatInput, setChatInput] = useState("");
    const [chatOpen, setChatOpen] = useState(false);
    const [chatAnchor, setChatAnchor] = useState({ x: 0, y: 0 });
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [settingsData, setSettingsData] = useState<SettingsData>(loadLocal);

    const assistantDeltaBufferRef = useRef("");
    const chatInputRef = useRef<HTMLInputElement>(null);
    const autoMinimizeActionRef = useRef<string | null>(null);
    const pointerRef = useRef({ x: 0, y: 0 });

    // ── Actions config (settings 탭) ──
    const [actionsConfig, setActionsConfig] = useState<ActionsConfig | null>(null);
    const [actionsSaving, setActionsSaving] = useState(false);
    const [actionsError, setActionsError] = useState<string | null>(null);

    // ── Conversation processing flag — STOP 버튼 가시성 ──
    // backend의 conversation.state(processing/speaking)에 동기화.
    const [convBusy, setConvBusy] = useState(false);

    // ── Action infra (forward-ref pattern: sendEvent ↔ useActionState 순환 끊기) ──
    const sendEventRef = useRef<
        ((type: string, payload: Record<string, unknown>) => void) | null
    >(null);
    const stableSendEvent = useCallback(
        (type: string, payload: Record<string, unknown>) => {
            sendEventRef.current?.(type, payload);
        },
        [],
    );
    const actionState = useActionState({ sendEvent: stableSendEvent });
    const assistantTts = useAssistantTts(settingsData.tts);

    // ── TTS events ───────────────────────────────────────
    useEffect(() => {
        const onTtsStart = () => {
            setIsSpeaking(true);
            sharedAudioRef.active = true;
            sharedAudioRef.state = "speaking";
        };
        const onTtsEnd = () => {
            setIsSpeaking(false);
            sharedAudioRef.active = false;
            sharedAudioRef.state = "idle";
        };
        window.addEventListener("jarvis-tts-start", onTtsStart);
        window.addEventListener("jarvis-tts-end", onTtsEnd);
        return () => {
            window.removeEventListener("jarvis-tts-start", onTtsStart);
            window.removeEventListener("jarvis-tts-end", onTtsEnd);
        };
    }, []);

    // ── Electron window state IPC ────────────────────────
    useEffect(() => {
        const bridge = (window as any).jarvisBridge;
        if (!bridge?.onMinimizeToSphere) return;
        const c1 = bridge.onMinimizeToSphere(() => setViewMode("minimizing"));
        const c2 = bridge.onRestoreFromSphere(() => setViewMode("restoring"));
        const c3 = bridge.onSphereReady?.(() => setViewMode("sphere"));
        return () => {
            c1?.();
            c2?.();
            c3?.();
        };
    }, []);

    useEffect(() => {
        pointerRef.current = {
            x: Math.round(window.innerWidth / 2),
            y: Math.round(window.innerHeight / 2),
        };
        setChatAnchor(pointerRef.current);

        const onPointerMove = (event: PointerEvent) => {
            pointerRef.current = {
                x: event.clientX,
                y: event.clientY,
            };
        };
        window.addEventListener("pointermove", onPointerMove);
        return () => window.removeEventListener("pointermove", onPointerMove);
    }, []);

    const minimizeForExternalAction = useCallback(async (actionId: string) => {
        if (!actionId || autoMinimizeActionRef.current === actionId) return;
        autoMinimizeActionRef.current = actionId;
        const bridge = (window as any).jarvisBridge;
        if (viewMode !== "waveform" && viewMode !== "restoring") return;
        if (bridge?.minimizeNow) {
            await bridge.minimizeNow();
            setViewMode("sphere");
            return;
        }
        bridge?.minimizeWindow?.();
    }, [viewMode]);

    const restoreAfterExternalActionFailure = useCallback(async () => {
        const bridge = (window as any).jarvisBridge;
        if (viewMode === "sphere" || viewMode === "minimizing") {
            bridge?.restoreWindow?.();
            setViewMode("restoring");
        }
    }, [viewMode]);

    const handleExternalActionFailure = useCallback((payload: Record<string, any>) => {
        const action = payload.action || {};
        const actionType = String(payload.type || action.type || "");
        if (!isExternalActionType(actionType)) return;

        void restoreAfterExternalActionFailure();
        autoMinimizeActionRef.current = null;
        const error = String(payload.error || "Action failed");
        const command = String(action.command || payload.command || action.target || actionType);
        setIsSpeaking(true);
        setAssistantSubtitle(nextActionText(actionType, command, error));
    }, [restoreAfterExternalActionFailure]);

    const applyActionUiSideEffects = useCallback((msg: WsMessage) => {
        const { type, payload } = msg;

        if (type === "conversation.plan_step") {
            const status = String(payload.status || "");
            if (status === "completed") {
                setAssistantSubtitle("");
                setAssistantSubtitleDim(false);
                return;
            }
            const description = displayPlanStep(payload);
            if (description) {
                setIsSpeaking(true);
                setAssistantSubtitle(description);
                setAssistantSubtitleDim(true);
            }
            return;
        }

        if (type === "conversation.action_dispatch") {
            const action = payload.action || {};
            const actionId = String(payload.action_id || "");
            const actionType = String(action.type || "");
            const description = String(action.description || actionType || "").trim();
            if (description && !action.requires_confirm) {
                setIsSpeaking(true);
                setAssistantSubtitle(formatProgressText(description));
            }
            return;
        }

        if (type === "client_action.started") {
            const actionId = String(payload.action_id || "");
            const actionType = String(payload.type || "");
            const description = String(payload.description || actionType || "").trim();
            if (description && payload.requires_confirm !== true) {
                setIsSpeaking(true);
                setAssistantSubtitle(formatProgressText(description));
            }
            if (
                actionId
                && isExternalActionType(actionType)
                && payload.requires_confirm !== true
            ) {
                void minimizeForExternalAction(actionId);
            }
            return;
        }

        if (
            type === "client_action.failed"
            || type === "client_action.timeout"
            || type === "conversation.action_result"
        ) {
            const status = String(payload.status || (type.endsWith("failed") ? "failed" : ""));
            if (
                type === "client_action.failed"
                || type === "client_action.timeout"
                || status === "failed"
                || status === "timeout"
            ) {
                handleExternalActionFailure(payload);
            }
        }
    }, [handleExternalActionFailure, minimizeForExternalAction]);

    // ── WebSocket message routing ────────────────────────
    const handleMessage = useCallback((msg: WsMessage) => {
        applyActionUiSideEffects(msg);

        // 설정 응답
        if (msg.type === "config.actions.value") {
            setActionsConfig(msg.payload as ActionsConfig);
            setActionsSaving(false);
            setActionsError(null);
            return;
        }
        if (msg.type === "config.actions.error") {
            setActionsSaving(false);
            setActionsError(String(msg.payload?.message || "save failed"));
            return;
        }

        // 액션 라이프사이클 메시지(client_action.*)는 actionState가 흡수
        if (actionState.onWsMessage(msg)) return;

        const { type, payload } = msg;
        if (type === "stt.partial") {
            const text = String(payload.text || "");
            if (text) setUserSubtitle(text);
        } else if (type === "stt.final") {
            const text = String(payload.text || "");
            if (text) setUserSubtitle(text);
            setIsSpeaking(true);
            setConvBusy(true);
            assistantDeltaBufferRef.current = "";
            setAssistantSubtitle("");
            setAssistantSubtitleDim(false);
        } else if (type === "stt.state") {
            setSttState(String(payload.status || payload.state || "idle"));
        } else if (type === "chat.delta" || type === "conversation.delta") {
            assistantDeltaBufferRef.current += String(payload.text || "");
            setAssistantSubtitle(cleanAssistantText(assistantDeltaBufferRef.current));
            setAssistantSubtitleDim(false);
            sharedAudioRef.speakingPulse = 1;
        } else if (type === "chat.done" || type === "conversation.done") {
            const doneText = displayDoneText(payload);
            const spokenText =
                cleanAssistantText(String(payload.text || "")) ||
                cleanAssistantText(assistantDeltaBufferRef.current) ||
                doneText;
            setAssistantSubtitle(doneText);
            setAssistantSubtitleDim(false);
            assistantDeltaBufferRef.current = "";
            assistantTts.speak(spokenText);
        } else if (type === "conversation.thinking") {
            setAssistantSubtitle(waitingMessage());
            setAssistantSubtitleDim(true);
        } else if (type === "conversation.plan_step") {
            const status = String(payload.status || "");
            if (status === "completed") {
                setAssistantSubtitle("");
                setAssistantSubtitleDim(false);
                return;
            }
            const description = displayPlanStep(payload);
            if (description) {
                const stillRunning = !status || status === "in_progress";
                setIsSpeaking(true);
                setAssistantSubtitle(description);
                setAssistantSubtitleDim(stillRunning);
            }
        } else if (type === "conversation.state") {
            const state = String(payload.state || "idle");
            if (state === "speaking") {
                setIsSpeaking(true);
                setConvBusy(true);
                sharedAudioRef.state = "speaking";
            } else if (state === "processing") {
                setConvBusy(true);
                setIsSpeaking(true);
                setAssistantSubtitle((current) => current || waitingMessage());
                setAssistantSubtitleDim(true);
            } else if (state === "idle") {
                setIsSpeaking(false);
                setConvBusy(false);
                sharedAudioRef.state = "idle";
            } else if (state === "listening") {
                setIsSpeaking(false);
                setConvBusy(false);
                sharedAudioRef.state = "listening";
            }
        } else if (type === "conversation.cancelled") {
            setIsSpeaking(false);
            setConvBusy(false);
            setAssistantSubtitleDim(false);
            assistantDeltaBufferRef.current = "";
            sharedAudioRef.state = "idle";
            assistantTts.cancel();
        }
    }, [actionState, applyActionUiSideEffects, assistantTts]);

    const { sendEvent, wsRef } = useJarvisSocket({
        token,
        onMessage: handleMessage,
    });

    // sendEvent를 ref로 노출 — useActionState/respondConfirm이 이를 통해 송신
    useEffect(() => {
        sendEventRef.current = sendEvent;
    }, [sendEvent]);

    const mic = useMicCapture({ sendEvent, wsRef });

    // Mic state side-effect: stt state
    useEffect(() => {
        if (mic.active) setSttState("listening");
        else setSttState("idle");
    }, [mic.active]);

    const handleChatSubmit = useCallback(() => {
        const text = chatInput.trim();
        if (!text) return;
        setUserSubtitle(text);
        setIsSpeaking(true);
        setConvBusy(true);
        assistantDeltaBufferRef.current = "";
        setAssistantSubtitle("");
        setAssistantSubtitleDim(false);
        sendEvent("chat.request", { text });
        setChatInput("");
    }, [chatInput, sendEvent]);

    const handleStop = useCallback(() => {
        if (!convBusy) return;
        sendEvent("conversation.cancel", {});
        // 서버 응답 도착 전 즉시 UI 반응
        setConvBusy(false);
        setIsSpeaking(false);
        setAssistantSubtitleDim(false);
        assistantTts.cancel();
    }, [assistantTts, convBusy, sendEvent]);

    // ── Keyboard shortcuts ──────────────────────────────
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "p" && e.ctrlKey) {
                e.preventDefault();
                mic.toggle();
            }
            if (e.key === "Enter" && !chatOpen && !e.ctrlKey && !e.metaKey) {
                const tag = (e.target as HTMLElement)?.tagName;
                if (tag === "INPUT" || tag === "TEXTAREA") return;
                e.preventDefault();
                if (viewMode === "sphere" || viewMode === "minimizing") {
                    setChatAnchor(pointerRef.current);
                }
                setChatOpen(true);
                setTimeout(() => chatInputRef.current?.focus(), 50);
            }
            if (e.key === "Escape") {
                // 응답/추론 중엔 STOP 우선
                if (convBusy) {
                    e.preventDefault();
                    handleStop();
                    return;
                }
                if (chatOpen) {
                    setChatOpen(false);
                    setChatInput("");
                }
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [mic, chatOpen, convBusy, handleStop, viewMode]);

    // ── Window controls ──────────────────────────────────
    const handleMinimizeDone = useCallback(() => {
        (window as any).jarvisBridge?.minimizeAnimationDone?.();
    }, []);
    const handleRestoreDone = useCallback(() => setViewMode("waveform"), []);
    const handleMinimize = () =>
        (window as any).jarvisBridge?.minimizeWindow?.();
    const handleClose = () => (window as any).jarvisBridge?.closeWindow?.();
    const handleSphereClick = () =>
        (window as any).jarvisBridge?.restoreWindow?.();

    const activeSubtitle = isSpeaking ? assistantSubtitle : userSubtitle;
    const isNormal = viewMode === "waveform" || viewMode === "restoring";
    const isSphere = viewMode === "sphere";
    const isMinimizing = viewMode === "minimizing";
    const bgColor = isSphere || isMinimizing ? "transparent" : "#000";

    return (
        <div
            style={{
                position: "relative",
                width: "100%",
                height: "100vh",
                background: bgColor,
                overflow: isSphere ? "visible" : "hidden",
            }}
        >
            <SandParticles
                viewMode={viewMode}
                onMinimizeDone={handleMinimizeDone}
                onRestoreDone={handleRestoreDone}
                onSphereClick={handleSphereClick}
            />

            {isNormal && (
                <TitleBar onMinimize={handleMinimize} onClose={handleClose} />
            )}

            {isSphere && (
                <SphereOverlay
                    subtitle={activeSubtitle}
                    micActive={mic.active}
                    onSphereClick={handleSphereClick}
                />
            )}

            {isNormal && (
                <AssistantSubtitle
                    text={assistantSubtitle}
                    dim={assistantSubtitleDim}
                />
            )}

            {isNormal && (
                <BottomBar
                    ref={chatInputRef}
                    userSubtitle={userSubtitle}
                    sttListening={sttState === "listening"}
                    micActive={mic.active}
                    chatOpen={chatOpen}
                    chatInput={chatInput}
                    stopVisible={convBusy}
                    onChatInputChange={setChatInput}
                    onChatSubmit={handleChatSubmit}
                    onStop={handleStop}
                />
            )}

            {isSphere && chatOpen && (
                <FloatingChatInput
                    ref={chatInputRef}
                    x={chatAnchor.x}
                    y={chatAnchor.y}
                    value={chatInput}
                    stopVisible={convBusy}
                    onChange={setChatInput}
                    onSubmit={handleChatSubmit}
                    onStop={handleStop}
                />
            )}

            {isNormal && (
                <CornerActions
                    onLogout={onLogout}
                    onOpenSettings={() => setSettingsOpen(true)}
                />
            )}

            <SettingsModal
                open={settingsOpen}
                token={token}
                onClose={() => setSettingsOpen(false)}
                actionsConfig={actionsConfig}
                actionsSaving={actionsSaving}
                actionsError={actionsError}
                onRequestActionsConfig={() => {
                    setActionsError(null);
                    sendEvent("config.actions.get", {});
                }}
                onSaveActionsConfig={(patch) => {
                    setActionsSaving(true);
                    setActionsError(null);
                    sendEvent("config.actions.set", patch as Record<string, unknown>);
                }}
                onSettingsChange={(next) => {
                    setSettingsData(next);
                    saveLocal(next);
                }}
            />

            {/* ── Action UI: 토스트 피드 + 컨펌 모달 ── */}
            {isNormal && (
                <ActionFeed
                    feed={actionState.state.feed}
                    onDismiss={actionState.dismissFeedEntry}
                />
            )}
            <ActionConfirmModal
                pending={actionState.state.pendingConfirms[0] ?? null}
                onRespond={async (actionId, accepted, reason) => {
                    const pending = actionState.state.pendingConfirms.find(
                        (p) => p.action_id === actionId,
                    );
                    if (
                        accepted
                        && pending
                        && isExternalActionType(pending.action.type)
                    ) {
                        setIsSpeaking(true);
                        setAssistantSubtitle(
                            formatProgressText(
                                pending.action.description || pending.action.type,
                            ),
                        );
                        await minimizeForExternalAction(actionId);
                    }
                    actionState.respondConfirm(actionId, accepted, reason);
                }}
            />
        </div>
    );
}

const EXTERNAL_ACTION_TYPES = new Set([
    "terminal",
    "app_control",
    "file_write",
    "file_read",
    "open_url",
    "browser_control",
    "web_search",
    "mouse_click",
    "mouse_drag",
    "keyboard_type",
    "hotkey",
    "screenshot",
]);

function isExternalActionType(type: string): boolean {
    return EXTERNAL_ACTION_TYPES.has(type);
}

function formatProgressText(value: string): string {
    const text = value
        .replace(/\s*하는중\.{0,3}\s*$/u, "")
        .replace(/\s*진행중\.{0,3}\s*$/u, "")
        .trim();
    return text ? `${text} 하는중...` : "";
}

function nextActionText(type: string, command: string, error: string): string {
    if (/client action result timed out|result timed out|timed out/i.test(error)) {
        if (type === "app_control") {
            return `${command} 실행 결과가 제시간에 확인되지 않았습니다. 앱이 설치되어 있지 않다면 Chrome 또는 Safari로 다시 시도하세요.`;
        }
        return `외부 작업 결과가 제시간에 확인되지 않았습니다. 같은 작업을 다시 시도하거나 다른 방법을 선택하세요.`;
    }
    if (type === "app_control" && /not found|찾을 수|없/i.test(error)) {
        return `${command} 실행에 실패했습니다. 설치되어 있지 않은 앱이면 Chrome 또는 Safari로 다시 시도하세요.`;
    }
    if (type === "browser_control" || type === "open_url" || type === "web_search") {
        if (/JavaScript from Apple Events|Apple Events/i.test(error)) {
            return "Chrome 설정에서 View > Developer > Allow JavaScript from Apple Events를 켠 뒤 다시 시도하세요.";
        }
        if (/no active browser tab/i.test(error)) {
            return "활성 브라우저 탭을 찾지 못했습니다. 검색 결과 탭을 앞으로 가져온 뒤 다시 시도하세요.";
        }
        return `브라우저 작업에 실패했습니다. 기본 브라우저 또는 다른 브라우저로 다시 시도하세요.`;
    }
    return `외부 작업에 실패했습니다. ${error}`;
}

const WAITING_MESSAGES = [
    "잠시만요!",
    "바로 확인할게요.",
    "처리하고 있어요.",
    "준비 중이에요.",
    "곧 이어서 진행할게요.",
];

function waitingMessage(): string {
    return WAITING_MESSAGES[Math.floor(Math.random() * WAITING_MESSAGES.length)];
}
