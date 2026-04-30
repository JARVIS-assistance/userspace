// 백엔드 app/actions/policy.actions_to_dict()와 1:1.

export interface ToggleConfig {
    enabled: boolean;
}

export interface FileWriteConfig {
    allowed_paths: string[];
    max_bytes: number;
}

export interface TerminalConfig {
    enabled: boolean;
    allowed_commands: string[];
    cwd_allowlist: string[];
}

export interface PhysicalInputConfig {
    enabled: boolean;
    max_keystroke_chars: number;
}

export interface ScreenshotConfig {
    enabled: boolean;
    allowed_paths: string[];
}

export interface ActionsConfig {
    all_types: string[];
    enabled_types: string[];
    force_confirm_types: string[];
    file_write: FileWriteConfig;
    terminal: TerminalConfig;
    physical_input: PhysicalInputConfig;
    app_control: ToggleConfig;
    browser_control: ToggleConfig;
    web_search: ToggleConfig;
    screenshot: ScreenshotConfig;
}

// UI에 보여줄 type 라벨 (백엔드 from `all_types`가 비어있을 때 폴백).
export const FALLBACK_ALL_TYPES: string[] = [
    "notify",
    "clipboard",
    "open_url",
    "browser_control",
    "app_control",
    "web_search",
    "file_read",
    "file_write",
    "terminal",
    "screenshot",
    "mouse_click",
    "mouse_drag",
    "keyboard_type",
    "hotkey",
];

// 사람용 짧은 설명
export const TYPE_DESCRIPTIONS: Record<string, string> = {
    notify: "데스크탑 알림",
    clipboard: "클립보드 읽기/쓰기",
    open_url: "URL 열기",
    browser_control: "브라우저 제어 (스크롤/탐색)",
    app_control: "앱 실행/종료",
    web_search: "웹 검색 페이지 열기",
    file_read: "파일 읽기 (allowed_paths)",
    file_write: "파일 쓰기 (allowed_paths)",
    terminal: "쉘 명령 실행 (allowlist)",
    screenshot: "화면 캡처",
    mouse_click: "마우스 클릭 합성",
    mouse_drag: "마우스 드래그 합성",
    keyboard_type: "키보드 입력 합성",
    hotkey: "단축키 합성",
};
