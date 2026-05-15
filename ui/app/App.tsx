import { useCallback, useEffect, useRef, useState } from "react";
import SandParticles, { type ViewMode } from "./SandParticles";
import SettingsModal from "./SettingsModal";
import ActionConfirmModal from "./actions/ActionConfirmModal";
import ActionFeed from "./actions/ActionFeed";
import TerminalPanel from "./actions/TerminalPanel";
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
import DeepResponsePanel from "./chrome/DeepResponsePanel";
import FloatingChatInput from "./chrome/FloatingChatInput";
import MinimizedResponseBubble from "./chrome/MinimizedResponseBubble";
import PlanToast from "./chrome/PlanToast";
import SphereOverlay from "./chrome/SphereOverlay";
import TitleBar from "./chrome/TitleBar";
import TruncationNotice from "./chrome/TruncationNotice";
import type { ActionsConfig } from "./settings/actionsConfig";
import { loadLocal, saveLocal } from "./settings/storage";
import type { SettingsData } from "./settings/types";
import TodoPanel from "./todos/TodoPanel";
import { useWakeWord } from "./wakeword/useWakeWord";
import { useJarvisSocket, type WsMessage } from "./ws/useJarvisSocket";

export { sharedAudioRef } from "./audio/sharedAudioRef";
export type { AudioState } from "./audio/sharedAudioRef";

interface AppProps {
    token: string;
    onLogout: () => void;
}

