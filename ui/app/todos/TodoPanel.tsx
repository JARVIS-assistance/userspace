import { useCallback, useEffect, useMemo, useState } from "react";
import {
    createTodo,
    deleteTodo,
    fetchTodos,
    todoId,
    updateTodo,
    type Todo,
    type TodoPayload,
    type TodoStatus,
} from "./api";
import {
    createGoogleCalendarEvent,
    fetchGoogleCalendars,
    type GoogleCalendarItem,
} from "./googleCalendar";

interface Props {
    token: string;
    open: boolean;
    onClose: () => void;
}

interface TodoFormState {
    title: string;
    description: string;
    priority: number;
    dueAtLocal: string;
    remindAtLocal: string;
    timezone: string;
    addToGoogleCalendar: boolean;
    calendarId: string;
}

const STATUS_OPTIONS: TodoStatus[] = ["open", "completed", "cancelled", "archived"];

const emptyForm = (): TodoFormState => ({
    title: "",
    description: "",
    priority: 3,
    dueAtLocal: "",
    remindAtLocal: "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Seoul",
    addToGoogleCalendar: false,
    calendarId: "primary",
});

function pad(value: number): string {
    return String(value).padStart(2, "0");
}

function formatOffset(date: Date): string {
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    const abs = Math.abs(offset);
    return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function datetimeLocalToIso(value: string): string | null {
    if (!value) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${formatOffset(date)}`;
}

function isoToDatetimeLocal(value?: string | null): string {
    if (!value) return "";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function normalizePriority(value: number): number {
    return Math.min(5, Math.max(1, Math.round(value || 3)));
}

function labelForCalendar(item: GoogleCalendarItem): string {
    return item.primary ? `${item.summary} (primary)` : item.summary;
}

function buildTodoPayload(form: TodoFormState, calendarEventId?: string): TodoPayload {
    const dueAt = datetimeLocalToIso(form.dueAtLocal);
    const remindAt = datetimeLocalToIso(form.remindAtLocal);
    const payload: TodoPayload = {
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        priority: normalizePriority(form.priority),
        due_at: dueAt,
        remind_at: remindAt,
        timezone: form.timezone.trim() || "Asia/Seoul",
        metadata: { source: "todo_ui" },
    };
    if (calendarEventId) {
        payload.calendar_provider = "google";
        payload.calendar_id = form.calendarId || "primary";
        payload.calendar_event_id = calendarEventId;
        payload.calendar_sync_status = "linked";
    }
    return payload;
}

const overlayStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 8500,
    background: "rgba(0,0,0,0.72)",
    backdropFilter: "blur(10px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
};

const panelStyle: React.CSSProperties = {
    width: "min(1100px, calc(100vw - 48px))",
    maxHeight: "calc(100vh - 64px)",
    overflow: "hidden",
    background: "rgba(12,12,12,0.96)",
    border: "1px solid rgba(120,80,30,0.34)",
    borderRadius: 8,
    color: "rgba(220,190,155,0.92)",
    boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
    display: "grid",
    gridTemplateColumns: "minmax(320px, 420px) minmax(0, 1fr)",
};

const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 6,
    border: "1px solid rgba(120,80,30,0.3)",
    background: "rgba(26,26,26,0.92)",
    color: "rgba(235,205,170,0.95)",
    fontSize: 13,
    outline: "none",
};

const labelStyle: React.CSSProperties = {
    display: "block",
    marginBottom: 6,
    color: "rgba(150,115,76,0.85)",
    fontFamily: "monospace",
    fontSize: 11,
    letterSpacing: "0.08em",
};

const buttonStyle = (variant: "primary" | "ghost" | "danger" = "ghost"): React.CSSProperties => ({
    borderRadius: 6,
    border: variant === "danger"
        ? "1px solid rgba(220,80,60,0.45)"
        : "1px solid rgba(120,80,30,0.34)",
    background: variant === "primary"
        ? "rgba(120,80,30,0.42)"
        : variant === "danger"
          ? "rgba(120,30,25,0.24)"
          : "rgba(24,24,24,0.72)",
    color: variant === "danger" ? "rgba(245,150,130,0.95)" : "rgba(225,195,160,0.9)",
    cursor: "pointer",
    padding: "9px 12px",
    fontSize: 12,
    letterSpacing: "0.06em",
});

export default function TodoPanel({ token, open, onClose }: Props) {
    const [todos, setTodos] = useState<Todo[]>([]);
    const [form, setForm] = useState<TodoFormState>(emptyForm);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [calendars, setCalendars] = useState<GoogleCalendarItem[]>([
        { id: "primary", summary: "primary", primary: true },
    ]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [calendarLoading, setCalendarLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [calendarError, setCalendarError] = useState<string | null>(null);

    const sortedTodos = useMemo(() => {
        return [...todos].sort((a, b) => {
            const aDue = a.due_at ? new Date(a.due_at).getTime() : Number.MAX_SAFE_INTEGER;
            const bDue = b.due_at ? new Date(b.due_at).getTime() : Number.MAX_SAFE_INTEGER;
            return aDue - bDue;
        });
    }, [todos]);

    const loadTodos = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setTodos(await fetchTodos(token));
        } catch (err) {
            setError(err instanceof Error ? err.message : "Todo 목록을 불러오지 못했습니다.");
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => {
        if (open) void loadTodos();
    }, [loadTodos, open]);

    const loadCalendars = useCallback(async () => {
        setCalendarLoading(true);
        setCalendarError(null);
        try {
            const items = await fetchGoogleCalendars();
            setCalendars(items);
            setForm((prev) => ({
                ...prev,
                calendarId: items.find((item) => item.primary)?.id || items[0]?.id || "primary",
            }));
        } catch (err) {
            setCalendarError(err instanceof Error ? err.message : "캘린더 목록을 불러오지 못했습니다.");
        } finally {
            setCalendarLoading(false);
        }
    }, []);

    useEffect(() => {
        if (open && form.addToGoogleCalendar) void loadCalendars();
    }, [form.addToGoogleCalendar, loadCalendars, open]);

    const resetForm = useCallback(() => {
        setEditingId(null);
        setForm(emptyForm());
        setCalendarError(null);
    }, []);

    const editTodo = useCallback((todo: Todo) => {
        const id = todoId(todo);
        setEditingId(id || null);
        setForm({
            title: todo.title || "",
            description: todo.description || "",
            priority: normalizePriority(Number(todo.priority || 3)),
            dueAtLocal: isoToDatetimeLocal(todo.due_at),
            remindAtLocal: isoToDatetimeLocal(todo.remind_at),
            timezone: todo.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Seoul",
            addToGoogleCalendar: Boolean(todo.calendar_event_id),
            calendarId: todo.calendar_id || "primary",
        });
    }, []);

    const saveTodo = useCallback(async () => {
        if (saving) return;
        if (!form.title.trim()) {
            setError("제목을 입력하세요.");
            return;
        }
        setSaving(true);
        setError(null);
        setCalendarError(null);
        try {
            let calendarEventId: string | undefined;
            const dueAt = datetimeLocalToIso(form.dueAtLocal);
            const existingTodo = editingId
                ? todos.find((todo) => todoId(todo) === editingId)
                : null;
            if (form.addToGoogleCalendar) {
                if (!dueAt) throw new Error("Google Calendar에 추가하려면 마감일/시간이 필요합니다.");
                if (existingTodo?.calendar_event_id) {
                    calendarEventId = existingTodo.calendar_event_id;
                } else {
                    try {
                        calendarEventId = await createGoogleCalendarEvent({
                            title: form.title.trim(),
                            description: form.description.trim(),
                            dueAt,
                            remindAt: datetimeLocalToIso(form.remindAtLocal),
                            timezone: form.timezone.trim() || "Asia/Seoul",
                            calendarId: form.calendarId || "primary",
                        });
                    } catch (err) {
                        const message = err instanceof Error ? err.message : "Google Calendar 이벤트 생성 실패";
                        const fallback = window.confirm(`${message}\n\n캘린더 연동 없이 Todo만 저장할까요?`);
                        if (!fallback) throw err;
                    }
                }
            }

            const payload = buildTodoPayload(form, calendarEventId);
            if (editingId) {
                await updateTodo(token, editingId, payload);
            } else {
                await createTodo(token, payload);
            }
            resetForm();
            await loadTodos();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Todo 저장에 실패했습니다.");
        } finally {
            setSaving(false);
        }
    }, [editingId, form, loadTodos, resetForm, saving, todos, token]);

    const changeStatus = useCallback(async (todo: Todo, status: TodoStatus) => {
        const id = todoId(todo);
        if (!id) return;
        setError(null);
        try {
            await updateTodo(token, id, { status });
            await loadTodos();
        } catch (err) {
            setError(err instanceof Error ? err.message : "상태 변경에 실패했습니다.");
        }
    }, [loadTodos, token]);

    const removeTodo = useCallback(async (todo: Todo) => {
        const id = todoId(todo);
        if (!id) return;
        const ok = window.confirm(`"${todo.title}" Todo를 삭제할까요?`);
        if (!ok) return;
        setError(null);
        try {
            await deleteTodo(token, id);
            if (editingId === id) resetForm();
            await loadTodos();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Todo 삭제에 실패했습니다.");
        }
    }, [editingId, loadTodos, resetForm, token]);

    if (!open) return null;

    return (
        <div style={overlayStyle}>
            <section style={panelStyle}>
                <form
                    style={{
                        padding: 24,
                        borderRight: "1px solid rgba(120,80,30,0.22)",
                        overflowY: "auto",
                    }}
                    onSubmit={(event) => {
                        event.preventDefault();
                        void saveTodo();
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
                        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 400, letterSpacing: "0.12em" }}>
                            TODO
                        </h2>
                        <button type="button" onClick={onClose} style={buttonStyle("ghost")}>
                            CLOSE
                        </button>
                    </div>

                    <div style={{ display: "grid", gap: 13 }}>
                        <label>
                            <span style={labelStyle}>TITLE</span>
                            <input
                                style={inputStyle}
                                value={form.title}
                                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                                placeholder="소불고기 재료 사기"
                            />
                        </label>
                        <label>
                            <span style={labelStyle}>DESCRIPTION</span>
                            <textarea
                                style={{ ...inputStyle, minHeight: 82, resize: "vertical" }}
                                value={form.description}
                                onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                                placeholder="양파, 배, 간장, 소고기"
                            />
                        </label>
                        <label>
                            <span style={labelStyle}>PRIORITY</span>
                            <input
                                style={inputStyle}
                                type="number"
                                min={1}
                                max={5}
                                value={form.priority}
                                onChange={(event) => setForm((prev) => ({ ...prev, priority: normalizePriority(Number(event.target.value)) }))}
                            />
                        </label>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                            <label>
                                <span style={labelStyle}>DUE AT</span>
                                <input
                                    style={inputStyle}
                                    type="datetime-local"
                                    value={form.dueAtLocal}
                                    onChange={(event) => setForm((prev) => ({ ...prev, dueAtLocal: event.target.value }))}
                                />
                            </label>
                            <label>
                                <span style={labelStyle}>REMIND AT</span>
                                <input
                                    style={inputStyle}
                                    type="datetime-local"
                                    value={form.remindAtLocal}
                                    onChange={(event) => setForm((prev) => ({ ...prev, remindAtLocal: event.target.value }))}
                                />
                            </label>
                        </div>
                        <label>
                            <span style={labelStyle}>TIMEZONE</span>
                            <input
                                style={inputStyle}
                                value={form.timezone}
                                onChange={(event) => setForm((prev) => ({ ...prev, timezone: event.target.value }))}
                            />
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: 10, color: "rgba(225,195,160,0.88)", fontSize: 13 }}>
                            <input
                                type="checkbox"
                                checked={form.addToGoogleCalendar}
                                onChange={(event) => setForm((prev) => ({ ...prev, addToGoogleCalendar: event.target.checked }))}
                            />
                            Google Calendar에 추가
                        </label>
                        {form.addToGoogleCalendar && (
                            <label>
                                <span style={labelStyle}>CALENDAR</span>
                                <div style={{ display: "flex", gap: 8 }}>
                                    <select
                                        style={inputStyle}
                                        value={form.calendarId}
                                        onChange={(event) => setForm((prev) => ({ ...prev, calendarId: event.target.value }))}
                                    >
                                        {calendars.map((item) => (
                                            <option key={item.id} value={item.id}>
                                                {labelForCalendar(item)}
                                            </option>
                                        ))}
                                    </select>
                                    <button type="button" style={buttonStyle("ghost")} onClick={() => void loadCalendars()}>
                                        {calendarLoading ? "..." : "SYNC"}
                                    </button>
                                </div>
                                {calendarError && (
                                    <p style={{ margin: "8px 0 0", color: "rgba(245,150,130,0.92)", fontSize: 12 }}>
                                        {calendarError}
                                    </p>
                                )}
                            </label>
                        )}
                    </div>

                    {error && (
                        <p style={{ margin: "16px 0 0", color: "rgba(245,150,130,0.95)", fontSize: 13 }}>
                            {error}
                        </p>
                    )}

                    <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                        <button type="submit" style={buttonStyle("primary")} disabled={saving}>
                            {saving ? "SAVING" : editingId ? "UPDATE" : "CREATE"}
                        </button>
                        <button type="button" style={buttonStyle("ghost")} onClick={resetForm}>
                            RESET
                        </button>
                    </div>
                </form>

                <div style={{ padding: 24, overflowY: "auto" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 400, letterSpacing: "0.12em", color: "rgba(194,149,107,0.9)" }}>
                            LIST
                        </h3>
                        <button type="button" onClick={() => void loadTodos()} style={buttonStyle("ghost")}>
                            {loading ? "LOADING" : "REFRESH"}
                        </button>
                    </div>

                    {sortedTodos.length === 0 && !loading ? (
                        <p style={{ color: "rgba(150,115,76,0.85)", fontSize: 13 }}>등록된 Todo가 없습니다.</p>
                    ) : (
                        <div style={{ display: "grid", gap: 10 }}>
                            {sortedTodos.map((todo) => {
                                const id = todoId(todo);
                                return (
                                    <article
                                        key={id || `${todo.title}-${todo.due_at}`}
                                        style={{
                                            border: "1px solid rgba(120,80,30,0.22)",
                                            borderRadius: 8,
                                            padding: 14,
                                            background: editingId === id ? "rgba(70,48,28,0.34)" : "rgba(18,18,18,0.72)",
                                        }}
                                    >
                                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                                            <div style={{ minWidth: 0 }}>
                                                <div style={{ fontSize: 15, color: "rgba(235,205,170,0.96)", wordBreak: "break-word" }}>
                                                    {todo.title}
                                                </div>
                                                {todo.description && (
                                                    <p style={{ margin: "6px 0 0", color: "rgba(190,160,125,0.82)", fontSize: 13, lineHeight: 1.45 }}>
                                                        {todo.description}
                                                    </p>
                                                )}
                                            </div>
                                            <select
                                                value={todo.status || "open"}
                                                onChange={(event) => void changeStatus(todo, event.target.value as TodoStatus)}
                                                style={{ ...inputStyle, width: 132, height: 38 }}
                                            >
                                                {STATUS_OPTIONS.map((status) => (
                                                    <option key={status} value={status}>
                                                        {status}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10, color: "rgba(150,115,76,0.9)", fontSize: 12 }}>
                                            <span>P{todo.priority ?? 3}</span>
                                            {todo.due_at && <span>DUE {new Date(todo.due_at).toLocaleString()}</span>}
                                            {todo.remind_at && <span>REMIND {new Date(todo.remind_at).toLocaleString()}</span>}
                                            {todo.calendar_event_id && <span>GOOGLE {todo.calendar_id || "primary"}</span>}
                                        </div>
                                        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                                            <button type="button" style={buttonStyle("ghost")} onClick={() => editTodo(todo)}>
                                                EDIT
                                            </button>
                                            <button type="button" style={buttonStyle("danger")} onClick={() => void removeTodo(todo)}>
                                                DELETE
                                            </button>
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
}
