# userspace

Python service layer for JARVIS.

## Features
- Realtime chat stream placeholders
- Allowlist-based action registry
- FastAPI HTTP + WebSocket APIs

## Run

Requires Python `3.10+`.

```bash
cd userspace
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp config.json.example config.json
python run.py
```

## API
- `GET /health`
- `POST /session/start`
- `WS /ws`

## WebSocket Events
Client -> server:
- `chat.request`
- `action.request`
- `stt.start`
- `stt.audio.chunk`
- `stt.stop`

Server -> client:
- `chat.delta`
- `chat.done`
- `action.result`
- `stt.partial`
- `stt.final`
- `stt.state`
- `error`

## STT Streaming (On-device)
- Engine: `faster-whisper` (local model)
- Audio format: PCM16 mono chunks (recommended `16000Hz`)

`stt.start` payload:
```json
{
  "sample_rate": 16000,
  "profile": "default"
}
```

`profile` options:
- `default`
- `ultra_low_latency` (초저지연)

`stt.audio.chunk` payload (choose one):
```json
{
  "audio_b64": "BASE64_PCM16_BYTES"
}
```

```json
{
  "samples": [12, -33, 104, ...]
}
```

`stt.stop` payload:
```json
{}
```

## Config
Main runtime config is loaded from `config.json`.

To use a different file:
```bash
USERSPACE_CONFIG_PATH=./my-config.json python run.py
```

## Tests
```bash
./.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
```
