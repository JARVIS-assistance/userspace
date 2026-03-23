from __future__ import annotations

import importlib
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray


FloatArray = NDArray[np.float32]


@dataclass
class WhisperDecodeResult:
    text: str
    confidence: float | None


class WhisperBackend:
    def __init__(
        self,
        model_size: str = "small",
        language: str = "ko",
        device: str = "auto",
        compute_type: str = "int8",
        cpu_threads: int = 2,
    ) -> None:
        try:
            fw_module = importlib.import_module("faster_whisper")
            whisper_model = getattr(fw_module, "WhisperModel")
        except Exception as exc:
            raise RuntimeError(
                "Whisper backend requires faster-whisper. "
                "Install with: pip install faster-whisper"
            ) from exc

        self.model = whisper_model(
            model_size_or_path=model_size,
            device=device,
            compute_type=compute_type,
            cpu_threads=cpu_threads,
        )
        self.language = language

    def transcribe(self, audio: FloatArray, sample_rate: int) -> WhisperDecodeResult:
        _ = sample_rate
        segments, _ = self.model.transcribe(
            audio,
            language=self.language,
            vad_filter=True,
            condition_on_previous_text=True,
        )
        texts: list[str] = []
        probs: list[float] = []
        for segment in segments:
            texts.append(segment.text.strip())
            if hasattr(segment, "avg_logprob"):
                probs.append(float(segment.avg_logprob))
        text = " ".join(value for value in texts if value).strip()
        confidence = float(np.mean(probs)) if probs else None
        return WhisperDecodeResult(text=text, confidence=confidence)
