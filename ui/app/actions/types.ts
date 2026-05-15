// Backend OpenAPI ClientAction과 동일 (subset)
export type ClientActionType =
    | "terminal" | "terminal.run"
    | "app_control" | "app.open" | "app.focus" | "app.close"
    | "file.write" | "file_read" | "file_write"
    | "open_url" | "browser" | "browser.open" | "browser.navigate" | "browser.search" | "browser.select_result"
    | "browser.extract_dom" | "browser.click" | "browser.type"
    | "browser_control" | "web_search" | "notify" | "clipboard"
    | "todo" | "todo.create" | "todo.update" | "todo.delete"
    | "mouse.click" | "mouse.drag" | "mouse_click" | "mouse_drag"
    | "keyboard.type" | "keyboard.hotkey" | "keyboard_type" | "hotkey"
    | "screen.screenshot" | "screenshot";

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

export type FeedStatus =
    | "queued"
    | "waiting_confirmation"
    | "running"
    | "completed"
    | "failed"
    | "timeout"
    | "rejected"
    | "invalid"
    | "retrying_compile"
    | "suppressed";
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
