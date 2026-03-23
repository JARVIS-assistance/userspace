# STT Service (Mic -> DSP -> Features -> Acoustic Model -> Decoder+LM -> Text)

## Pipeline

1. Mic input
2. DSP preprocessing (`stt_service/core/dsp.py`)
3. Feature extraction (`stt_service/core/feature_extraction.py`)
4. Acoustic model (`stt_service/core/acoustic_model.py`, Vosk AM)
5. Decoder + language model (`stt_service/core/acoustic_model.py`, Vosk decoder + LM)
6. Text output

## 1) Install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 2) Download Korean model

```bash
python scripts/download_korean_model.py
```

Note: the default Korean Vosk model is `vosk-model-small-ko-0.22`.

Default model path:

`models/vosk-model-small-ko-0.22`

If you use another model path:

```bash
export STT_MODEL_PATH="models/<your-model-dir>"
```

## 3) Run API server

```bash
python main.py
```

Whisper backend (higher Korean accuracy in many cases):

```bash
pip install faster-whisper
export STT_BACKEND="whisper"
export STT_WHISPER_MODEL="small"
python main.py
```

Lower resource usage (recommended for laptop real-time):

```bash
export STT_BACKEND="whisper"
export STT_WHISPER_MODEL="base"
export STT_WHISPER_CPU_THREADS="2"
export STT_WHISPER_RT_INTERVAL_SEC="1.0"
export STT_WHISPER_MAX_WINDOW_SEC="3.0"
python main.py
```

Available backend values:

- `STT_BACKEND=vosk` (default)
- `STT_BACKEND=whisper`

브라우저에서 실시간 부분 전사 UI:

- `http://localhost:8000/`
- 마이크 권한 허용 후 `녹음 시작`
- 말하는 중에는 Partial, 구간 확정 시 Final 누적

Health check:

```bash
curl http://localhost:8000/health
```

## 4) Transcribe WAV file

Only mono 16-bit PCM WAV, 16 kHz is supported.

```bash
curl -X POST "http://localhost:8000/transcribe" \
  -F "file=@sample_16k_mono.wav"
```

## 5) Mic recording + immediate STT (CLI)

```bash
python -m stt_service.mic_transcribe --seconds 5
```

## 6) Real-time partial transcription (WebSocket)

WebSocket endpoint:

- `ws://localhost:8000/ws/realtime`

Client message format:

```json
{ "audio": [0.001, -0.002, ...] }
```

Optional control messages:

```json
{ "eof": true }
{ "reset": true }
```

Server event format:

```json
{ "partial": "지금 인식 중", "is_final": false, "mfcc_dim": 26 }
{ "final": "지금 인식 중", "is_final": true, "confidence": 0.84, "mfcc_dim": 26 }
```

## Notes

- This service is designed to make the full STT stage pipeline explicit in code.
- Vosk model package internally includes AM/decoder/LM assets, and the service exposes them as separated runtime stages.
