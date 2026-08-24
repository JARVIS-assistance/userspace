"""핸들러 → dispatcher 등록 wiring (순환 import 회피용 별도 모듈)."""

from __future__ import annotations

from app.actions.dispatcher import ActionDispatcher
from app.actions.handlers.app_control import make_app_control
from app.actions.handlers.browser import make_browser
from app.actions.handlers.browser_control import make_browser_control
from app.actions.handlers.calendar_control import make_calendar_control
from app.actions.handlers.clipboard import clipboard
from app.actions.handlers.file_ops import make_file_list, make_file_manage, make_file_read, make_file_search, make_file_write
from app.actions.handlers.notify import notify
from app.actions.handlers.open_url import make_open_url
from app.actions.handlers.physical_input import (
    make_hotkey,
    make_key_press,
    make_keyboard_type,
    make_mouse_click,
    make_mouse_drag,
    make_mouse_move,
    make_mouse_position,
    make_mouse_scroll,
)
from app.actions.handlers.screen_stream import make_screen_stream
from app.actions.handlers.screenshot import make_screen_inspect, make_screenshot
from app.actions.handlers.system_info import active_application, application_list, process_list, system_info
from app.actions.handlers.terminal import make_terminal
from app.actions.handlers.todo import make_todo
from app.actions.handlers.web_search import make_web_search
from app.config import ActionSettings


