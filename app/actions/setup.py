"""핸들러 → dispatcher 등록 wiring (순환 import 회피용 별도 모듈)."""

from __future__ import annotations

from app.actions.dispatcher import ActionDispatcher
from app.actions.handlers.app_control import make_app_control
from app.actions.handlers.browser_control import make_browser_control
from app.actions.handlers.clipboard import clipboard
from app.actions.handlers.file_ops import make_file_read, make_file_write
from app.actions.handlers.notify import notify
from app.actions.handlers.open_url import open_url
from app.actions.handlers.physical_input import (
    make_hotkey,
    make_keyboard_type,
    make_mouse_click,
    make_mouse_drag,
)
from app.actions.handlers.screenshot import make_screenshot
from app.actions.handlers.terminal import make_terminal
from app.actions.handlers.web_search import make_web_search
from app.config import ActionSettings


def register_default_handlers(
    dispatcher: ActionDispatcher,
    action_settings: ActionSettings | None = None,
) -> None:
    """Register all known handlers; policy gates decide what can run."""
    settings = action_settings or ActionSettings()

    dispatcher.register("notify", notify)
    dispatcher.register("clipboard", clipboard)
    dispatcher.register("open_url", open_url)
    dispatcher.register("file_read", make_file_read(settings.file_write.allowed_paths))
    dispatcher.register(
        "file_write",
        make_file_write(
            settings.file_write.allowed_paths,
            max_bytes=settings.file_write.max_bytes,
        ),
    )
    dispatcher.register(
        "terminal",
        make_terminal(
            settings.terminal.enabled,
            settings.terminal.allowed_commands,
            cwd_allowlist=settings.terminal.cwd_allowlist,
        ),
    )
    dispatcher.register("app_control", make_app_control(settings.app_control.enabled))
    dispatcher.register("browser_control", make_browser_control(settings.browser_control.enabled))
    dispatcher.register("web_search", make_web_search(settings.web_search.enabled))
    dispatcher.register(
        "screenshot",
        make_screenshot(
            settings.screenshot.enabled,
            settings.screenshot.allowed_paths,
        ),
    )
    dispatcher.register("mouse_click", make_mouse_click(settings.physical_input.enabled))
    dispatcher.register("mouse_drag", make_mouse_drag(settings.physical_input.enabled))
    dispatcher.register(
        "keyboard_type",
        make_keyboard_type(
            settings.physical_input.enabled,
            max_chars=settings.physical_input.max_keystroke_chars,
        ),
    )
    dispatcher.register("hotkey", make_hotkey(settings.physical_input.enabled))


__all__ = ["register_default_handlers"]
