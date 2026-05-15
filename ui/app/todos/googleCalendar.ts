const GOOGLE_TOKEN_STORAGE_KEY = "jarvis_google_calendar_access_token";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly";

export interface GoogleCalendarItem {
    id: string;
    summary: string;
    primary?: boolean;
}

export interface CalendarEventInput {
    title: string;
    description?: string;
    dueAt: string;
    remindAt?: string | null;
    timezone: string;
    calendarId: string;
}

interface GoogleTokenResponse {
    access_token?: string;
    error?: string;
}

function getStoredToken(): string {
    return localStorage.getItem(GOOGLE_TOKEN_STORAGE_KEY) || "";
}

function storeToken(token: string) {
    localStorage.setItem(GOOGLE_TOKEN_STORAGE_KEY, token);
}

export function clearGoogleCalendarToken() {
    localStorage.removeItem(GOOGLE_TOKEN_STORAGE_KEY);
}

async function resolveGoogleClientId(): Promise<string> {
    const bridge = (window as any).jarvisBridge;
    const config = await bridge?.getUserspaceConfig?.();
    return String(config?.googleClientId || "").trim();
}

function requestTokenWithGis(clientId: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const google = (window as any).google;
        const oauth2 = google?.accounts?.oauth2;
        if (!oauth2?.initTokenClient) {
            reject(new Error("Google OAuth client is not loaded"));
            return;
        }
        const client = oauth2.initTokenClient({
            client_id: clientId,
            scope: GOOGLE_SCOPE,
            prompt: "",
            callback: (response: GoogleTokenResponse) => {
                if (response?.access_token) {
                    storeToken(response.access_token);
                    resolve(response.access_token);
                    return;
                }
                reject(new Error(response?.error || "Google OAuth token request failed"));
            },
        });
        client.requestAccessToken();
    });
}

export async function ensureGoogleCalendarToken(): Promise<string> {
    const current = getStoredToken();
    if (current) return current;

    const clientId = await resolveGoogleClientId();
    if (!clientId) {
        throw new Error("GOOGLE_CLIENT_ID is not configured");
    }
    return await requestTokenWithGis(clientId);
}

async function googleFetch<T>(
    token: string,
    url: string,
    init: RequestInit = {},
    retried = false,
): Promise<T> {
    const res = await fetch(url, {
        ...init,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...(init.headers || {}),
        },
    });
    let data: any = null;
    try {
        data = await res.json();
    } catch (_) {}
    if (!res.ok) {
        if (res.status === 401) {
            clearGoogleCalendarToken();
            if (!retried) {
                const nextToken = await ensureGoogleCalendarToken();
                return await googleFetch<T>(nextToken, url, init, true);
            }
        }
        const message = data?.error?.message || `Google Calendar API failed (${res.status})`;
        throw new Error(String(message));
    }
    return data as T;
}

export async function fetchGoogleCalendars(): Promise<GoogleCalendarItem[]> {
    const token = await ensureGoogleCalendarToken();
    const data = await googleFetch<any>(
        token,
        "https://www.googleapis.com/calendar/v3/users/me/calendarList",
    );
    const items = Array.isArray(data?.items) ? data.items : [];
    const calendars = items
        .map((item: any) => ({
            id: String(item.id || ""),
            summary: String(item.summary || item.id || ""),
            primary: item.primary === true,
        }))
        .filter((item: GoogleCalendarItem) => item.id);
    return calendars.length
        ? calendars
        : [{ id: "primary", summary: "primary", primary: true }];
}

function pad(value: number): string {
    return String(value).padStart(2, "0");
}

function formatOffset(date: Date): string {
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    const abs = Math.abs(offset);
    return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function plusMinutes(isoLike: string, minutes: number): string {
    const date = new Date(isoLike);
    date.setMinutes(date.getMinutes() + minutes);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${formatOffset(date)}`;
}

function reminderMinutes(dueAt: string, remindAt?: string | null): number {
    if (!remindAt) return 30;
    const diff = new Date(dueAt).getTime() - new Date(remindAt).getTime();
    if (!Number.isFinite(diff) || diff <= 0) return 30;
    return Math.max(1, Math.round(diff / 60000));
}

export async function createGoogleCalendarEvent(
    input: CalendarEventInput,
): Promise<string> {
    const token = await ensureGoogleCalendarToken();
    const body = {
        summary: input.title,
        description: input.description || "",
        start: {
            dateTime: input.dueAt,
            timeZone: input.timezone,
        },
        end: {
            dateTime: plusMinutes(input.dueAt, 30),
            timeZone: input.timezone,
        },
        reminders: {
            useDefault: false,
            overrides: [
                {
                    method: "popup",
                    minutes: reminderMinutes(input.dueAt, input.remindAt),
                },
            ],
        },
    };
    const event = await googleFetch<any>(
        token,
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events`,
        {
            method: "POST",
            body: JSON.stringify(body),
        },
    );
    if (!event?.id) throw new Error("Google Calendar event id is missing");
    return String(event.id);
}
