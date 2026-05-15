from __future__ import annotations

import os
import signal
import subprocess
import sys
import threading
from typing import Any

import uvicorn

from app.config import settings


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name, "1" if default else "0").strip().lower()
    return value in {"1", "true", "yes", "on"}


def _pipe(stream, prefix: str) -> None:
    assert stream is not None
    for line in iter(stream.readline, b""):
        sys.stdout.write(f"[{prefix}] {line.decode(errors='replace')}")
        sys.stdout.flush()


def _build_vision_env() -> dict[str, str]:
    env = {**os.environ}
    env["VITE_VISION_AUTO_START"] = env.get("VITE_VISION_AUTO_START", "1")
    env["VITE_VISION_AUTO_CONTROL"] = env.get("VITE_VISION_AUTO_CONTROL", "1")
    env["VITE_VISION_TRIGGER_ENABLE"] = env.get("VITE_VISION_TRIGGER_ENABLE", "1")
    env["JARVIS_VISION_DEV_PORT"] = env.get("JARVIS_VISION_DEV_PORT", "5174")
    return env


def _spawn_child(cmd: list[str], *, cwd: str, env: dict[str, str], process_label: str) -> subprocess.Popen | None:
    npm = "npm.cmd" if sys.platform == "win32" else "npm"
    if cmd[0] == "npm":
        cmd[0] = npm

    kwargs: dict[str, Any] = {
        "cwd": cwd,
        "env": env,
        "stdout": subprocess.PIPE,
        "stderr": subprocess.PIPE,
    }

    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["preexec_fn"] = os.setsid

    try:
        proc = subprocess.Popen(cmd, **kwargs)
    except FileNotFoundError:
        print(f"[run] {process_label} launch failed: npm not found", flush=True)
        return None
    except Exception as exc:
        print(f"[run] {process_label} launch failed: {exc}", flush=True)
        return None

    threading.Thread(target=_pipe, args=(proc.stdout, process_label), daemon=True).start()
    threading.Thread(target=_pipe, args=(proc.stderr, process_label), daemon=True).start()
    print(f"[run] {process_label} started (pid={proc.pid})", flush=True)
    return proc


def start_electron(userspace_root: str) -> subprocess.Popen | None:
    """Launch the Electron UI as a child process."""
    ui_dir = os.path.join(userspace_root, "ui")
    if not os.path.isdir(ui_dir):
        print("[run] ui/ directory not found, skipping Electron", flush=True)
        return None

    env = {
        **os.environ,
        "USERSPACE_HOST": settings.host,
        "USERSPACE_PORT": str(settings.port),
        "AUTH_API_BASE": settings.auth_api_base,
        "JARVIS_USERSPACE_AUTH_DISABLED": os.getenv("JARVIS_USERSPACE_AUTH_DISABLED", "0"),
    }
    env.setdefault("PYTHON", sys.executable)
    return _spawn_child(["npm", "run", "start"], cwd=ui_dir, env=env, process_label="electron")


def start_vision(userspace_root: str) -> subprocess.Popen | None:
    """Launch the vision desktop runtime as a child process."""
    if not _env_bool("JARVIS_VISION_ENABLE", default=True):
        print("[run] JARVIS_VISION_ENABLE=0, skipping vision launch", flush=True)
        return None

    vision_dir = os.path.join(os.path.dirname(userspace_root), "jarvis_vision")
    if not os.path.isdir(vision_dir):
        print("[run] jarvis_vision/ directory not found, skipping vision launch", flush=True)
        return None

    return _spawn_child(
        ["npm", "run", "desktop"],
        cwd=vision_dir,
        env=_build_vision_env(),
        process_label="vision",
    )


def main() -> None:
    userspace_root = os.path.dirname(os.path.abspath(__file__))
    electron_proc: subprocess.Popen | None = None
    vision_proc: subprocess.Popen | None = None
    os.environ.setdefault("JARVIS_USERSPACE_AUTH_DISABLED", "0")

    def _cleanup(*_args) -> None:
        nonlocal electron_proc, vision_proc

        def _kill_process(process_name: str, process_obj: subprocess.Popen | None) -> None:
            if not process_obj:
                return
            if process_obj.poll() is not None:
                return

            print(f"[run] Stopping {process_name}...", flush=True)
            if sys.platform == "win32":
                process_obj.send_signal(signal.CTRL_BREAK_EVENT)
                try:
                    process_obj.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process_obj.kill()
                return

            try:
                os.killpg(os.getpgid(process_obj.pid), signal.SIGTERM)
            except ProcessLookupError:
                process_obj.terminate()
            except Exception:
                process_obj.terminate()
            try:
                process_obj.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process_obj.kill()

        _kill_process("vision", vision_proc)
        _kill_process("electron", electron_proc)
        vision_proc = None
        if electron_proc and electron_proc.poll() is None:
            electron_proc = None

    signal.signal(signal.SIGINT, lambda *a: (_cleanup(), sys.exit(0)))
    signal.signal(signal.SIGTERM, lambda *a: (_cleanup(), sys.exit(0)))

    # 1) Start Electron UI
    electron_proc = start_electron(userspace_root)
    # 2) Start Vision Electron runtime with the userspace app by default.
    vision_proc = start_vision(userspace_root)

    # 3) Start Python backend (blocking)
    try:
        uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=False)
    finally:
        _cleanup()


if __name__ == "__main__":
    main()
