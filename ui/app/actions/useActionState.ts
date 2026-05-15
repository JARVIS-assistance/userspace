import { useCallback, useEffect, useRef, useState } from "react";
import {
    ActionState,
    EMPTY_ACTION_STATE,
    FeedEntry,
    FeedStatus,
    PendingConfirm,
} from "./types";

const FEED_CAP = 8;
const COMPLETED_DISMISS_MS = 3000;

interface Options {
    sendEvent: (type: string, payload: Record<string, unknown>) => void;
}

interface WsMessage {
    type: string;
    payload: Record<string, any>;
}

export function useActionState({ sendEvent }: Options) {
    const [state, setState] = useState<ActionState>(EMPTY_ACTION_STATE);
    const completedDismissTimersRef = useRef<Map<string, number>>(new Map());

    const clearCompletedDismissTimer = useCallback((actionId: string) => {
        const timer = completedDismissTimersRef.current.get(actionId);
        if (timer !== undefined) {
            window.clearTimeout(timer);
            completedDismissTimersRef.current.delete(actionId);
        }
    }, []);

    useEffect(() => {
        const completedIds = new Set(
            state.feed
                .filter((entry) =>
                    entry.kind !== "step"
                    && entry.status === "completed"
                    && !isTerminalFeedEntry(entry)
                )
                .map((entry) => entry.action_id),
        );
        for (const actionId of completedIds) {
            if (completedDismissTimersRef.current.has(actionId)) continue;
            const timer = window.setTimeout(() => {
                completedDismissTimersRef.current.delete(actionId);
                setState((s) => ({
                    ...s,
                    feed: s.feed.filter((entry) => entry.action_id !== actionId),
                }));
            }, COMPLETED_DISMISS_MS);
            completedDismissTimersRef.current.set(actionId, timer);
        }
        for (const actionId of completedDismissTimersRef.current.keys()) {
            if (!completedIds.has(actionId)) {
                clearCompletedDismissTimer(actionId);
            }
        }
    }, [clearCompletedDismissTimer, state.feed]);

    useEffect(() => {
        return () => {
            for (const timer of completedDismissTimersRef.current.values()) {
                window.clearTimeout(timer);
            }
            completedDismissTimersRef.current.clear();
        };
    }, []);

    const onWsMessage = useCallback((msg: WsMessage): boolean => {
        if (msg.type === "client_action.pending") {
            const item: PendingConfirm = {
                action_id: String(msg.payload.action_id || ""),
                request_id: String(msg.payload.request_id || ""),
                action: msg.payload.action,
                timeout_sec: Number(msg.payload.timeout_sec || 30),
                timestamp: Number(msg.payload.timestamp || Date.now()),
            };
            if (!item.action_id || !item.action) return true;
            setState((s) => ({
                ...s,
                pendingConfirms: [
                    ...s.pendingConfirms.filter((p) => p.action_id !== item.action_id),
                    item,
                ],
                feed: prependCap(
                    s.feed.filter((f) => f.action_id !== item.action_id),
                    {
                        action_id: item.action_id,
                        type: String(item.action?.type || "?"),
                        description: String(item.action?.description || ""),
                        status: "waiting_confirmation",
                        kind: "action",
                        timestamp: item.timestamp,
                    },
                ),
            }));
            return true;
        }

        if (msg.type === "client_action.started") {
            const id = String(msg.payload.action_id || "");
            if (!id) return true;
            const entry: FeedEntry = {
                action_id: id,
                type: String(msg.payload.type || "?"),
                description: String(msg.payload.description || ""),
                status: "running",
                kind: "action",
                timestamp: Number(msg.payload.timestamp || Date.now()),
            };
            setState((s) => ({
                ...s,
                feed: prependCap(
                    s.feed.filter((f) => f.action_id !== id),
                    entry,
                ),
            }));
            return true;
        }

        if (msg.type === "conversation.action_dispatch") {
            const id = String(msg.payload.action_id || "");
            const action = msg.payload.action || {};
            if (!id) return false;
            const entry: FeedEntry = {
                action_id: id,
                type: String(action.type || "?"),
                description: String(action.description || ""),
                status: "queued",
                kind: "action",
                timestamp: Number(msg.payload.timestamp || Date.now()),
            };
            setState((s) => ({
                ...s,
                feed: prependCap(
                    s.feed.filter((f) => f.action_id !== id),
                    entry,
                ),
            }));
            return false;
        }

        // conversation.plan_step은 feed에 넣지 않는다 — 중앙 자막에서만 표시.
        // (App.tsx의 _routeChatMessage가 직접 처리)
        if (msg.type === "conversation.plan_step") {
            return false;
        }

        if (msg.type === "conversation.action_result") {
            const id = String(msg.payload.action_id || "");
            if (!id) return false;
            const status = normalizeResultStatus(String(msg.payload.status || ""));
            setState((s) => upsertTerminalFeed(s, id, status, msg.payload));
            return false;
        }

        if (msg.type === "conversation.actions") {
            const results = Array.isArray(msg.payload.results)
                ? msg.payload.results
                : [];
            if (results.length === 0) return false;
            setState((s) => {
                let next = s;
                for (const result of results) {
                    const id = String(result?.action_id || "");
                    if (!id) continue;
                    next = upsertTerminalFeed(
                        next,
                        id,
                        normalizeResultStatus(String(result.status || "")),
                        result,
                    );
                }
                return next;
            });
            return false;
        }

        if (msg.type === "conversation.action_compile_retry") {
            const requestId = String(msg.payload.request_id || "");
            const id = `retry_${requestId || Number(msg.payload.timestamp || Date.now())}`;
            setState((s) => ({
                ...s,
                feed: prependCap(
                    s.feed.filter((f) => f.action_id !== id),
                    {
                        action_id: id,
                        type: "action_compiler",
                        description: "Invalid assistant text action is being recompiled",
                        status: "retrying_compile",
                        kind: "action",
                        error: String(msg.payload.reason || ""),
                        output: {
                            validation_errors: msg.payload.validation_errors || [],
                        },
                        timestamp: Number(msg.payload.timestamp || Date.now()),
                    },
                ),
            }));
            return false;
        }

        if (msg.type === "conversation.cancelled" || msg.type === "conversation.barge_in") {
            const reason = String(msg.payload?.reason || "barge_in");
            setState((s) => ({
                ...s,
                pendingConfirms: [],
                feed: s.feed.filter((entry) =>
                    ![
                        "queued",
                        "waiting_confirmation",
                        "running",
                        "retrying_compile",
                    ].includes(entry.status)
                ),
            }));
            for (const actionId of completedDismissTimersRef.current.keys()) {
                clearCompletedDismissTimer(actionId);
            }
            if (reason) {
                // State-only cleanup; backend submits rejected results for cancelled request actions.
            }
            return false;
        }

        if (msg.type === "conversation.done" && msg.payload?.summary === "embedded assistant action suppressed") {
            const id = `suppressed_${Number(msg.payload.timestamp || Date.now())}`;
            setState((s) => ({
                ...s,
                feed: prependCap(s.feed, {
                    action_id: id,
                    type: "suppressed",
                    description: "Assistant text action was suppressed",
                    status: "suppressed",
                    kind: "action",
                    error: String(
                        msg.payload.failure_reason
                        || msg.payload.error
                        || msg.payload.text
                        || "assistant text is not an executable action source",
                    ),
                    timestamp: Number(msg.payload.timestamp || Date.now()),
                }),
            }));
            return false;
        }

        const status = mapTerminalStatus(msg.type);
        if (status) {
            const id = String(msg.payload.action_id || "");
            if (!id) return true;
            setState((s) => upsertTerminalFeed(s, id, status, msg.payload));
            return true;
        }

        return false;
    }, []);

    const respondConfirm = useCallback(
        (actionId: string, accepted: boolean, reason?: string) => {
            sendEvent("client_action.confirm", {
                action_id: actionId,
                accepted,
                ...(reason ? { reason } : {}),
            });
            setState((s) => ({
                ...s,
                pendingConfirms: s.pendingConfirms.filter(
                    (p) => p.action_id !== actionId,
                ),
            }));
        },
        [sendEvent],
    );

    const dismissFeedEntry = useCallback((actionId: string) => {
        clearCompletedDismissTimer(actionId);
        setState((s) => ({
            ...s,
            feed: s.feed.filter((f) => f.action_id !== actionId),
        }));
    }, [clearCompletedDismissTimer]);

    return { state, onWsMessage, respondConfirm, dismissFeedEntry };
}

