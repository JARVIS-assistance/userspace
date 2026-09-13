# JARVIS Userspace

JARVIS 비서형 AI SaaS의 데스크톱 클라이언트입니다. SaaS 컨트롤러가 대화와 작업을 계획하고, Userspace가 음성 입출력·UI·브라우저·파일·OS 액션을 사용자 기기에서 정책에 따라 실행합니다.

## 주요 기능

- Electron + React 데스크톱 UI, 플로팅 Sphere 모드
- 토큰 로그인 및 WebSocket 세션 인증
- 텍스트/음성 대화, SSE 응답 스트리밍, 대화 이력
- 로컬 Whisper STT, VAD, 웨이크워드, 말 끊기(barge-in)
- 다중 TTS 공급자 및 로컬 TTS 런타임
- 서버 액션 큐 폴링, 실행 결과 보고, 사용자 확인 모달
- 브라우저·앱·파일·터미널·클립보드·입력 장치·일정·할 일 액션
- 선택적인 JARVIS Vision 데스크톱 런타임 연동

## 구조

```text
run.py                    Python API, Electron, Vision 실행 관리자
app/main.py               FastAPI HTTP/WebSocket 진입점
app/realtime/             SaaS 대화 스트림 및 상태 머신
app/stt/                  로컬 STT, VAD, 실시간 음성 세션
app/actions/              액션 정책, 폴러, 디스패처, OS 핸들러
ui/app/                   React 렌더러
ui/main.js                Electron 메인 프로세스
ui/main/                  메인 프로세스 기능별 IPC 모듈
tests/                    Python 단위 테스트
```

## 요구 사항

- Python 3.10 이상(권장: 3.11 또는 3.12)
- Node.js 18 이상과 npm
- 로컬 STT 사용 시 Whisper 모델을 저장할 디스크 공간
- 브라우저 자동화 사용 시 Playwright 브라우저

macOS의 앱 제어, 키보드·마우스 입력 및 화면 캡처에는 손쉬운 사용·자동화·화면 기록 권한이 필요합니다. Windows/Linux에서는 일부 OS 액션의 지원 범위가 다를 수 있습니다.

## 설치

```bash
python -m venv .venv
```

가상환경을 활성화한 다음:

```bash
python -m pip install -r requirements.txt
python -m playwright install chromium
cd ui
npm ci
cd ..
```

설정 파일을 준비합니다.

```bash
cp config.json.example config.json
cp .env.example .env
```

PowerShell에서는 `Copy-Item config.json.example config.json` 형태를 사용하면 됩니다.

## 실행

전체 데스크톱 클라이언트:

```bash
python run.py
```

Python API만 실행하려면:

```bash
python -m uvicorn app.main:app --host 127.0.0.1 --port 8765
```

Electron UI만 실행하려면 API 실행 후 다음을 사용합니다.

```bash
cd ui
npm start
```

