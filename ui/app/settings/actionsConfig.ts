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

export interface BrowserConfig {
    default_browser: "chrome" | "safari" | "firefox" | "edge" | "default" | string;
    search_engine: "google" | "naver" | "duckduckgo" | string;
}

export interface ActionsConfig {
    all_types: string[];
    all_capabilities: string[];
    enabled_types: string[];
    force_confirm_types: string[];
    enabled_capabilities: string[];
    force_confirm_capabilities: string[];
    browser: BrowserConfig;
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

export const FALLBACK_ALL_CAPABILITIES: string[] = [
    "browser.open",
    "browser.navigate",
    "browser.search",
    "browser.select_result",
    "browser.extract_dom",
    "browser.click",
    "browser.type",
    "app.open",
    "app.focus",
    "keyboard.type",
    "keyboard.hotkey",
    "mouse.click",
    "mouse.drag",
    "screen.screenshot",
    "terminal.run",
    "file.read",
    "file.write",
    "clipboard.copy",
    "clipboard.paste",
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

export const CAPABILITY_DESCRIPTIONS: Record<string, string> = {
    "browser.open": "브라우저 앱 열기",
    "browser.navigate": "구조화된 URL로 이동",
    "browser.search": "구조화된 query를 검색 URL로 변환해 열기",
    "browser.select_result": "현재 검색 결과의 N번째 항목 열기",
    "browser.extract_dom": "현재 탭 DOM 요약",
    "browser.click": "브라우저 요소 클릭",
    "browser.type": "브라우저 요소 입력",
    "app.open": "앱 열기",
    "app.focus": "앱 포커스",
    "keyboard.type": "키보드 텍스트 입력",
    "keyboard.hotkey": "단축키 입력",
    "mouse.click": "마우스 클릭",
    "mouse.drag": "마우스 드래그",
    "screen.screenshot": "화면 캡처",
    "terminal.run": "터미널 명령 실행",
    "file.read": "파일 읽기",
    "file.write": "파일 쓰기",
    "clipboard.copy": "클립보드 복사",
    "clipboard.paste": "클립보드 붙여넣기",
};