// ── helpers ─────────────────────────────────────────

function mapTerminalStatus(wsType: string): FeedStatus | null {
    if (wsType === "client_action.completed") return "completed";
    if (wsType === "client_action.failed") return "failed";
    if (wsType === "client_action.rejected") return "rejected";
    if (wsType === "client_action.timeout") return "timeout";
    return null;
}

function normalizeResultStatus(status: string): FeedStatus {
    if (status === "completed") return "completed";
    if (status === "rejected") return "rejected";
    if (status === "timeout") return "timeout";
    if (status === "invalid") return "invalid";
    if (status === "retrying_compile") return "retrying_compile";
    if (status === "suppressed") return "suppressed";
    return "failed";
}

function upsertTerminalFeed(
    state: ActionState,
    actionId: string,
    status: FeedStatus,
    payload: Record<string, any>,
): ActionState {
    const idx = state.feed.findIndex((f) => f.action_id === actionId);
    if (idx === -1) {
        const entry: FeedEntry = {
            action_id: actionId,
            type: String(payload.type || payload.action?.type || "?"),
            description: String(payload.description || payload.action?.description || ""),
            status,
            kind: "action",
            error:
                payload.failure_reason
                ?? payload.error
                ?? payload.reason
                ?? payload.output?.reason
                ?? null,
            output: payload.output ?? null,
            timestamp: Number(payload.timestamp || Date.now()),
        };
        return { ...state, feed: prependCap(state.feed, entry) };
    }
    const updated = [...state.feed];
    updated[idx] = {
        ...updated[idx],
        status,
        error:
            payload.failure_reason
            ?? payload.error
            ?? payload.reason
            ?? payload.output?.reason
            ?? updated[idx].error,
        output: payload.output ?? updated[idx].output,
        timestamp: Number(payload.timestamp || Date.now()),
    };
    return { ...state, feed: updated };
}

function prependCap(feed: FeedEntry[], entry: FeedEntry): FeedEntry[] {
    return [entry, ...feed].slice(0, FEED_CAP);
}

function isTerminalFeedEntry(entry: FeedEntry): boolean {
    return entry.type === "terminal" || entry.type === "terminal.run";
}
