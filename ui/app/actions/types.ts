// Backend OpenAPI ClientAction과 동일 (subset)
export type ClientActionType =
    | "terminal" | "app_control" | "file_write" | "file_read"
    | "open_url" | "browser_control" | "web_search" | "notify" | "clipboard"
    | "mouse_click" | "mouse_drag" | "keyboard_type" | "hotkey" | "screenshot";

export interface ClientAction {
    type: ClientActionType;
    command?: string | null;
    target?: string | null;
    payload?: string | null;
    args?: Record<string, unknown>;
    description: string;
    requires_confirm: boolean;
    step_id?: string | null;
}

// 컨펌 대기 큐 항목 (server → ui: client_action.pending)
export interface PendingConfirm {
    action_id: string;
    request_id: string;
    action: ClientAction;
    timeout_sec: number;
    timestamp: number;
}

export type FeedStatus = "started" | "completed" | "failed" | "rejected" | "timeout";
export type FeedKind = "action" | "step";

export interface FeedEntry {
    action_id: string;
    type: ClientActionType | string;
    description: string;
    status: FeedStatus;
    kind?: FeedKind;
    error?: string | null;
    output?: Record<string, unknown> | null;
    timestamp: number;
}

export interface ActionState {
    pendingConfirms: PendingConfirm[];
    feed: FeedEntry[];
}

export const EMPTY_ACTION_STATE: ActionState = {
    pendingConfirms: [],
    feed: [],
};
