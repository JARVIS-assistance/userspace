import numpy as np

from stt_service.core.stt_engine import RealTimePartialSTT, STTEngine
from stt_service.core import stt_engine as stt_engine_module


class FakeDecodeResult:
    def __init__(self, text, is_final, confidence):
        self.text = text
        self.is_final = is_final
        self.confidence = confidence


class FakeStreamingDecoder:
    def __init__(self):
        self.calls = 0

    def feed(self, audio):
        _ = audio
        self.calls += 1
        if self.calls == 1:
            return FakeDecodeResult("안녕", False, None)
        return FakeDecodeResult("안녕하세요", True, 0.9)

    def flush(self):
        return FakeDecodeResult("마무리", True, 0.88)

    def reset(self):
        return None


def test_realtime_partial_stt_flow(monkeypatch) -> None:
    monkeypatch.setattr(
        stt_engine_module,
        "StreamingDecoderLanguageModel",
        lambda acoustic_model, sample_rate: FakeStreamingDecoder(),
    )
    engine = STTEngine(sample_rate=16000, model_path="models/not-required-for-test")
    realtime = RealTimePartialSTT(stt_engine=engine)

    chunk = np.zeros(1600, dtype=np.float32)

    first = realtime.add_audio_chunk(chunk)
    assert first.is_final is False
    assert first.text == "안녕"
    assert first.mfcc_dim == 26

    second = realtime.add_audio_chunk(chunk)
    assert second.is_final is True
    assert second.text == "안녕하세요"
    assert second.confidence == 0.9

    flushed = realtime.flush()
    assert flushed.is_final is True
    assert flushed.text == "마무리"
    assert flushed.confidence == 0.88
