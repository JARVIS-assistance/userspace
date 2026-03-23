import json
import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import numpy as np
from numpy.typing import NDArray
from vosk import KaldiRecognizer, Model, SetLogLevel


FloatArray = NDArray[np.float32]


@dataclass
class DecodeResult:
    text: str
    words: List[Dict[str, Any]]
    confidence: Optional[float]


@dataclass
class StreamingDecodeResult:
    text: str
    is_final: bool
    confidence: Optional[float]


class AcousticModel:
    def __init__(self, model_path: str):
        self.model_path = model_path
        self._model: Optional[Model] = None
        SetLogLevel(-1)

    def load(self) -> None:
        if self._model is not None:
            return
        if not os.path.isdir(self.model_path):
            raise FileNotFoundError(
                f"Vosk model directory not found: {self.model_path}. "
                "Download a model and set STT_MODEL_PATH."
            )
        self._model = Model(self.model_path)

    def create_recognizer(self, sample_rate: int) -> KaldiRecognizer:
        self.load()
        assert self._model is not None
        recognizer = KaldiRecognizer(self._model, sample_rate)
        recognizer.SetWords(True)
        return recognizer


class DecoderLanguageModel:
    def __init__(self, acoustic_model: AcousticModel, sample_rate: int):
        self.acoustic_model = acoustic_model
        self.sample_rate = sample_rate

    def decode(self, audio: FloatArray) -> DecodeResult:
        recognizer = self.acoustic_model.create_recognizer(self.sample_rate)
        pcm = self._float_to_pcm16(audio)

        chunk_size = 4000
        for offset in range(0, len(pcm), chunk_size):
            chunk = pcm[offset: offset + chunk_size]
            recognizer.AcceptWaveform(chunk)

        payload = json.loads(recognizer.FinalResult())
        words = payload.get("result", [])
        confidence = self._average_confidence(words)
        text = payload.get("text", "").strip()
        return DecodeResult(text=text, words=words, confidence=confidence)

    @staticmethod
    def _float_to_pcm16(audio: FloatArray) -> bytes:
        clipped = np.clip(audio, -1.0, 1.0)
        pcm = (clipped * 32767.0).astype(np.int16)
        return pcm.tobytes()

    @staticmethod
    def _average_confidence(words: List[Dict[str, Any]]) -> Optional[float]:
        if not words:
            return None
        confs = [float(w.get("conf", 0.0)) for w in words]
        return float(np.mean(confs))


class StreamingDecoderLanguageModel:
    def __init__(self, acoustic_model: AcousticModel, sample_rate: int):
        self.acoustic_model = acoustic_model
        self.sample_rate = sample_rate
        self.recognizer = self.acoustic_model.create_recognizer(self.sample_rate)

    def reset(self) -> None:
        self.recognizer = self.acoustic_model.create_recognizer(self.sample_rate)

    def feed(self, audio: FloatArray) -> StreamingDecodeResult:
        pcm = DecoderLanguageModel._float_to_pcm16(audio)
        accepted = self.recognizer.AcceptWaveform(pcm)

        if accepted:
            payload = json.loads(self.recognizer.Result())
            words = payload.get("result", [])
            confidence = DecoderLanguageModel._average_confidence(words)
            text = payload.get("text", "").strip()
            return StreamingDecodeResult(text=text, is_final=True, confidence=confidence)

        payload = json.loads(self.recognizer.PartialResult())
        text = payload.get("partial", "").strip()
        return StreamingDecodeResult(text=text, is_final=False, confidence=None)

    def flush(self) -> StreamingDecodeResult:
        payload = json.loads(self.recognizer.FinalResult())
        words = payload.get("result", [])
        confidence = DecoderLanguageModel._average_confidence(words)
        text = payload.get("text", "").strip()
        return StreamingDecodeResult(text=text, is_final=True, confidence=confidence)