## 환경 변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `USERSPACE_HOST` | `127.0.0.1` | 로컬 API 바인딩 주소 |
| `USERSPACE_PORT` | `8765` | 로컬 API 포트 |
| `AUTH_API_BASE` | `http://127.0.0.1:8001` | 인증·할 일 SaaS API |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:8001` | 대화·액션 컨트롤러 API |
| `USERSPACE_WS_URL` | 자동 생성 | Electron이 연결할 WebSocket URL |
| `USERSPACE_CONFIG_PATH` | `config.json` | 런타임 설정 파일 |
| `JARVIS_USERSPACE_AUTH_DISABLED` | `0` | 로컬 개발 전용 익명 접속 |
| `JARVIS_VISION_ENABLE` | `1` | Vision 기능 사용 허용 여부 (Camera 설정에서 수동 시작) |
| `JARVIS_VISION_DIR` | 자동 탐색 | Vision 프로젝트 경로 |

`JARVIS_USERSPACE_AUTH_DISABLED=1`은 인증을 우회하므로 개발 환경 외에서는 사용하지 마세요. `AUTH_API_BASE`와 `OLLAMA_BASE_URL`에는 Userspace가 실행되는 노트북에서 접근 가능한 SaaS Controller 주소를 지정해야 합니다. 기본 `127.0.0.1`은 원격 SaaS에는 사용할 수 없습니다.

Vision은 `run.py`가 자동으로 띄우지 않습니다. Electron의 Camera 설정에서 시작할 때 `JARVIS_VISION_DIR`의 `main.py`를 한 번 실행하므로 카메라와 전역 키보드 hook이 중복 등록되지 않습니다.

## 통신 API

- `GET /health`: 서비스와 OS 권한 상태
- `POST /session/start`: 로컬 세션 ID 생성
- `WS /ws?token=<access-token>`: 대화, STT, 설정, 액션 이벤트

대표 클라이언트 이벤트는 `chat.request`, `conversation.cancel`, `stt.start`, `stt.audio.chunk`, `stt.stop`, `client_action.confirm`, `config.actions.get/set`입니다. 서버는 `conversation.*`, `stt.*`, `client_action.*`, `config.actions.*`, `error` 이벤트를 반환합니다.

## 지원 액션

| 영역 | capability |
|---|---|
| 브라우저 | `browser.open`, `browser.navigate`, `browser.search`, `browser.extract_dom`, `browser.click`, `browser.type`, `browser.select_result` |
| 앱 | `app.open`, `app.focus`, `app.close`, `app.active`, `application.list` |
| 파일 | `file.read`, `file.list`, `file.search`, `file.write`, `file.mkdir`, `file.move`, `file.delete` |
| 시스템/화면 | `system.info`, `process.list`, `screen.screenshot`, `screen.size`, `screen.pixel` |
| 입력/클립보드 | `keyboard.type`, `keyboard.press`, `keyboard.hotkey`, `mouse.click`, `mouse.drag`, `mouse.move`, `mouse.scroll`, `mouse.position`, `clipboard.copy`, `clipboard.paste` |
| 생산성 | `notification.show`, `calendar.open/create/update/delete`, `todo.create/update/delete` |
| 터미널 | `terminal.run` |

파일 액션은 `actions.file_write.allowed_paths` 내부에서만 동작합니다. 터미널은 `enabled`, `allowed_commands`, `cwd_allowlist`를 모두 검사합니다. 쓰기·이동·삭제·입력 합성·터미널과 같은 부작용 액션은 `force_confirm_capabilities`에 넣어 서버의 `requires_confirm` 값과 무관하게 사용자 승인을 강제할 수 있습니다.

`screen.screenshot`은 전체 화면 또는 `args.region={x,y,width,height}` 영역을 PNG로 캡처하고 `image_base64`, 크기, 파일 경로를 결과로 반환합니다. 컨트롤러가 이 이미지를 비전 모델에 전달해야 캡처된 화면을 의미적으로 이해하고 다음 클릭 좌표를 결정할 수 있습니다.

설정 변경은 UI의 Actions 탭에서 즉시 반영되며 `config.json`에 원자적으로 저장됩니다.

## 테스트와 빌드

```bash
python -m unittest discover -s tests -p "test_*.py"
cd ui
npm run build
```

macOS 패키지:

```bash
cd ui
npm run dist:mac
```

## 보안 원칙

- SaaS가 보낸 액션도 로컬 allowlist와 capability 정책을 통과해야 합니다.
- 알 수 없는 액션은 실행하지 않고 실패 결과를 서버에 보고합니다.
- 위험 capability에는 사용자 확인을 강제할 수 있습니다.
- 파일 경로는 정규화 후 허용 루트 내부인지 검사합니다.
- 인증 토큰은 WebSocket 및 SaaS API 요청에 전달됩니다. 로그나 저장소에 토큰을 기록하지 마세요.