function isTerminalActionType(type: string): boolean {
    return type === "terminal" || type === "terminal.run";
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
    const [floatingInputPosition, setFloatingInputPosition] = useState<{
        x: number;
        y: number;
    } | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [todosOpen, setTodosOpen] = useState(false);
    const [settingsData, setSettingsData] = useState<SettingsData>(loadLocal);
    const [conversationActionBlock, setConversationActionBlock] = useState(false);
    const [actionIntentActive, setActionIntentActive] = useState(false);
    const [planToast, setPlanToast] = useState("");
    const [terminalPanelActionId, setTerminalPanelActionId] = useState<string | null>(null);
    const [deepResponsePanel, setDeepResponsePanel] = useState({
        open: false,
        active: false,
        text: "",
    });
    const [truncationNoticeVisible, setTruncationNoticeVisible] = useState(false);
    const [wakewordTriggering, setWakewordTriggering] = useState(false);

    const assistantDeltaBufferRef = useRef("");
    const assistantRenderTextRef = useRef("");
    const assistantRenderQueueRef = useRef("");
    const assistantRenderTimerRef = useRef<number | null>(null);
    const assistantFinalTextRef = useRef<string | null>(null);
    const deepTurnActiveRef = useRef(false);
    const deepPanelDismissedRef = useRef(false);
    const deepResponseTextRef = useRef("");
    const chatInputRef = useRef<HTMLInputElement>(null);
    const lastPointerRef = useRef({ x: 420, y: 80 });
    const planToastTimerRef = useRef<number | null>(null);
    const waitingMessageTimerRef = useRef<number | null>(null);
    const autoMinimizeActionRef = useRef<string | null>(null);
    const activePlanStepIdRef = useRef<string | null>(null);
    const greetingRequestedRef = useRef(false);

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

    const clearPlanToastTimer = useCallback(() => {
        if (planToastTimerRef.current !== null) {
            window.clearTimeout(planToastTimerRef.current);
            planToastTimerRef.current = null;
        }
    }, []);

    const clearWaitingMessageTimer = useCallback(() => {
        if (waitingMessageTimerRef.current !== null) {
            window.clearInterval(waitingMessageTimerRef.current);
            waitingMessageTimerRef.current = null;
        }
    }, []);

    const startWaitingMessages = useCallback(() => {
        if (waitingMessageTimerRef.current !== null) return;
        const showNext = () => {
            const message = waitingMessage();
            setPlanToast(message);
            setAssistantSubtitle(message);
            setAssistantSubtitleDim(true);
        };
        showNext();
        waitingMessageTimerRef.current = window.setInterval(showNext, 2400);
    }, []);

    const clearPlanToastAfterDelay = useCallback(() => {
        clearPlanToastTimer();
        planToastTimerRef.current = window.setTimeout(() => {
            setPlanToast("");
            planToastTimerRef.current = null;
        }, 3000);
    }, [clearPlanToastTimer]);

    useEffect(() => {
        const enabled = settingsData.camera.enabled === true;
        void (window as any).jarvisBridge?.setVisionEnabled?.(enabled);
        if (!enabled) {
            void (window as any).jarvisBridge?.closeVisionWindow?.();
        }
    }, [settingsData.camera.enabled]);

    const startAssistantRenderPump = useCallback(() => {
        if (assistantRenderTimerRef.current !== null) return;

        const tick = () => {
            const queued = assistantRenderQueueRef.current;
            if (queued) {
                const chars = Array.from(queued);
                const nextChar = chars.shift() || "";
                assistantRenderQueueRef.current = chars.join("");
                assistantRenderTextRef.current += nextChar;
                const renderedText = cleanAssistantText(assistantRenderTextRef.current);
                setAssistantSubtitle(renderedText);
                assistantRenderTimerRef.current = window.setTimeout(tick, 28);
                return;
            }

            const finalText = assistantFinalTextRef.current;
            if (finalText !== null) {
                assistantFinalTextRef.current = null;
                assistantRenderTextRef.current = finalText;
                setAssistantSubtitle(cleanAssistantText(finalText));
            }
            assistantRenderTimerRef.current = null;
        };

        assistantRenderTimerRef.current = window.setTimeout(tick, 0);
    }, []);

    const enqueueAssistantRenderText = useCallback((text: string) => {
        if (!text) return;
        assistantRenderQueueRef.current += text;
        startAssistantRenderPump();
    }, [startAssistantRenderPump]);

    const finishAssistantRenderText = useCallback((text: string) => {
        assistantFinalTextRef.current = text;
        startAssistantRenderPump();
    }, [startAssistantRenderPump]);

    const resetAssistantRenderText = useCallback(() => {
        if (assistantRenderTimerRef.current !== null) {
            window.clearTimeout(assistantRenderTimerRef.current);
            assistantRenderTimerRef.current = null;
        }
        assistantRenderTextRef.current = "";
        assistantRenderQueueRef.current = "";
        assistantFinalTextRef.current = null;
        setAssistantSubtitle("");
    }, []);

    const resetDeepResponsePanel = useCallback(() => {
        deepTurnActiveRef.current = false;
        deepPanelDismissedRef.current = false;
        deepResponseTextRef.current = "";
        setDeepResponsePanel({ open: false, active: false, text: "" });
    }, []);

    const beginDeepResponsePanel = useCallback(() => {
        deepTurnActiveRef.current = true;
        deepPanelDismissedRef.current = false;
        deepResponseTextRef.current = "";
        setDeepResponsePanel({ open: false, active: true, text: "" });
    }, []);

    const appendDeepResponseText = useCallback((text: string) => {
        if (!deepTurnActiveRef.current || !text) return;
        deepResponseTextRef.current += text;
        const renderedText = cleanAssistantText(deepResponseTextRef.current);
        const shouldOpen =
            !deepPanelDismissedRef.current
            && renderedText.length > 0;
        setDeepResponsePanel((prev) => ({
            open: prev.open || shouldOpen,
            active: true,
            text: renderedText,
        }));
    }, []);

    const finishDeepResponseText = useCallback((text: string) => {
        if (!deepTurnActiveRef.current) return;
        const renderedText =
            cleanAssistantText(text)
            || cleanAssistantText(deepResponseTextRef.current);
        const shouldOpen =
            !deepPanelDismissedRef.current
            && renderedText.length > 0;
        setDeepResponsePanel((prev) => ({
            open: prev.open || shouldOpen,
            active: false,
            text: renderedText,
        }));
        deepTurnActiveRef.current = false;
    }, []);

    const enterListeningMode = useCallback(() => {
        assistantTts.cancel();
        setIsSpeaking(false);
        setConvBusy(false);
        setConversationActionBlock(false);
        setAssistantSubtitleDim(false);
        assistantDeltaBufferRef.current = "";
        setTruncationNoticeVisible(false);
        resetDeepResponsePanel();
        resetAssistantRenderText();
        sharedAudioRef.active = true;
        sharedAudioRef.state = "listening";
    }, [assistantTts.cancel, resetAssistantRenderText, resetDeepResponsePanel]);

    useEffect(() => {
        return () => {
            if (assistantRenderTimerRef.current !== null) {
                window.clearTimeout(assistantRenderTimerRef.current);
                assistantRenderTimerRef.current = null;
            }
            clearPlanToastTimer();
            clearWaitingMessageTimer();
        };
    }, [clearPlanToastTimer, clearWaitingMessageTimer]);

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

    const showTerminalAction = useCallback((actionId: string) => {
        if (actionId) setTerminalPanelActionId(actionId);
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
                clearPlanToastTimer();
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
                    activePlanStepIdRef.current = null;
                    setActionIntentActive(false);
                    if (status === "completed") {
                        const description = displayPlanStep(payload);
                        if (description) {
                            setPlanToast(description);
                        }
                        clearPlanToastAfterDelay();
                    } else {
                        clearPlanToastTimer();
                        setPlanToast("");
                    }
                }
                return;
            }
            return;
        }

        if (type === "conversation.thinking") {
            setConversationActionBlock(false);
            clearPlanToastTimer();
            activePlanStepIdRef.current = `thinking:${String(payload.mode || "realtime")}`;
            startWaitingMessages();
            return;
        }

        if (type === "conversation.classification") {
            const category = String(payload.category || "").toLowerCase();
            const mode = String(payload.mode || "").toLowerCase();
            if (category === "deep" || mode === "deep") {
                beginDeepResponsePanel();
                clearWaitingMessageTimer();
                clearPlanToastTimer();
                setConversationActionBlock(false);
                setPlanToast("깊이 생각해보고 있어요.");
                setAssistantSubtitle("깊이 생각해보고 있어요.");
                setAssistantSubtitleDim(true);
            }
            return;
        }

        if (type === "conversation.action_intent") {
            const shouldAct = payload.should_act === true;
            setConversationActionBlock(false);
            setActionIntentActive(shouldAct);
            return;
        }

        if (type === "conversation.action_dispatch") {
            const action = payload.action || {};
            const actionId = String(payload.action_id || "");
            const actionType = String(action.type || "");
            if (isTerminalActionType(actionType)) {
                showTerminalAction(actionId);
            }
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
            if (isTerminalActionType(actionType)) {
                showTerminalAction(actionId);
                return;
            }
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
            if (isTerminalActionType(actionType)) {
                showTerminalAction(actionId);
            }
            if (description && payload.requires_confirm !== true) {
                setIsSpeaking(true);
                setAssistantSubtitle(formatProgressText(description));
                setAssistantSubtitleDim(true);
            }
            if (
                actionId
                && !isTerminalActionType(actionType)
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
    }, [
        beginDeepResponsePanel,
        clearPlanToastAfterDelay,
        clearPlanToastTimer,
        clearWaitingMessageTimer,
        handleExternalActionFailure,
        minimizeForExternalAction,
        showTerminalAction,
        startWaitingMessages,
    ]);

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
            if (text) {
                enterListeningMode();
                setUserSubtitle(text);
            }
        } else if (type === "stt.final") {
            const text = String(payload.text || "");
            if (text) setUserSubtitle(text);
            assistantTts.beginTurn();
            setIsSpeaking(true);
            setConvBusy(true);
            setConversationActionBlock(true);
            assistantDeltaBufferRef.current = "";
            setTruncationNoticeVisible(false);
            resetDeepResponsePanel();
            resetAssistantRenderText();
            setAssistantSubtitleDim(false);
            setActionIntentActive(false);
            clearPlanToastTimer();
            setPlanToast("");
            activePlanStepIdRef.current = null;
        } else if (type === "stt.state") {
            setSttState(String(payload.status || payload.state || "idle"));
        } else if (type === "chat.delta" || type === "conversation.delta") {
            setConversationActionBlock(false);
            clearWaitingMessageTimer();
            setPlanToast("");
            const deltaText = String(payload.text || "");
            assistantDeltaBufferRef.current += deltaText;
            assistantTts.pushChunk(deltaText);
            if (deepTurnActiveRef.current) {
                appendDeepResponseText(deltaText);
                setAssistantSubtitle("");
                setAssistantSubtitleDim(false);
            } else {
                enqueueAssistantRenderText(deltaText);
                setAssistantSubtitleDim(false);
            }
            sharedAudioRef.speakingPulse = 1;
        } else if (type === "conversation.truncated") {
            setConversationActionBlock(false);
            setTruncationNoticeVisible(true);
        } else if (type === "chat.done" || type === "conversation.done") {
            clearWaitingMessageTimer();
            setConversationActionBlock(false);
            setActionIntentActive(false);
            if (planToastTimerRef.current === null) {
                setPlanToast("");
            }
            activePlanStepIdRef.current = null;
            const doneText = displayDoneText(payload);
            const spokenText =
                cleanAssistantText(String(payload.text || "")) ||
                cleanAssistantText(assistantDeltaBufferRef.current) ||
                doneText;
            const wasDeepTurn = deepTurnActiveRef.current;
            finishDeepResponseText(spokenText);
            if (payload.truncated === true) {
                setTruncationNoticeVisible(true);
            }
            if (wasDeepTurn) {
                resetAssistantRenderText();
            } else {
                finishAssistantRenderText(doneText);
            }
            setAssistantSubtitleDim(false);
            assistantDeltaBufferRef.current = "";
            assistantTts.finishTurn(spokenText);
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
                startWaitingMessages();
            } else if (state === "idle") {
                clearWaitingMessageTimer();
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
            clearWaitingMessageTimer();
            setIsSpeaking(false);
            setConvBusy(false);
            setConversationActionBlock(false);
            setActionIntentActive(false);
            clearPlanToastTimer();
            setPlanToast("");
            activePlanStepIdRef.current = null;
            setAssistantSubtitleDim(false);
            assistantDeltaBufferRef.current = "";
            setTruncationNoticeVisible(false);
            resetDeepResponsePanel();
            resetAssistantRenderText();
            sharedAudioRef.state = "idle";
            assistantTts.cancel();
        } else if (type === "conversation.barge_in") {
            enterListeningMode();
        }
    }, [
        actionState,
        appendDeepResponseText,
        applyActionUiSideEffects,
        assistantTts,
        beginDeepResponsePanel,
        clearPlanToastTimer,
        clearWaitingMessageTimer,
        enterListeningMode,
        enqueueAssistantRenderText,
        finishDeepResponseText,
        finishAssistantRenderText,
        resetDeepResponsePanel,
        resetAssistantRenderText,
        startWaitingMessages,
        setTruncationNoticeVisible,
    ]);

    const { status: wsStatus, sendEvent, wsRef } = useJarvisSocket({
        token,
        onMessage: handleMessage,
        onUnauthorized: onLogout,
    });

    // sendEvent를 ref로 노출 — useActionState/respondConfirm이 이를 통해 송신
    useEffect(() => {
        sendEventRef.current = sendEvent;
    }, [sendEvent]);

    useEffect(() => {
        if (wsStatus !== "connected" || greetingRequestedRef.current) return;
        greetingRequestedRef.current = true;
        sendEvent("conversation.greeting", {});
    }, [sendEvent, wsStatus]);

    const mic = useMicCapture({ sendEvent, wsRef });
    const wakewordReady =
        settingsData.wakeword.enabled
        && settingsData.wakeword.samples.length >= settingsData.wakeword.requiredSamples;
    const wakewordStandbyEnabled =
        wakewordReady
        && !wakewordTriggering
        && !mic.active
        && !convBusy
        && !actionVisualActive
        && !chatOpen
        && !todosOpen
        && !settingsOpen;

    const handleWakewordDetected = useCallback(() => {
        if (wakewordTriggering || mic.active) return;
        setWakewordTriggering(true);
        setIsSpeaking(true);
        setAssistantSubtitle("듣고 있어요.");
        setAssistantSubtitleDim(false);
        setChatOpen(false);
        setFloatingInputPosition(null);
        const bridge = (window as any).jarvisBridge;
        if (viewMode === "sphere" || viewMode === "minimizing") {
            bridge?.restoreWindow?.();
            setViewMode("restoring");
        }
        window.setTimeout(() => {
            void mic.start();
            window.setTimeout(() => setWakewordTriggering(false), 1200);
        }, viewMode === "sphere" || viewMode === "minimizing" ? 500 : 120);
    }, [mic, viewMode, wakewordTriggering]);

    const wakeword = useWakeWord({
        config: settingsData.wakeword,
        enabled: wakewordStandbyEnabled,
        onDetected: handleWakewordDetected,
    });

    useEffect(() => {
        if (!wakewordStandbyEnabled) return;
        if (viewMode !== "waveform" && viewMode !== "restoring") return;
        const timer = window.setTimeout(async () => {
            const bridge = (window as any).jarvisBridge;
            if (bridge?.minimizeNow) {
                await bridge.minimizeNow();
                setViewMode("sphere");
            } else {
                bridge?.minimizeWindow?.();
            }
        }, 900);
        return () => window.clearTimeout(timer);
    }, [viewMode, wakewordStandbyEnabled]);

    // Mic state side-effect: stt state
    useEffect(() => {
        if (mic.active) {
            enterListeningMode();
            setSttState("listening");
        } else {
            setSttState("idle");
        }
    }, [enterListeningMode, mic.active]);

    const handleChatSubmit = useCallback(() => {
        if (inputLocked) return;
        const text = chatInput.trim();
        if (!text) return;
        setUserSubtitle(text);
        assistantTts.beginTurn();
        setIsSpeaking(true);
        setConvBusy(true);
        if (convBusy || actionVisualActive) {
            sendEvent("conversation.cancel", {});
        }
        setConversationActionBlock(true);
        assistantDeltaBufferRef.current = "";
        setTruncationNoticeVisible(false);
        resetAssistantRenderText();
        setAssistantSubtitleDim(false);
        setActionIntentActive(false);
        clearPlanToastTimer();
        clearWaitingMessageTimer();
        setPlanToast("");
        activePlanStepIdRef.current = null;
        sendEvent("chat.request", { text });
        setChatInput("");
    }, [
        actionVisualActive,
        assistantTts,
        chatInput,
        clearPlanToastTimer,
        clearWaitingMessageTimer,
        convBusy,
        inputLocked,
        resetAssistantRenderText,
        sendEvent,
    ]);

    const handleStop = useCallback(() => {
        if (!convBusy) return;
        sendEvent("conversation.cancel", {});
        setConversationActionBlock(false);
        // 서버 응답 도착 전 즉시 UI 반응
        setConvBusy(false);
        setIsSpeaking(false);
        setAssistantSubtitleDim(false);
        setTruncationNoticeVisible(false);
        resetAssistantRenderText();
        assistantTts.cancel();
    }, [assistantTts, convBusy, resetAssistantRenderText, sendEvent]);

    const openChatAtMouse = useCallback(async () => {
        if (viewMode !== "sphere") {
            setChatOpen(true);
            setTimeout(() => chatInputRef.current?.focus(), 50);
            return;
        }

        const placed = await (window as any).jarvisBridge?.placeSphereInput?.();
        const local = placed?.local;
        if (
            local
            && Number.isFinite(Number(local.x))
            && Number.isFinite(Number(local.y))
        ) {
            setFloatingInputPosition({
                x: Number(local.x),
                y: Number(local.y),
            });
        } else {
            setFloatingInputPosition(lastPointerRef.current);
        }
        setChatOpen(true);
        setTimeout(() => chatInputRef.current?.focus(), 50);
    }, [viewMode]);

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
                void openChatAtMouse();
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
                    setFloatingInputPosition(null);
                    if (viewMode === "sphere") {
                        void (window as any).jarvisBridge?.resetSpherePosition?.();
                    }
                }
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [
        mic,
        chatOpen,
        convBusy,
        handleStop,
        inputLocked,
        micLocked,
        openChatAtMouse,
        viewMode,
    ]);

    useEffect(() => {
        const onPointerMove = (e: PointerEvent) => {
            lastPointerRef.current = { x: e.clientX, y: e.clientY };
        };
        window.addEventListener("pointermove", onPointerMove);
        return () => window.removeEventListener("pointermove", onPointerMove);
    }, []);

    // ── Window controls ──────────────────────────────────
    const handleMinimizeDone = useCallback(() => {
        (window as any).jarvisBridge?.minimizeAnimationDone?.();
    }, []);
    const handleRestoreDone = useCallback(() => setViewMode("waveform"), []);
    const handleMinimize = () =>
        (window as any).jarvisBridge?.minimizeWindow?.();
    const handleClose = () => (window as any).jarvisBridge?.closeWindow?.();
    const handleSphereClick = () => {
        window.focus();
    };
    const handleSphereDoubleClick = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragInfo.current.isDragging = false;
        document.body.style.cursor = "";
        setChatOpen(false);
        setFloatingInputPosition(null);
        setViewMode("restoring");
        (window as any).jarvisBridge?.restoreWindow?.();
    };

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
        if (e.button !== 0) return;
        e.preventDefault();
        const bridge = (window as any).jarvisBridge;
        const bounds = await bridge.getWindowBounds();
        if (!bounds) return;
        document.body.style.cursor = "grabbing";

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
            document.body.style.cursor = "";
        };

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
            document.body.style.cursor = "";
        };
    }, [handleSphereClick]);

    const isNormal = viewMode === "waveform" || viewMode === "restoring";
    const isSphere = viewMode === "sphere";
    const isMinimizing = viewMode === "minimizing";
    const minimizedFeedVisible = actionState.state.feed.some(
        (entry) => !(entry.kind === "step" && entry.status === "completed"),
    );
    const minimizedBubbleVisible =
        Boolean(assistantSubtitle.trim())
        || Boolean(planToast.trim())
        || minimizedFeedVisible;
    const terminalPanelEntry = terminalPanelActionId
        ? actionState.state.feed.find((entry) => entry.action_id === terminalPanelActionId) ?? null
        : null;
    const bgColor = isSphere || isMinimizing ? "transparent" : "#000";

    useEffect(() => {
        if (!isSphere) return;
        const bridge = (window as any).jarvisBridge;
        const targetWidth = chatOpen || minimizedBubbleVisible ? 560 : 160;
        const targetHeight = chatOpen ? 260 : 160;
        let cancelled = false;

        const resizeSphereWindow = async () => {
            const bounds = await bridge?.getWindowBounds?.();
            if (!bounds || cancelled) return;
            if (
                Math.abs(Number(bounds.width) - targetWidth) < 2
                && Math.abs(Number(bounds.height) - targetHeight) < 2
            ) {
                return;
            }
            const right = Number(bounds.x) + Number(bounds.width);
            bridge?.moveWindow?.({
                x: Math.round(right - targetWidth),
                y: Number(bounds.y),
                width: targetWidth,
                height: targetHeight,
            });
        };

        void resizeSphereWindow();
        return () => {
            cancelled = true;
        };
    }, [chatOpen, isSphere, minimizedBubbleVisible]);

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
                    onSphereDoubleClick={handleSphereDoubleClick}
                    onMouseDown={handleDragStart}
                />
            )}

            {isSphere && (
                <MinimizedResponseBubble
                    conversationText={assistantSubtitle}
                    conversationDim={assistantSubtitleDim}
                    planText={planToast}
                    feed={actionState.state.feed}
                    chatOpen={chatOpen}
                    inputPosition={floatingInputPosition}
                />
            )}

            {isNormal && (
                <AssistantSubtitle
                    text={assistantSubtitle}
                    dim={assistantSubtitleDim}
                />
            )}

            {/*
            {isNormal && (
                <PlanToast text={planToast} chatOpen={chatOpen} />
            )}
            */}

            {isNormal && terminalPanelEntry && (
                <TerminalPanel
                    entry={terminalPanelEntry}
                    onClose={() => setTerminalPanelActionId(null)}
                />
            )}

            {isNormal && !terminalPanelEntry && deepResponsePanel.open && (
                <DeepResponsePanel
                    text={deepResponsePanel.text}
                    active={deepResponsePanel.active}
                    onClose={() => {
                        deepPanelDismissedRef.current = true;
                        setDeepResponsePanel((prev) => ({
                            ...prev,
                            open: false,
                        }));
                    }}
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
                    position={floatingInputPosition}
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
                    onOpenTodos={() => setTodosOpen(true)}
                    onOpenSettings={() => setSettingsOpen(true)}
                />
            )}

            <TodoPanel
                open={todosOpen}
                token={token}
                onClose={() => setTodosOpen(false)}
            />

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
                        && isTerminalActionType(pending.action.type)
                    ) {
                        setIsSpeaking(true);
                        setAssistantSubtitle(
                            formatProgressText(
                                pending.action.description || pending.action.type,
                            ),
                        );
                        showTerminalAction(actionId);
                    } else if (
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

            {isNormal && (
                <TruncationNotice
                    visible={truncationNoticeVisible}
                    onDismiss={() => setTruncationNoticeVisible(false)}
                    onContinueDeep={() => {
                        setTruncationNoticeVisible(false);
                        sendEvent("chat.request", {
                            text: "방금 답변을 자세히 이어서 설명해줘",
                            route_override: "deep",
                        });
                    }}
                />
            )}
        </div>
    );
}
