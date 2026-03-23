import numpy as np
from numpy.typing import NDArray
from scipy import signal
from typing import cast


FloatArray = NDArray[np.float32]


class AudioPreprocessor:
    def __init__(self, sample_rate: int = 16000, frame_duration: int = 30):
        self.sample_rate = sample_rate
        self.frame_duration = frame_duration
        self.frame_size = int(sample_rate * frame_duration / 1000)
        self.vad_threshold = 0.01

    def normalize(self, audio: FloatArray) -> FloatArray:
        if audio.size == 0:
            return audio
        max_val = np.abs(audio).max()
        if max_val > 0:
            return audio / max_val
        return audio

    def apply_highpass_filter(self, audio: FloatArray, cutoff: int = 80) -> FloatArray:
        if audio.size < 32:
            return audio
        _ = cutoff
        b = np.array([1.0, -1.0], dtype=np.float64)
        a = np.array([1.0, -0.99], dtype=np.float64)
        filtered = cast(NDArray[np.float64], signal.lfilter(b, a, audio))
        return np.asarray(filtered, dtype=np.float32)

    def apply_preemphasis(self, audio: FloatArray, coef: float = 0.97) -> FloatArray:
        if audio.size == 0:
            return audio
        return np.append(audio[0], audio[1:] - coef * audio[:-1])

    def vad_filter(self, audio: FloatArray) -> FloatArray:
        frames = self.frame_audio(audio, self.frame_size)
        filtered_frames = []
        
        for frame in frames:
            energy = np.sqrt(np.mean(frame ** 2))
            if energy > self.vad_threshold:
                filtered_frames.append(frame)
        
        if filtered_frames:
            return np.concatenate(filtered_frames)
        return audio

    def frame_audio(self, audio: FloatArray, frame_size: int, hop_size: int = 0) -> NDArray[np.float32]:
        if hop_size == 0:
            hop_size = frame_size // 2
        
        frames = []
        for i in range(0, len(audio) - frame_size + 1, hop_size):
            frames.append(audio[i:i + frame_size])
        return np.array(frames)

    def process(self, audio: FloatArray) -> FloatArray:
        audio = self.normalize(audio)
        audio = self.apply_highpass_filter(audio)
        audio = self.apply_preemphasis(audio)
        return audio
