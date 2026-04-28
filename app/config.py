from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_CONFIG_PATH = "config.json"
DEFAULT_DOTENV_PATH = ".env"
DEFAULT_AUTH_API_BASE = "http://127.0.0.1:8001"
DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:8001"
DEFAULT_STT_PROFILES: dict[str, dict[str, Any]] = {
    "default": {
        "frame_ms": 20,
        "calibration_seconds": 1.2,
        "start_multiplier": 2.8,
        "end_multiplier": 1.8,
        "min_start_ms": 80,
        "min_end_ms": 280,
        "noise_ema_alpha": 0.08,
        "min_rms_floor": 0.003,
        "pre_roll_ms": 120,
        "partial_interval_ms": 600,
    },
    "ultra_low_latency": {
        "frame_ms": 10,
        "calibration_seconds": 0.8,
        "start_multiplier": 2.6,
        "end_multiplier": 1.7,
        "min_start_ms": 40,
        "min_end_ms": 160,
        "noise_ema_alpha": 0.1,
        "min_rms_floor": 0.003,
        "pre_roll_ms": 60,
        "partial_interval_ms": 220,
    },
}


@dataclass(frozen=True)
class STTProfileSettings:
    frame_ms: int
    calibration_seconds: float
    start_multiplier: float
    end_multiplier: float
    min_start_ms: int
    min_end_ms: int
    noise_ema_alpha: float
    min_rms_floor: float
    pre_roll_ms: int
    partial_interval_ms: int

    @classmethod
    def from_mapping(cls, source: dict[str, Any]) -> "STTProfileSettings":
        return cls(
            frame_ms=int(source["frame_ms"]),
            calibration_seconds=float(source["calibration_seconds"]),
            start_multiplier=float(source["start_multiplier"]),
            end_multiplier=float(source["end_multiplier"]),
            min_start_ms=int(source["min_start_ms"]),
            min_end_ms=int(source["min_end_ms"]),
            noise_ema_alpha=float(source["noise_ema_alpha"]),
            min_rms_floor=float(source["min_rms_floor"]),
            pre_roll_ms=int(source["pre_roll_ms"]),
            partial_interval_ms=int(source["partial_interval_ms"]),
        )


@dataclass(frozen=True)
class OllamaSettings:
    base_url: str = DEFAULT_OLLAMA_BASE_URL
    timeout: float = 60.0

    @classmethod
    def from_mapping(cls, source: dict[str, Any]) -> "OllamaSettings":
        return cls(
            base_url=str(source.get("base_url", DEFAULT_OLLAMA_BASE_URL)),
            timeout=float(source.get("timeout", 60.0)),
        )


@dataclass(frozen=True)
class Settings:
    config_path: str
    host: str
    port: int
    env: str
    auth_api_base: str
    auth_username: str
    auth_password: str
    auth_jwt_secret: str
    auth_token_expire_hours: int
    stt_model_name: str
    stt_device: str
    stt_compute_type: str
    stt_language: str
    stt_sample_rate: int
    stt_default_profile: str
    stt_profiles: dict[str, STTProfileSettings]
    stt_emit_debug_state: bool
    stt_cpu_threads: int
    ollama: OllamaSettings


def _safe_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _load_dotenv_into_environ(path: str | None = None) -> None:
    dotenv_path = Path(path or os.getenv("USERSPACE_DOTENV_PATH", DEFAULT_DOTENV_PATH))
    if not dotenv_path.exists():
        return

    try:
        lines = dotenv_path.read_text(encoding="utf-8").splitlines()
    except Exception:
        return

    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        if not key:
            continue

        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]

        os.environ.setdefault(key, value)


def _normalize_base_url(value: str, default: str) -> str:
    normalized = value.strip() or default
    return normalized.rstrip("/")


def _load_raw_config(config_path: str) -> dict[str, Any]:
    path = Path(config_path)
    if not path.exists():
        return {}
    try:
        return _safe_dict(json.loads(path.read_text(encoding="utf-8")))
    except Exception:
        return {}


def _build_profiles(source: dict[str, Any]) -> dict[str, STTProfileSettings]:
    raw_profiles = _safe_dict(source.get("profiles"))
    profiles: dict[str, STTProfileSettings] = {}

    for name, default_values in DEFAULT_STT_PROFILES.items():
        overrides = _safe_dict(raw_profiles.get(name))
        merged = {**default_values, **overrides}
        profiles[name] = STTProfileSettings.from_mapping(merged)

    for name, values in raw_profiles.items():
        if name in profiles:
            continue
        merged = {**DEFAULT_STT_PROFILES["default"], **_safe_dict(values)}
        profiles[name] = STTProfileSettings.from_mapping(merged)

    return profiles


def load_settings(config_path: str | None = None) -> Settings:
    _load_dotenv_into_environ()

    path = config_path or os.getenv("USERSPACE_CONFIG_PATH", DEFAULT_CONFIG_PATH)
    raw = _load_raw_config(path)
    auth = _safe_dict(raw.get("auth"))
    server = _safe_dict(raw.get("server"))
    stt = _safe_dict(raw.get("stt"))
    ollama_raw = _safe_dict(raw.get("ollama"))
    profiles = _build_profiles(stt)

    default_profile = str(stt.get("default_profile", "default"))
    if default_profile not in profiles:
        default_profile = "default"

    host = str(os.getenv("USERSPACE_HOST", str(server.get("host", "127.0.0.1")))).strip()
    if not host:
        host = "127.0.0.1"
    port = int(os.getenv("USERSPACE_PORT", str(server.get("port", 8765))))

    auth_api_base = _normalize_base_url(
        os.getenv(
            "AUTH_API_BASE",
            str(server.get("auth_api_base", DEFAULT_AUTH_API_BASE)),
        ),
        DEFAULT_AUTH_API_BASE,
    )
    ollama_base_url = _normalize_base_url(
        os.getenv(
            "OLLAMA_BASE_URL",
            str(ollama_raw.get("base_url", DEFAULT_OLLAMA_BASE_URL)),
        ),
        DEFAULT_OLLAMA_BASE_URL,
    )
    ollama_timeout = float(ollama_raw.get("timeout", 60.0))

    return Settings(
        config_path=path,
        host=host,
        port=port,
        env=str(server.get("env", "dev")),
        auth_api_base=auth_api_base,
        auth_username=str(auth.get("username", "admin")),
        auth_password=str(auth.get("password", "jarvis")),
        auth_jwt_secret=str(auth.get("jwt_secret", "jarvis-secret-key-change-me")),
        auth_token_expire_hours=int(auth.get("token_expire_hours", 24)),
        stt_model_name=str(stt.get("model_name", "small")),
        stt_device=str(stt.get("device", "cpu")),
        stt_compute_type=str(stt.get("compute_type", "int8")),
        stt_language=str(stt.get("language", "ko")),
        stt_sample_rate=int(stt.get("sample_rate", 16000)),
        stt_default_profile=default_profile,
        stt_profiles=profiles,
        stt_emit_debug_state=bool(stt.get("emit_debug_state", False)),
        stt_cpu_threads=int(stt.get("cpu_threads", 4)),
        ollama=OllamaSettings(base_url=ollama_base_url, timeout=ollama_timeout),
    )


settings = load_settings()