def register_default_handlers(
    dispatcher: ActionDispatcher,
    action_settings: ActionSettings | None = None,
    *,
    todo_api_base: str = "",
    auth_token: str = "",
) -> None:
    """Register all known handlers; policy gates decide what can run."""
    settings = action_settings or ActionSettings()

    browser_handler = make_browser(
        enabled_capabilities=set(settings.enabled_capabilities),
        default_browser=settings.browser.default_browser,
        search_engine=settings.browser.search_engine,
    )
    dispatcher.register("browser", browser_handler)
    dispatcher.register("browser.open", browser_handler)
    dispatcher.register("browser.navigate", browser_handler)
    dispatcher.register("browser.search", browser_handler)
    dispatcher.register("notify", notify)
    dispatcher.register("notification.show", notify)
    dispatcher.register("clipboard", clipboard)
    dispatcher.register("clipboard.copy", clipboard)
    dispatcher.register("clipboard.paste", clipboard)
    dispatcher.register("open_url", make_open_url(settings.browser.default_browser))
    file_read_handler = make_file_read(settings.file_write.allowed_paths)
    file_list_handler = make_file_list(settings.file_write.allowed_paths)
    file_search_handler = make_file_search(settings.file_write.allowed_paths)

    async def file_read_router(action):
        command = str(action.command or "read").lower()
        if command == "list":
            return await file_list_handler(action)
        if command == "search":
            return await file_search_handler(action)
        return await file_read_handler(action)

    dispatcher.register("file_read", file_read_router)
    dispatcher.register("file.read", file_read_handler)
    dispatcher.register("file.list", file_list_handler)
    dispatcher.register("file.search", file_search_handler)
    file_write_handler = make_file_write(
        settings.file_write.allowed_paths,
        max_bytes=settings.file_write.max_bytes,
    )
    dispatcher.register("file.write", file_write_handler)
    dispatcher.register(
        "file_write",
        file_write_handler,
    )
    file_manage_handler = make_file_manage(settings.file_write.allowed_paths)
    dispatcher.register("file_manage", file_manage_handler)
    dispatcher.register("file.mkdir", file_manage_handler)
    dispatcher.register("file.move", file_manage_handler)
    dispatcher.register("file.delete", file_manage_handler)
    async def system_info_router(action):
        command = str(action.command or "info").lower()
        if command in {"processes", "process_list"}:
            return await process_list(action)
        if command in {"applications", "application_list"}:
            return await application_list(action)
        if command == "active_app":
            return await active_application(action)
        return await system_info(action)

    dispatcher.register("system_info", system_info_router)
    dispatcher.register("system.info", system_info)
    dispatcher.register("process.list", process_list)
    dispatcher.register("application.list", application_list)
    dispatcher.register("app.active", active_application)
    terminal_handler = make_terminal(
        settings.terminal.enabled,
        settings.terminal.allowed_commands,
        cwd_allowlist=settings.terminal.cwd_allowlist,
    )
    dispatcher.register("terminal", terminal_handler)
    dispatcher.register("terminal.run", terminal_handler)
    app_control_handler = make_app_control(settings.app_control.enabled)
    dispatcher.register("app_control", app_control_handler)
    dispatcher.register("app.open", app_control_handler)
    dispatcher.register("app.focus", app_control_handler)
    dispatcher.register("app.close", app_control_handler)
    browser_control_handler = make_browser_control(
        settings.browser_control.enabled,
        default_browser=settings.browser.default_browser,
    )
    dispatcher.register("browser_control", browser_control_handler)
    dispatcher.register("browser.extract_dom", browser_control_handler)
    dispatcher.register("browser.click", browser_control_handler)
    dispatcher.register("browser.type", browser_control_handler)
    dispatcher.register("browser.select_result", browser_control_handler)
    dispatcher.register("web_search", make_web_search(settings.web_search.enabled))
    dispatcher.register(
        "calendar_control",
        make_calendar_control(settings.calendar_control.enabled),
    )
    screenshot_handler = make_screenshot(
        settings.screenshot.enabled,
        settings.screenshot.allowed_paths,
    )
    dispatcher.register("screenshot", screenshot_handler)
    dispatcher.register("screen.screenshot", screenshot_handler)
    screen_inspect_handler = make_screen_inspect(settings.screenshot.enabled)
    dispatcher.register("screen.size", screen_inspect_handler)
    dispatcher.register("screen.pixel", screen_inspect_handler)
    screen_stream_handler = make_screen_stream(
        settings.screen_stream.enabled,
        api_base=todo_api_base,
        auth_token=auth_token,
    )
    dispatcher.register("screen_stream", screen_stream_handler)
    dispatcher.register("screen.stream_start", screen_stream_handler)
    dispatcher.register("screen.stream_stop", screen_stream_handler)
    mouse_click_handler = make_mouse_click(settings.physical_input.enabled)
    dispatcher.register("mouse_click", mouse_click_handler)
    dispatcher.register("mouse.click", mouse_click_handler)
    mouse_drag_handler = make_mouse_drag(settings.physical_input.enabled)
    dispatcher.register("mouse_drag", mouse_drag_handler)
    dispatcher.register("mouse.drag", mouse_drag_handler)
    mouse_move_handler = make_mouse_move(settings.physical_input.enabled)
    mouse_position_handler = make_mouse_position(settings.physical_input.enabled)

    async def mouse_move_router(action):
        if str(action.command or "").lower() in {"position", "get_position"}:
            return await mouse_position_handler(action)
        return await mouse_move_handler(action)

    dispatcher.register("mouse_move", mouse_move_router)
    dispatcher.register("mouse.move", mouse_move_handler)
    mouse_scroll_handler = make_mouse_scroll(settings.physical_input.enabled)
    dispatcher.register("mouse_scroll", mouse_scroll_handler)
    dispatcher.register("mouse.scroll", mouse_scroll_handler)
    dispatcher.register("mouse.position", mouse_position_handler)
    keyboard_type_handler = make_keyboard_type(
        settings.physical_input.enabled,
        max_chars=settings.physical_input.max_keystroke_chars,
    )
    dispatcher.register("keyboard_type", keyboard_type_handler)
    dispatcher.register("keyboard.type", keyboard_type_handler)
    key_press_handler = make_key_press(settings.physical_input.enabled)
    dispatcher.register("key_press", key_press_handler)
    dispatcher.register("keyboard.press", key_press_handler)
    hotkey_handler = make_hotkey(settings.physical_input.enabled)
    dispatcher.register("hotkey", hotkey_handler)
    dispatcher.register("keyboard.hotkey", hotkey_handler)
    todo_handler = make_todo(todo_api_base, auth_token)
    dispatcher.register("todo", todo_handler)
    dispatcher.register("todo.create", todo_handler)
    dispatcher.register("todo.update", todo_handler)
    dispatcher.register("todo.delete", todo_handler)


__all__ = ["register_default_handlers"]
