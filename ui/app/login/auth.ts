export type Mode = "login" | "register";

export interface AuthResult {
    token?: string;
    error?: string;
}

async function resolveAuthBaseUrl(): Promise<string> {
    const bridge = (window as any).jarvisBridge;
    if (!bridge?.getUserspaceConfig) {
        throw new Error("Userspace config bridge is unavailable");
    }

    const config = await bridge.getUserspaceConfig();
    const candidate =
        typeof config?.authApiBase === "string" ? config.authApiBase.trim() : "";
    if (!candidate) {
        throw new Error("AUTH_API_BASE is not configured");
    }

    return candidate.replace(/\/+$/, "");
}

export async function verifyToken(token: string): Promise<boolean> {
    try {
        const base = await resolveAuthBaseUrl();
        const res = await fetch(`${base}/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        return res.ok;
    } catch (_) {
        return false;
    }
}

export async function login(email: string, password: string): Promise<AuthResult> {
    try {
        const base = await resolveAuthBaseUrl();
        const res = await fetch(`${base}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: email, password }),
        });
        const data = await res.json();
        if (res.ok && data.access_token) {
            return { token: data.access_token };
        }
        return { error: data.detail || data.message || "Authentication failed" };
    } catch (_) {
        return { error: "Cannot connect to server" };
    }
}

export async function signup(
    email: string,
    password: string,
    name: string,
): Promise<AuthResult> {
    try {
        const base = await resolveAuthBaseUrl();
        const res = await fetch(`${base}/auth/signup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password, name }),
        });
        const data = await res.json();
        if (res.ok && data.access_token) {
            return { token: data.access_token };
        }
        return { error: data.detail || data.message || "Registration failed" };
    } catch (_) {
        return { error: "Cannot connect to server" };
    }
}
