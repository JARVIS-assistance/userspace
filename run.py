from __future__ import annotations

import os
import signal
import subprocess
import sys
import threading

import uvicorn

from app.config import settings


def start_electron(userspace_root: str) -> subprocess.Popen | None:
    """Launch the Electron UI as a child process."""
    ui_dir = os.path.join(userspace_root, "ui")
    if not os.path.isdir(ui_dir):
        print("[run] ui/ directory not found, skipping Electron", flush=True)
        return None

    npm = "npm.cmd" if sys.platform == "win32" else "npm"
    env = {
        **os.environ,
        "USERSPACE_HOST": settings.host,
        "USERSPACE_PORT": str(settings.port),
    }

    try:
        proc = subprocess.Popen(
            [npm, "run", "start"],
            cwd=ui_dir,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except FileNotFoundError:
        print("[run] npm not found, skipping Electron", flush=True)
        return None

    def _pipe(stream, prefix: str) -> None:
        assert stream is not None
        for line in iter(stream.readline, b""):
            sys.stdout.write(f"[{prefix}] {line.decode(errors='replace')}")
            sys.stdout.flush()

    threading.Thread(target=_pipe, args=(proc.stdout, "electron"), daemon=True).start()
    threading.Thread(target=_pipe, args=(proc.stderr, "electron"), daemon=True).start()

    print(f"[run] Electron started (pid={proc.pid})", flush=True)
    return proc


def main() -> None:
    userspace_root = os.path.dirname(os.path.abspath(__file__))
    electron_proc: subprocess.Popen | None = None

    def _cleanup(*_args) -> None:
        nonlocal electron_proc
        if electron_proc and electron_proc.poll() is None:
            print("[run] Stopping Electron...", flush=True)
            electron_proc.terminate()
            try:
                electron_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                electron_proc.kill()
            electron_proc = None

    signal.signal(signal.SIGINT, lambda *a: (_cleanup(), sys.exit(0)))
    signal.signal(signal.SIGTERM, lambda *a: (_cleanup(), sys.exit(0)))

    # 1) Start Electron UI
    electron_proc = start_electron(userspace_root)

    # 2) Start Python backend (blocking)
    try:
        uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=False)
    finally:
        _cleanup()


if __name__ == "__main__":
    main()
