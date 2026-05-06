#!/usr/bin/env python3
from __future__ import annotations

import copy
import glob
import json
import os
import sys
import traceback
from pathlib import Path
from typing import Any


SAMPLE_RATE = 24000


def main() -> int:
    request = json.loads(sys.stdin.read() or "{}")
    text = str(request.get("text") or "").strip()
    output_path = str(request.get("outputPath") or "").strip()
    model_path = str(request.get("model") or "microsoft/VibeVoice-Realtime-0.5B").strip()
    voice_name = str(request.get("voiceId") or "Carter").strip()
    voice_preset_path = str(request.get("voicePresetPath") or "").strip()
    cfg_scale = float(request.get("cfgScale") or 1.5)

    if not text:
        raise ValueError("missing text")
    if not output_path:
        raise ValueError("missing outputPath")

    try:
        import torch
        from vibevoice.modular.modeling_vibevoice_streaming_inference import (
            VibeVoiceStreamingForConditionalGenerationInference,
        )
        from vibevoice.processor.vibevoice_streaming_processor import (
            VibeVoiceStreamingProcessor,
        )
    except Exception as exc:
        raise RuntimeError(
            "VibeVoice is not installed. Install the official repo with "
            "`pip install -e .[streamingtts]` and set VIBEVOICE_PYTHON if it uses "
            "a separate virtualenv."
        ) from exc

    device = _select_device(torch)
    voice_path = _resolve_voice_preset(voice_preset_path, voice_name)
    if not voice_path:
        raise RuntimeError(
            "VibeVoice voice preset not found. Set VOICE PRESET PATH to a .pt file, "
            "or set VIBEVOICE_REPO_PATH to a checkout that contains "
            "demo/voices/streaming_model."
        )

    processor = VibeVoiceStreamingProcessor.from_pretrained(model_path)
    dtype = torch.bfloat16 if device == "cuda" else torch.float32
    attn = "flash_attention_2" if device == "cuda" else "sdpa"

    try:
        model = _load_model(
            VibeVoiceStreamingForConditionalGenerationInference,
            model_path,
            device,
            dtype,
            attn,
        )
    except Exception:
        if attn != "flash_attention_2":
            raise
        model = _load_model(
            VibeVoiceStreamingForConditionalGenerationInference,
            model_path,
            device,
            dtype,
            "sdpa",
        )

    model.eval()
    if hasattr(model, "set_ddpm_inference_steps"):
        model.set_ddpm_inference_steps(num_steps=5)

    target_device = device if device != "cpu" else "cpu"
    prompt = torch.load(voice_path, map_location=target_device, weights_only=False)
    inputs = processor.process_input_with_cached_prompt(
        text=_normalize_text(text),
        cached_prompt=prompt,
        padding=True,
        return_tensors="pt",
        return_attention_mask=True,
    )
    for key, value in list(inputs.items()):
        if torch.is_tensor(value):
            inputs[key] = value.to(target_device)

    with torch.inference_mode():
        outputs = model.generate(
            **inputs,
            max_new_tokens=None,
            cfg_scale=cfg_scale,
            tokenizer=processor.tokenizer,
            generation_config={"do_sample": False},
            verbose=False,
            all_prefilled_outputs=copy.deepcopy(prompt),
        )

    if not getattr(outputs, "speech_outputs", None) or outputs.speech_outputs[0] is None:
        raise RuntimeError("VibeVoice generated no audio")

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    processor.save_audio(outputs.speech_outputs[0], output_path=output_path)
    return 0


def _select_device(torch: Any) -> str:
    requested = os.getenv("VIBEVOICE_DEVICE", "auto").strip().lower()
    if requested == "mpx":
        requested = "mps"
    if requested in {"cpu", "cuda", "mps"}:
        if requested == "cuda" and not torch.cuda.is_available():
            return "cpu"
        if requested == "mps" and not torch.backends.mps.is_available():
            return "cpu"
        return requested
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _load_model(model_cls: Any, model_path: str, device: str, dtype: Any, attn: str) -> Any:
    if device == "mps":
        model = model_cls.from_pretrained(
            model_path,
            torch_dtype=dtype,
            attn_implementation=attn,
            device_map=None,
        )
        return model.to("mps")
    return model_cls.from_pretrained(
        model_path,
        torch_dtype=dtype,
        device_map=device,
        attn_implementation=attn,
    )


def _resolve_voice_preset(explicit_path: str, voice_name: str) -> str:
    if explicit_path and Path(explicit_path).exists():
        return str(Path(explicit_path).expanduser().resolve())

    roots = [
        os.getenv("VIBEVOICE_REPO_PATH", ""),
        os.getenv("VIBEVOICE_VOICES_DIR", ""),
        str(Path(__file__).resolve().parents[1] / "VibeVoice"),
        str(Path.cwd() / "VibeVoice"),
    ]
    candidates: list[str] = []
    for root in roots:
        if not root:
            continue
        root_path = Path(root).expanduser()
        search_root = (
            root_path
            if root_path.name == "streaming_model"
            else root_path / "demo" / "voices" / "streaming_model"
        )
        candidates.extend(glob.glob(str(search_root / "**" / "*.pt"), recursive=True))

    if not candidates:
        return ""

    normalized = voice_name.lower()
    for candidate in sorted(candidates):
        stem = Path(candidate).stem.lower()
        if stem == normalized:
            return str(Path(candidate).resolve())
    for candidate in sorted(candidates):
        stem = Path(candidate).stem.lower()
        if normalized in stem or stem in normalized:
            return str(Path(candidate).resolve())
    return str(Path(sorted(candidates)[0]).resolve())


def _normalize_text(text: str) -> str:
    return (
        text.replace("\u2019", "'")
        .replace("\u201c", '"')
        .replace("\u201d", '"')
        .strip()
    )


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
        if os.getenv("VIBEVOICE_DEBUG"):
            traceback.print_exc()
        raise SystemExit(1)
