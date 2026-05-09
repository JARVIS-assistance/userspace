import { useCallback, useEffect, useRef, useState } from "react";
import SandParticles, { type ViewMode } from "./SandParticles";
import SettingsModal from "./SettingsModal";
import ActionConfirmModal from "./actions/ActionConfirmModal";
import ActionFeed from "./actions/ActionFeed";
import { cleanAssistantText, displayDoneText, displayPlanStep } from "./actions/text";
import {
    formatProgressText,
    isExternalActionType,
    nextActionText,
    waitingMessage,
} from "./actions/uiText";
import { useActionState } from "./actions/useActionState";
import { sharedAudioRef } from "./audio/sharedAudioRef";
import { useAssistantTts } from "./audio/useAssistantTts";
import { useMicCapture } from "./audio/useMicCapture";
import AssistantSubtitle from "./chrome/AssistantSubtitle";
import BottomBar from "./chrome/BottomBar";
import CornerActions from "./chrome/CornerActions";
import FloatingChatInput from "./chrome/FloatingChatInput";
import PlanToast from "./chrome/PlanToast";
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
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [settingsData, setSettingsData] = useState<SettingsData>(loadLocal);
    const [conversationActionBlock, setConversationActionBlock] = useState(false);
    const [actionIntentActive, setActionIntentActive] = useState(false);
    const [planToast, setPlanToast] = useState("");

    const assistantDeltaBufferRef = useRef("");
    const chatInputRef = useRef<HTMLInputElement>(null);
    const autoMinimizeActionRef = useRef<string | null>(null);
    const activePlanStepIdRef = useRef<string | null>(null);

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
    const actionBusy =
        actionState.state.pendingConfirms.length > 0
        || actionState.state.feed.some((entry) =>
            entry.status === "queued"
            || entry.status === "waiting_confirmation"
            || entry.status === "running"
            || entry.status === "retrying_compile"
        );
    const actionVisualActive = actionIntentActive || actionBusy;
    const inputLocked = conversationActionBlock;
    const stopVisible = convBusy || actionVisualActive;
    const micLocked = actionVisualActive;
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

    useEffect(() => {
        if (!actionVisualActive) return;

        setIsSpeaking(true);
        sharedAudioRef.active = false;
        sharedAudioRef.state = "speaking";
        sharedAudioRef.speakingPulse = Math.max(sharedAudioRef.speakingPulse, 0.95);

        const timer = window.setInterval(() => {
            sharedAudioRef.state = "speaking";
            sharedAudioRef.speakingPulse = Math.max(sharedAudioRef.speakingPulse, 0.85);
        }, 180);

        return () => window.clearInterval(timer);
    }, [actionVisualActive]);

    // ── Electron window state IPC ────────────────────────
    useEffect(() => {
        const bridge = (window as any).jarvisBridge;
        if (!bridge?.onMinimizeToSphere) return;
        const c1 = bridge.onMinimizeToSphere(() => setViewMode("minimizing"));
        const c2 = bridge.onRestoreFromSphere((text?: string) => {
            setViewMode("restoring");
            if (text) {
                setAssistantSubtitle(text);
                setIsSpeaking(true);
            }
        });
        const c3 = bridge.onSphereReady?.(() => setViewMode("sphere"));
        return () => {
            c1?.();
            c2?.();
            c3?.();
        };
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
            const stepId = String(payload.id || payload.step_id || "");
            const isTrackedStep =
                !stepId
                || stepId === activePlanStepIdRef.current
                || !activePlanStepIdRef.current;

            if (status === "queued" || status === "running" || status === "in_progress") {
                setConversationActionBlock(false);
                const description = displayPlanStep(payload);
                if (description) {
                    setPlanToast(description);
                    activePlanStepIdRef.current = stepId || activePlanStepIdRef.current;
                }
                return;
            }
            if (
                status === "completed"
                || status === "failed"
                || status === "timeout"
                || status === "rejected"
                || status === "invalid"
            ) {
                if (isTrackedStep) {
                    setConversationActionBlock(false);
                    setPlanToast("");
                    activePlanStepIdRef.current = null;
                    setActionIntentActive(false);
                }
                return;
            }
            return;
        }

        if (type === "conversation.thinking") {
            setConversationActionBlock(false);
            setPlanToast(waitingMessage());
            activePlanStepIdRef.current = `thinking:${String(payload.mode || "realtime")}`;
            setAssistantSubtitle(waitingMessage());
            setAssistantSubtitleDim(true);
            return;
        }

        if (type === "conversation.action_intent") {
            const shouldAct = payload.should_act === true;
            setConversationActionBlock(false);
            setActionIntentActive(shouldAct);
            if (shouldAct) {
                setIsSpeaking(true);
                setAssistantSubtitle("진행하겠습니다!");
                setAssistantSubtitleDim(true);
                sharedAudioRef.state = "speaking";
                sharedAudioRef.speakingPulse = 1;
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
                setAssistantSubtitleDim(true);
            }
            return;
        }

        if (type === "client_action.pending") {
            const action = payload.action || {};
            const actionId = String(payload.action_id || "");
            const actionType = String(action.type || "");
            if (
                actionId
                && isExternalActionType(actionType)
                && action.requires_confirm !== true
                && payload.requires_confirm !== true
            ) {
                void minimizeForExternalAction(actionId);
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
                setAssistantSubtitleDim(true);
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
            type === "client_action.completed"
            || type === "client_action.failed"
            || type === "client_action.timeout"
            || type === "client_action.rejected"
            || type === "conversation.action_result"
        ) {
            const status = String(
                payload.status
                || (type === "client_action.completed" ? "completed" : "")
                || (type === "client_action.rejected" ? "rejected" : "")
                || (type.endsWith("failed") ? "failed" : ""),
            );
            if (
                type === "client_action.failed"
                || type === "client_action.timeout"
                || status === "failed"
                || status === "timeout"
            ) {
                setActionIntentActive(false);
                handleExternalActionFailure(payload);
            }
            if (status === "completed" || status === "rejected" || status === "invalid") {
                setActionIntentActive(false);
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
            setConversationActionBlock(true);
            assistantDeltaBufferRef.current = "";
            setAssistantSubtitle("");
            setAssistantSubtitleDim(false);
            setActionIntentActive(false);
            setPlanToast("");
            activePlanStepIdRef.current = null;
        } else if (type === "stt.state") {
            setSttState(String(payload.status || payload.state || "idle"));
        } else if (type === "chat.delta" || type === "conversation.delta") {
            setConversationActionBlock(false);
            assistantDeltaBufferRef.current += String(payload.text || "");
            setAssistantSubtitle(cleanAssistantText(assistantDeltaBufferRef.current));
            setAssistantSubtitleDim(false);
            sharedAudioRef.speakingPulse = 1;
        } else if (type === "chat.done" || type === "conversation.done") {
            setConversationActionBlock(false);
            setActionIntentActive(false);
            setPlanToast("");
            activePlanStepIdRef.current = null;
            const doneText = displayDoneText(payload);
            const spokenText =
                cleanAssistantText(String(payload.text || "")) ||
                cleanAssistantText(assistantDeltaBufferRef.current) ||
                doneText;
            setAssistantSubtitle(doneText);
            setAssistantSubtitleDim(false);
            assistantDeltaBufferRef.current = "";
            assistantTts.speak(spokenText);
        } else if (type === "conversation.state") {
            const state = String(payload.state || "idle");
            if (state === "speaking") {
                setIsSpeaking(true);
                setConvBusy(true);
                sharedAudioRef.state = "speaking";
            } else if (state === "processing") {
                setConvBusy(true);
                setConversationActionBlock(false);
                setIsSpeaking(true);
                setAssistantSubtitle((current) => current || waitingMessage());
                setAssistantSubtitleDim(true);
            } else if (state === "idle") {
                setIsSpeaking(false);
                setConvBusy(false);
                setConversationActionBlock(false);
                sharedAudioRef.state = "idle";
            } else if (state === "listening") {
                setIsSpeaking(false);
                setConvBusy(false);
                setConversationActionBlock(false);
                sharedAudioRef.state = "listening";
            }
        } else if (type === "conversation.cancelled") {
            setIsSpeaking(false);
            setConvBusy(false);
            setConversationActionBlock(false);
            setActionIntentActive(false);
            setPlanToast("");
            activePlanStepIdRef.current = null;
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
        if (inputLocked) return;
        const text = chatInput.trim();
        if (!text) return;
        setUserSubtitle(text);
        setIsSpeaking(true);
        setConvBusy(true);
        if (convBusy || actionVisualActive) {
            sendEvent("conversation.cancel", {});
        }
        setConversationActionBlock(true);
        assistantDeltaBufferRef.current = "";
        setAssistantSubtitle("");
        setAssistantSubtitleDim(false);
        setActionIntentActive(false);
        setPlanToast("");
        activePlanStepIdRef.current = null;
        sendEvent("chat.request", { text });
        setChatInput("");
    }, [chatInput, inputLocked, sendEvent, convBusy, actionVisualActive]);

    const handleStop = useCallback(() => {
        if (!convBusy) return;
        sendEvent("conversation.cancel", {});
        setConversationActionBlock(false);
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
                if (micLocked) return;
                mic.toggle();
            }
            if (e.key === "Enter" && !chatOpen && !e.ctrlKey && !e.metaKey) {
                const tag = (e.target as HTMLElement)?.tagName;
                if (tag === "INPUT" || tag === "TEXTAREA") return;
                e.preventDefault();
                if (inputLocked) return;
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
    }, [mic, chatOpen, convBusy, handleStop, inputLocked, micLocked, viewMode]);

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

    // ── Manual Drag Logic for Sphere Mode ────────────────
    const dragInfo = useRef({
        isDragging: false,
        startX: 0,
        startY: 0,
        winX: 0,
        winY: 0,
        winW: 560,
        winH: 160,
        moved: false,
    });

    const handleDragStart = async (e: React.MouseEvent) => {
        if (viewMode !== "sphere") return;
        const bridge = (window as any).jarvisBridge;
        const bounds = await bridge.getWindowBounds();
        if (!bounds) return;

        dragInfo.current = {
            isDragging: true,
            startX: e.screenX,
            startY: e.screenY,
            winX: bounds.x,
            winY: bounds.y,
            winW: bounds.width,
            winH: bounds.height,
            moved: false,
        };
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!dragInfo.current.isDragging) return;

            const deltaX = e.screenX - dragInfo.current.startX;
            const deltaY = e.screenY - dragInfo.current.startY;

            if (
                !dragInfo.current.moved &&
                (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5)
            ) {
                dragInfo.current.moved = true;
            }

            if (dragInfo.current.moved) {
                const bridge = (window as any).jarvisBridge;
                bridge.moveWindow({
                    x: Math.round(dragInfo.current.winX + deltaX),
                    y: Math.round(dragInfo.current.winY + deltaY),
                    width: dragInfo.current.winW,
                    height: dragInfo.current.winH,
                });
            }
        };

        const handleMouseUp = () => {
            if (!dragInfo.current.isDragging) return;
            if (!dragInfo.current.moved) {
                handleSphereClick();
            }
            dragInfo.current.isDragging = false;
        };

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, [handleSphereClick]);

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
                particleDensity={settingsData.visual.particleDensity}
                onMinimizeDone={handleMinimizeDone}
                onRestoreDone={handleRestoreDone}
                onSphereClick={handleSphereClick}
            />

            {isNormal && (
                <TitleBar onMinimize={handleMinimize} onClose={handleClose} />
            )}

            {isSphere && (
                <SphereOverlay
                    subtitle=""
                    micActive={mic.active}
                    onSphereClick={handleSphereClick}
                    onMouseDown={handleDragStart}
                />
            )}

            {isNormal && (
                <AssistantSubtitle
                    text={assistantSubtitle}
                    dim={assistantSubtitleDim}
                />
            )}

            {isNormal && (
                <PlanToast text={planToast} chatOpen={chatOpen} />
            )}

            {isNormal && (
            <BottomBar
                    ref={chatInputRef}
                    userSubtitle={userSubtitle}
                    sttListening={sttState === "listening"}
                    micActive={mic.active}
                    chatOpen={chatOpen}
                    chatInput={chatInput}
                    stopVisible={stopVisible}
                    inputDisabled={inputLocked}
                    onChatInputChange={setChatInput}
                    onChatSubmit={handleChatSubmit}
                    onStop={handleStop}
                />
            )}

            {isSphere && chatOpen && (
                <FloatingChatInput
                    ref={chatInputRef}
                    value={chatInput}
                    stopVisible={stopVisible}
                    inputDisabled={inputLocked}
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
