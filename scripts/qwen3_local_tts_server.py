#!/usr/bin/env python3
from __future__ import annotations

import base64
import json
import os
import sys
import traceback
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("HF_HOME", str(ROOT / ".cache" / "huggingface"))

DEFAULT_MODEL = "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit"
DEFAULT_SAMPLE_RATE = 24000
_MODEL_CACHE: dict[str, Any] = {}
_LANGUAGE_ALIASES = {
    "auto": "auto",
    "korean": "korean",
    "ko": "korean",
    "english": "english",
    "en": "english",
    "chinese": "chinese",
    "zh": "chinese",
    "japanese": "japanese",
    "ja": "japanese",
    "spanish": "spanish",
    "french": "french",
    "german": "german",
    "italian": "italian",
    "portuguese": "portuguese",
    "russian": "russian",
}


def _emit(message: dict[str, Any]) -> None:
    print(json.dumps(message, ensure_ascii=False), flush=True)


def _load_model(model_name: str) -> Any:
    model_name = model_name or DEFAULT_MODEL
    if model_name not in _MODEL_CACHE:
        from mlx_audio.tts.utils import load_model

        _MODEL_CACHE[model_name] = load_model(model_name)
    return _MODEL_CACHE[model_name]


def _audio_to_pcm16(audio: Any) -> bytes:
    import numpy as np

    try:
        import mlx.core as mx

        audio = mx.eval(audio) or audio
    except Exception:
        pass

    if hasattr(audio, "tolist"):
        array = np.asarray(audio.tolist(), dtype=np.float32)
    else:
        array = np.asarray(audio, dtype=np.float32)

    if array.ndim > 1:
        array = array.reshape(-1)
    if array.size == 0:
        return b""

    array = np.nan_to_num(array, nan=0.0, posinf=1.0, neginf=-1.0)
    if array.dtype.kind == "f":
        array = np.clip(array, -1.0, 1.0)
        array = (array * 32767.0).astype("<i2")
    else:
        array = np.clip(array, -32768, 32767).astype("<i2")
    return array.tobytes()


def _get_result_audio(result: Any) -> Any:
    if hasattr(result, "audio"):
        return result.audio
    if isinstance(result, dict) and "audio" in result:
        return result["audio"]
    return result


def _language_code(value: str) -> str:
    normalized = (value or "korean").strip().lower()
    return _LANGUAGE_ALIASES.get(normalized, normalized or "korean")


def _generate(request: dict[str, Any]) -> None:
    request_id = str(request.get("id") or "")
    text = str(request.get("text") or "").strip()
    model_name = str(request.get("model") or DEFAULT_MODEL).strip() or DEFAULT_MODEL
    voice = str(request.get("voice") or "Chelsie").strip() or "Chelsie"
    language = _language_code(str(request.get("language") or "Korean"))
    instructions = str(request.get("instructions") or "").strip()
    sample_rate = int(request.get("sampleRate") or DEFAULT_SAMPLE_RATE)

    if not request_id:
        raise ValueError("missing request id")
    if not text:
        raise ValueError("missing text")

    model = _load_model(model_name)
    generate_kwargs: dict[str, Any] = {
        "voice": voice,
        "lang_code": language,
        "stream": True,
        "streaming_interval": 0.3,
        "max_tokens": int(request.get("maxTokens") or 512),
        "verbose": False,
    }
    if instructions:
        generate_kwargs["instruct"] = instructions

    _emit_start(request_id, sample_rate)

    results = model.generate(text, **generate_kwargs)
    for result in results:
        pcm = _audio_to_pcm16(_get_result_audio(result))
        if not pcm:
            continue
        _emit({
            "id": request_id,
            "type": "chunk",
            "audioBase64": base64.b64encode(pcm).decode("ascii"),
        })
    _emit({"id": request_id, "type": "end"})


def _emit_start(request_id: str, sample_rate: int) -> None:
    _emit({
        "id": request_id,
        "type": "start",
        "sampleRate": sample_rate,
        "channels": 1,
        "bitsPerSample": 16,
    })


def main() -> int:
    _emit({"type": "ready"})
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            request = json.loads(raw)
            if request.get("type") == "exit":
                return 0
            _generate(request)
        except ModuleNotFoundError as exc:
            _emit({
                "id": request.get("id") if "request" in locals() else "",
                "type": "error",
                "error": (
                    "mlx-audio is not installed. Install it with: "
                    "python3 -m pip install mlx-audio"
                ),
                "detail": str(exc),
            })
        except Exception as exc:
            _emit({
                "id": request.get("id") if "request" in locals() else "",
                "type": "error",
                "error": f"{type(exc).__name__}: {exc}",
            })
            if os.getenv("QWEN3_LOCAL_DEBUG"):
                traceback.print_exc(file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
