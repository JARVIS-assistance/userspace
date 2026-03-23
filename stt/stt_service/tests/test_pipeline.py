import io
import wave

import numpy as np

from ..api.server import wav_bytes_to_float32
from ..core.dsp import AudioPreprocessor
from ..core.feature_extraction import FeatureExtractor


def build_test_wav(sample_rate: int = 16000, duration_sec: float = 1.0) -> bytes:
    t = np.linspace(0, duration_sec, int(sample_rate * duration_sec), endpoint=False)
    signal = (0.2 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
    pcm = (signal * 32767).astype(np.int16)

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm.tobytes())
    return buffer.getvalue()


def test_wav_bytes_to_float32_roundtrip() -> None:
    wav_bytes = build_test_wav()
    audio, sr = wav_bytes_to_float32(wav_bytes)
    assert sr == 16000
    assert audio.dtype == np.float32
    assert len(audio) == 16000


def test_dsp_and_feature_extraction_shapes() -> None:
    wav_bytes = build_test_wav()
    audio, _ = wav_bytes_to_float32(wav_bytes)

    dsp = AudioPreprocessor(sample_rate=16000)
    feat = FeatureExtractor(sample_rate=16000)

    processed = dsp.process(audio)
    mfcc = feat.extract(processed)

    assert processed.ndim == 1
    assert mfcc.ndim == 1
    assert mfcc.shape[0] == 26
