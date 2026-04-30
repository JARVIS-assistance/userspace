from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("HF_HOME", str(ROOT / ".cache" / "huggingface"))
os.environ.setdefault("NUMBA_CACHE_DIR", str(ROOT / ".cache" / "numba"))


def _device() -> str:
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


def _float(value: Any, default: float) -> float:
    try:
        return float(value)
    except Exception:
        return default


def main() -> int:
    try:
        request = json.loads(sys.stdin.read() or "{}")
        text = str(request.get("text") or "").strip()
        output_path = Path(str(request.get("outputPath") or "")).expanduser()
        if not text:
            raise ValueError("missing text")
        if not output_path:
            raise ValueError("missing outputPath")

        import torchaudio as ta

        model_name = str(request.get("model") or "multilingual").strip().lower()
        device = _device()
        audio_prompt = str(request.get("audioPromptPath") or "").strip()
        audio_prompt_path = audio_prompt if audio_prompt else None
        exaggeration = _float(request.get("exaggeration"), 0.5)
        cfg_weight = _float(request.get("cfgWeight"), 0.5)

        generate_kwargs: dict[str, Any] = {}
        if audio_prompt_path:
            generate_kwargs["audio_prompt_path"] = audio_prompt_path

        if model_name == "turbo":
            from chatterbox.tts_turbo import ChatterboxTurboTTS

            model = ChatterboxTurboTTS.from_pretrained(device=device)
            wav = model.generate(text, **generate_kwargs)
        elif model_name == "english":
            from chatterbox.tts import ChatterboxTTS

            model = ChatterboxTTS.from_pretrained(device=device)
            wav = model.generate(
                text,
                exaggeration=exaggeration,
                cfg_weight=cfg_weight,
                **generate_kwargs,
            )
        else:
            from chatterbox.mtl_tts import ChatterboxMultilingualTTS

            language = str(request.get("language") or "ko").strip() or "ko"
            model = ChatterboxMultilingualTTS.from_pretrained(device=device)
            wav = model.generate(
                text,
                language_id=language,
                exaggeration=exaggeration,
                cfg_weight=cfg_weight,
                **generate_kwargs,
            )

        output_path.parent.mkdir(parents=True, exist_ok=True)
        ta.save(str(output_path), wav, model.sr)
        print(json.dumps({"ok": True, "outputPath": str(output_path)}))
        return 0
    except ModuleNotFoundError as exc:
        print(
            "Chatterbox-TTS is not installed. Install it with: "
            "python3 -m pip install chatterbox-tts",
            file=sys.stderr,
        )
        print(str(exc), file=sys.stderr)
        return 2
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
