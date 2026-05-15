import { resolveApiBase } from "../settings/storage";

export type TodoStatus = "open" | "completed" | "cancelled" | "archived";

export interface Todo {
    id?: string;
    todo_id?: string;
    title: string;
    description?: string | null;
    priority?: number | null;
    status?: TodoStatus;
    due_at?: string | null;
    remind_at?: string | null;
    timezone?: string | null;
    calendar_provider?: "google" | string | null;
    calendar_id?: string | null;
    calendar_event_id?: string | null;
    calendar_sync_status?: string | null;
    metadata?: Record<string, unknown> | null;
    created_at?: string;
    updated_at?: string;
}

export interface TodoPayload {
    title: string;
    description?: string;
    priority?: number;
    due_at?: string | null;
    remind_at?: string | null;
    timezone?: string;
    calendar_provider?: "google";
    calendar_id?: string;
    calendar_event_id?: string;
    calendar_sync_status?: string;
    metadata?: Record<string, unknown>;
}

export type TodoPatch = Partial<TodoPayload> & {
    status?: TodoStatus;
};

function authHeaders(token: string): Record<string, string> {
    return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
    };
}

async function readJson(res: Response): Promise<any> {
    try {
        return await res.json();
    } catch (_) {
        return null;
    }
}

function extractTodos(raw: any): Todo[] {
    const source = Array.isArray(raw)
        ? raw
        : Array.isArray(raw?.items)
          ? raw.items
          : Array.isArray(raw?.todos)
            ? raw.todos
            : Array.isArray(raw?.data)
              ? raw.data
              : [];
    return source.filter((item: any): item is Todo => item && typeof item === "object");
}

async function request<T>(
    token: string,
    path: string,
    init: RequestInit = {},
): Promise<T> {
    const apiBase = await resolveApiBase();
    const res = await fetch(`${apiBase}${path}`, {
        ...init,
        headers: {
            ...authHeaders(token),
            ...(init.headers || {}),
        },
    });
    const data = await readJson(res);
    if (!res.ok) {
        const message = data?.detail || data?.message || `Todo API failed (${res.status})`;
        throw new Error(String(message));
    }
    return data as T;
}

export async function fetchTodos(token: string): Promise<Todo[]> {
    return extractTodos(await request<any>(token, "/todos"));
}

export async function createTodo(token: string, payload: TodoPayload): Promise<Todo> {
    return await request<Todo>(token, "/todos", {
        method: "POST",
        body: JSON.stringify(payload),
    });
}

export async function updateTodo(
    token: string,
    todoId: string,
    patch: TodoPatch,
): Promise<Todo> {
    return await request<Todo>(token, `/todos/${encodeURIComponent(todoId)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
    });
}

export async function deleteTodo(token: string, todoId: string): Promise<void> {
    await request<unknown>(token, `/todos/${encodeURIComponent(todoId)}`, {
        method: "DELETE",
    });
}

export function todoId(todo: Todo): string {
    return String(todo.todo_id || todo.id || "");
}
