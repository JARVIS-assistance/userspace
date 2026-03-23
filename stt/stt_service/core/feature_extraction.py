import numpy as np
from numpy.typing import NDArray
from scipy import signal
from scipy.fftpack import dct
from typing import cast


FloatArray = NDArray[np.float32]


class FeatureExtractor:
    def __init__(self, sample_rate: int = 16000, n_mfcc: int = 13, n_fft: int = 512, hop_length: int = 160):
        self.sample_rate = sample_rate
        self.n_mfcc = n_mfcc
        self.n_fft = n_fft
        self.hop_length = hop_length
        self.n_mels = 40
        self.fmin = 0
        self.fmax = sample_rate / 2

    def compute_mfcc(self, audio: FloatArray) -> FloatArray:
        mel_spec = self.compute_mel_spectrogram(audio)
        mfcc = dct(mel_spec, type=2, axis=0, norm='ortho')[:self.n_mfcc, :]
        mfcc_mean = np.mean(mfcc, axis=1)
        mfcc_std = np.std(mfcc, axis=1)
        return np.concatenate([mfcc_mean, mfcc_std]).astype(np.float32)

    def compute_mel_spectrogram(self, audio: FloatArray) -> NDArray[np.float32]:
        spec = self.compute_spectrogram(audio)
        mel_basis = self.create_mel_filterbank()
        mel_spec = np.dot(mel_basis, spec).astype(np.float32)
        return self.power_to_db(mel_spec)

    def compute_spectrogram(self, audio: FloatArray) -> NDArray[np.float32]:
        _, _, spec = signal.spectrogram(
            audio,
            fs=self.sample_rate,
            nperseg=self.n_fft,
            noverlap=self.n_fft - self.hop_length,
            window='hann'
        )
        return cast(NDArray[np.float32], spec.astype(np.float32))

    def create_mel_filterbank(self) -> NDArray[np.float32]:
        def hz_to_mel(hz):
            return 2595 * np.log10(1 + hz / 700)

        def mel_to_hz(mel):
            return 700 * (10 ** (mel / 2595) - 1)

        fmin_mel = hz_to_mel(self.fmin)
        fmax_mel = hz_to_mel(self.fmax)
        mel_points = np.linspace(fmin_mel, fmax_mel, self.n_mels + 2)
        hz_points = mel_to_hz(mel_points)
        
        bin_points = np.floor((self.n_fft + 1) * hz_points / self.sample_rate).astype(int)
        
        filterbank = np.zeros((self.n_mels, self.n_fft // 2 + 1))
        
        for i in range(1, self.n_mels + 1):
            left = bin_points[i - 1]
            center = bin_points[i]
            right = bin_points[i + 1]
            
            for j in range(left, center):
                denom = max(center - left, 1)
                filterbank[i - 1, j] = (j - left) / denom
            for j in range(center, right):
                denom = max(right - center, 1)
                filterbank[i - 1, j] = (right - j) / denom
        
        return cast(NDArray[np.float32], filterbank.astype(np.float32))

    def power_to_db(
        self,
        mel_spec: NDArray[np.float32],
        ref: float = 1.0,
        top_db: float = 80.0,
    ) -> NDArray[np.float32]:
        log_spec = 10 * np.log10(np.maximum(mel_spec, ref))
        log_spec = np.maximum(log_spec, log_spec.max() - top_db)
        return log_spec.astype(np.float32)

    def extract(self, audio: FloatArray) -> FloatArray:
        return self.compute_mfcc(audio)
