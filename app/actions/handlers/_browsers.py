"""URL을 특정 브라우저에 띄우는 공용 헬퍼.

`webbrowser.open()`은 macOS에서 시스템 기본 브라우저(보통 Safari)로 라우팅한다.
유저가 Chrome을 켜둔 상태에서 URL이 Safari로 가면 의도와 어긋나므로,
명시적으로 브라우저 앱을 지정해서 연다.

전략:
- macOS: `open -a "Google Chrome" URL`
- Linux:
    - 알려진 브라우저 → 해당 바이너리 직접 실행 (예: google-chrome URL)
    - 알 수 없거나 'default' → xdg-open / webbrowser.open
- Windows: `start <browser> URL` (Phase 1: webbrowser fallback)
- 다른 OS: webbrowser.open
"""

from __future__ import annotations

import asyncio
import shutil
import sys
import webbrowser

# 정규화된 별칭 → macOS bundle 이름
_MACOS_APPS: dict[str, str] = {
    "chrome": "Google Chrome",
    "google chrome": "Google Chrome",
    "google-chrome": "Google Chrome",
    "safari": "Safari",
    "firefox": "Firefox",
    "edge": "Microsoft Edge",
    "microsoft edge": "Microsoft Edge",
    "brave": "Brave Browser",
    "arc": "Arc",
}

# Linux 별칭 → 실행 바이너리 후보
_LINUX_BINARIES: dict[str, list[str]] = {
    "chrome": ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"],
    "google chrome": ["google-chrome", "google-chrome-stable"],
    "firefox": ["firefox"],
    "edge": ["microsoft-edge", "microsoft-edge-stable"],
    "brave": ["brave-browser", "brave"],
}

DEFAULT_BROWSER = "chrome"


def _normalize(browser: str) -> str:
    return (browser or "").strip().lower()


async def open_in_browser(url: str, browser: str = DEFAULT_BROWSER) -> str:
    """Open `url` in the specified browser. Returns the human-readable browser name actually used.

    Raises RuntimeError on failure.
    """
    name = _normalize(browser) or DEFAULT_BROWSER

    if name in {"default", "system", ""}:
        return await _open_default(url)

    if sys.platform == "darwin":
        return await _open_macos(url, name)

    if sys.platform.startswith("linux"):
        return await _open_linux(url, name)

    # Windows / others: 일단 default로 폴백
    return await _open_default(url)


# ── platform-specific ─────────────────────────────────


async def _open_default(url: str) -> str:
    ok = await asyncio.to_thread(webbrowser.open, url, 2, True)
    if not ok:
        raise RuntimeError("webbrowser.open returned False")
    return "default"


async def _open_macos(url: str, name: str) -> str:
    app = _MACOS_APPS.get(name, name)  # 모르는 이름이면 그대로 시도
    proc = await asyncio.create_subprocess_exec(
        "open",
        "-a",
        app,
        url,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, err = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(
            f"open -a {app!r} failed rc={proc.returncode}: "
            f"{err.decode(errors='replace').strip()[:300]}"
        )
    return app


async def _open_linux(url: str, name: str) -> str:
    candidates = _LINUX_BINARIES.get(name)
    if candidates:
        for binary in candidates:
            if shutil.which(binary):
                proc = await asyncio.create_subprocess_exec(
                    binary,
                    url,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.PIPE,
                )
                _, err = await proc.communicate()
                if proc.returncode == 0:
                    return binary
                raise RuntimeError(
                    f"{binary} failed rc={proc.returncode}: "
                    f"{err.decode(errors='replace').strip()[:300]}"
                )
    # 폴백
    return await _open_default(url)
