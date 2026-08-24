"""Read-only system and process inspection actions."""

from __future__ import annotations

import asyncio
import os
import platform
import shutil
import subprocess
from typing import Any

from app.actions.handlers.base import HandlerError
from app.actions.models import ClientAction
from app.client_context import list_available_application_profiles


async def system_info(action: ClientAction) -> dict[str, Any]:
    del action
    usage = shutil.disk_usage(os.getcwd())
    return {
        "platform": platform.system().lower(),
        "platform_release": platform.release(),
        "architecture": platform.machine(),
        "hostname": platform.node(),
        "cpu_count": os.cpu_count(),
        "working_directory": os.getcwd(),
        "disk": {"total": usage.total, "used": usage.used, "free": usage.free},
    }


async def process_list(action: ClientAction) -> dict[str, Any]:
    limit = max(1, min(int(action.args.get("limit", 100)), 500))

    def collect() -> list[dict[str, Any]]:
        if os.name == "nt":
            command = ["tasklist", "/FO", "CSV", "/NH"]
        else:
            command = ["ps", "-axo", "pid=,comm="]
        completed = subprocess.run(command, capture_output=True, text=True, timeout=10, check=False)
        if completed.returncode != 0:
            raise HandlerError(completed.stderr.strip() or "failed to list processes")
        rows: list[dict[str, Any]] = []
        if os.name == "nt":
            import csv
            for fields in csv.reader(completed.stdout.splitlines()):
                if len(fields) >= 2:
                    rows.append({"name": fields[0], "pid": int(fields[1])})
        else:
            for line in completed.stdout.splitlines():
                parts = line.strip().split(maxsplit=1)
                if len(parts) == 2 and parts[0].isdigit():
                    rows.append({"pid": int(parts[0]), "name": parts[1]})
        return rows[:limit]

    processes = await asyncio.to_thread(collect)
    return {"processes": processes, "count": len(processes), "limit": limit}


async def application_list(action: ClientAction) -> dict[str, Any]:
    limit = max(1, min(int(action.args.get("limit", 200)), 1000))
    if os.name == "nt":
        def windows_apps() -> list[dict[str, Any]]:
            roots = [
                os.path.join(os.getenv("ProgramData", ""), "Microsoft", "Windows", "Start Menu", "Programs"),
                os.path.join(os.getenv("APPDATA", ""), "Microsoft", "Windows", "Start Menu", "Programs"),
            ]
            found: dict[str, dict[str, Any]] = {}
            for root in roots:
                if not root or not os.path.isdir(root):
                    continue
                for current, _, files in os.walk(root):
                    for filename in files:
                        if not filename.lower().endswith((".lnk", ".url")):
                            continue
                        name = os.path.splitext(filename)[0]
                        found.setdefault(name.casefold(), {
                            "name": name,
                            "display_name": name,
                            "kind": "windows_shortcut",
                            "path": os.path.join(current, filename),
                        })
            return sorted(found.values(), key=lambda item: str(item["name"]).casefold())

        applications = await asyncio.to_thread(windows_apps)
    else:
        applications = await asyncio.to_thread(list_available_application_profiles)
    return {"applications": applications[:limit], "count": min(len(applications), limit)}


async def active_application(action: ClientAction) -> dict[str, Any]:
    del action
    if platform.system().lower() == "darwin":
        command = [
            "osascript", "-e",
            'tell application "System Events" to get name of first application process whose frontmost is true',
        ]
    elif os.name == "nt":
        def foreground_window() -> dict[str, Any]:
            import ctypes
            user32 = ctypes.windll.user32
            hwnd = user32.GetForegroundWindow()
            length = user32.GetWindowTextLengthW(hwnd)
            buffer = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buffer, length + 1)
            pid = ctypes.c_ulong()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            return {"name": buffer.value, "pid": int(pid.value), "window_handle": int(hwnd)}

        return await asyncio.to_thread(foreground_window)
    else:
        command = ["xdotool", "getactivewindow", "getwindowname"]
    completed = await asyncio.to_thread(
        subprocess.run, command, capture_output=True, text=True, timeout=5, check=False
    )
    if completed.returncode != 0:
        raise HandlerError(completed.stderr.strip() or "failed to get active application")
    return {"name": completed.stdout.strip()}
