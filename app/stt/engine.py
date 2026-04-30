"""STTEngine — 단일 청크/단일 호출 STT 디코더."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from app.stt.acoustic_model import AcousticModel, DecoderLanguageModel
from app.stt.dsp import AudioPreprocessor
from app.stt.feature_extraction import FeatureExtractor
from app.stt.whisper_backend import WhisperBackend


FloatArray = NDArray[np.float32]


class STTEngineUnavailableError(RuntimeError):
    pass


@dataclass
class Transcription:
    text: str
    confidence: float | None
    duration_sec: float
    mfcc_dim: int


@dataclass
class StreamingTranscription:
    text: str
    is_final: bool
    confidence: float | None
    mfcc_dim: int


@dataclass(frozen=True)
class TranscriptionResult:
    text: str


class STTEngine:
    def __init__(
        self,
        sample_rate: int = 16000,
        model_path: str = "models/vosk-model-small-ko-0.22",
        backend: str = "vosk",
        whisper_model_size: str = "small",
        whisper_language: str = "ko",
        whisper_device: str = "auto",
        whisper_compute_type: str = "int8",
        whisper_cpu_threads: int = 2,
        whisper_realtime_interval_sec: float = 0.8,
        whisper_max_window_sec: float = 4.0,
    ) -> None:
        self.sample_rate = sample_rate
        self.backend = backend
        self.whisper_realtime_interval_sec = whisper_realtime_interval_sec
        self.whisper_max_window_sec = whisper_max_window_sec

        self.dsp = AudioPreprocessor(sample_rate=sample_rate)
        self.feature_extractor = FeatureExtractor(sample_rate=sample_rate)

        self.acoustic_model = AcousticModel(model_path=model_path)
        self.decoder_lm = DecoderLanguageModel(
            acoustic_model=self.acoustic_model,
            sample_rate=sample_rate,
        )
        self.whisper_backend = (
            WhisperBackend(
                model_size=whisper_model_size,
                language=whisper_language,
                device=whisper_device,
                compute_type=whisper_compute_type,
                cpu_threads=whisper_cpu_threads,
            )
            if backend == "whisper"
            else None
        )

    def process_audio(self, audio: FloatArray) -> Transcription:
        processed_audio = self.dsp.process(audio)
        features = self.feature_extractor.extract(processed_audio)

        decode_audio = np.clip(audio, -1.0, 1.0).astype(np.float32)
        if self.backend == "whisper" and self.whisper_backend is not None:
            whisper_result = self.whisper_backend.transcribe(decode_audio, self.sample_rate)
            text = whisper_result.text
            confidence = whisper_result.confidence
        else:
            decode_result = self.decoder_lm.decode(decode_audio)
            text = decode_result.text
            confidence = decode_result.confidence

        duration_sec = len(audio) / float(self.sample_rate)
        return Transcription(
            text=text,
            confidence=confidence,
            duration_sec=duration_sec,
            mfcc_dim=int(features.shape[0]),
        )

    def transcribe(self, audio: FloatArray) -> Transcription:
        return self.process_audio(audio)
