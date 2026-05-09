export const EXTERNAL_ACTION_TYPES = new Set([
    "terminal",
    "app_control",
    "file_write",
    "file_read",
    "open_url",
    "browser",
    "browser.open",
    "browser.navigate",
    "browser.search",
    "browser.select_result",
    "browser.extract_dom",
    "browser.click",
    "browser.type",
    "browser_control",
    "web_search",
    "mouse_click",
    "mouse_drag",
    "keyboard_type",
    "hotkey",
    "screenshot",
]);

export function isExternalActionType(type: string): boolean {
    return EXTERNAL_ACTION_TYPES.has(type);
}

export function formatProgressText(value: string): string {
    const text = value
        .replace(/\s*하는중\.{0,3}\s*$/u, "")
        .replace(/\s*진행중\.{0,3}\s*$/u, "")
        .trim();
    return text ? `${text} 하는중...` : "";
}

export function nextActionText(type: string, command: string, error: string): string {
    if (isMacOsPermissionError(error)) {
        return `${command} 입력 권한이 없어 실패했습니다. macOS 설정 > 개인정보 보호 및 보안 > 손쉬운 사용/자동화에서 JARVIS, Electron 또는 터미널 권한을 허용한 뒤 다시 시도하세요.`;
    }
    if (/client action result timed out|result timed out|timed out/i.test(error)) {
        if (type === "app_control") {
            return `${command} 실행 결과가 제시간에 확인되지 않았습니다. 앱이 설치되어 있지 않다면 Chrome 또는 Safari로 다시 시도하세요.`;
        }
        return "외부 작업 결과가 제시간에 확인되지 않았습니다. 같은 작업을 다시 시도하거나 다른 방법을 선택하세요.";
    }
    if (type === "app_control" && /invalid app_control target:\s*browser/i.test(error)) {
        return "백엔드가 브라우저를 추상 앱 이름으로 보냈습니다. URL 열기는 open_url로, 앱 실행은 Chrome/Safari 같은 실제 앱 이름으로 보내야 합니다.";
    }
    if (type === "app_control" && /not found|찾을 수|없/i.test(error)) {
        return `${command} 실행에 실패했습니다. 설치되어 있지 않은 앱이면 Chrome 또는 Safari로 다시 시도하세요.`;
    }
    if (
        type === "browser"
        || type === "browser_control"
        || type === "open_url"
        || type === "web_search"
    ) {
        if (/JavaScript from Apple Events|Apple Events/i.test(error)) {
            return "Chrome 설정에서 View > Developer > Allow JavaScript from Apple Events를 켠 뒤 다시 시도하세요.";
        }
        if (/no active browser tab/i.test(error)) {
            return "활성 브라우저 탭을 찾지 못했습니다. 검색 결과 탭을 앞으로 가져온 뒤 다시 시도하세요.";
        }
        return "브라우저 작업에 실패했습니다. 기본 브라우저 또는 다른 브라우저로 다시 시도하세요.";
    }
    return `외부 작업에 실패했습니다. ${error}`;
}

export function waitingMessage(): string {
    return WAITING_MESSAGES[Math.floor(Math.random() * WAITING_MESSAGES.length)];
}

function isMacOsPermissionError(error: string): boolean {
    return /os_permission_missing|System Events|not authorized|accessibility|허용되지 않습니다|not allowed assistive access/i.test(error);
}

const WAITING_MESSAGES = [
    "잠시만요!",
    "바로 확인할게요.",
    "처리하고 있어요.",
    "준비 중이에요.",
    "곧 이어서 진행할게요.",
];
