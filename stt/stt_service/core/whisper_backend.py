from dataclasses import dataclass
import importlib
from typing import Optional

import numpy as np
from numpy.typing import NDArray


FloatArray = NDArray[np.float32]


@dataclass
class WhisperDecodeResult:
    text: str
    confidence: Optional[float]


class WhisperBackend:
    def __init__(
        self,
        model_size: str = "small",
        language: str = "ko",
        device: str = "auto",
        compute_type: str = "int8",
        cpu_threads: int = 2,
    ):
        try:
            fw_module = importlib.import_module("faster_whisper")
            WhisperModel = getattr(fw_module, "WhisperModel")
        except Exception as exc:
            raise RuntimeError(
                "Whisper backend requires faster-whisper. "
                "Install with: pip install faster-whisper"
            ) from exc

        self.model = WhisperModel(
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
        texts = []
        probs = []
        for seg in segments:
            texts.append(seg.text.strip())
            if hasattr(seg, "avg_logprob"):
                probs.append(float(seg.avg_logprob))
        text = " ".join([t for t in texts if t]).strip()
        confidence = float(np.mean(probs)) if probs else None
        return WhisperDecodeResult(text=text, confidence=confidence)
