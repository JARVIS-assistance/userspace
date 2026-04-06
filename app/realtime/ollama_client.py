"""JARVIS Core LLM 클라이언트 — 모델 설정 관리 + SSE 스트리밍."""
from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, Literal

import aiohttp

from app.models.messages import EventEnvelope

logger = logging.getLogger(__name__)


# ── 모델 설정 ──────────────────────────────────────────

@dataclass
class ModelConfig:
    id: str = ""
    provider_mode: Literal["token", "local"] = "local"
    provider_name: str = ""
    model_name: str = ""
    api_key: str | None = None
    endpoint: str | None = None
    is_default: bool = False
    supports_stream: bool = True
    supports_realtime: bool = False
    transport: Literal["http_sse", "websocket"] = "http_sse"
    input_modalities: str = "text"
    output_modalities: str = "text"

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> ModelConfig:
        return cls(
            id=str(d.get("id", "")),
            provider_mode=d.get("provider_mode", "local"),
            provider_name=str(d.get("provider_name", "")),
            model_name=str(d.get("model_name", "")),
            api_key=d.get("api_key"),
            endpoint=d.get("endpoint"),
            is_default=bool(d.get("is_default", False)),
            supports_stream=bool(d.get("supports_stream", True)),
            supports_realtime=bool(d.get("supports_realtime", False)),
            transport=d.get("transport", "http_sse"),
            input_modalities=str(d.get("input_modalities", "text")),
            output_modalities=str(d.get("output_modalities", "text")),
        )

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "provider_mode": self.provider_mode,
            "provider_name": self.provider_name,
            "model_name": self.model_name,
            "is_default": self.is_default,
            "supports_stream": self.supports_stream,
            "supports_realtime": self.supports_realtime,
            "transport": self.transport,
            "input_modalities": self.input_modalities,
            "output_modalities": self.output_modalities,
        }
        if self.api_key:
            d["api_key"] = self.api_key
        if self.endpoint:
            d["endpoint"] = self.endpoint
        return d


# ── 클라이언트 설정 ────────────────────────────────────

@dataclass
class OllamaConfig:
    base_url: str = "http://127.0.0.1:8001"
    timeout: float = 60.0
    auth_token: str = ""


@dataclass
class StreamChunk:
    text: str
    is_done: bool
    model: str = ""


class OllamaClient:
    def __init__(self, config: OllamaConfig | None = None) -> None:
        self.config = config or OllamaConfig()
        self._session: aiohttp.ClientSession | None = None
        self._current_task: asyncio.Task[Any] | None = None
        self._cancelled = False
        self._models: list[ModelConfig] = []

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                base_url=self.config.base_url,
                timeout=aiohttp.ClientTimeout(total=self.config.timeout, connect=10.0),
            )
        return self._session

    def _auth_headers(self) -> dict[str, str]:
        h: dict[str, str] = {"Content-Type": "application/json"}
        if self.config.auth_token:
            h["Authorization"] = f"Bearer {self.config.auth_token}"
        return h

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()
            self._session = None

    def cancel(self) -> None:
        """barge-in 시 현재 스트림 취소."""
        self._cancelled = True
        if self._current_task and not self._current_task.done():
            self._current_task.cancel()
            logger.info("LLM 스트림 취소 (barge-in)")

    def reset_cancellation(self) -> None:
        self._cancelled = False

    # ── 모델 설정 API ──────────────────────────────────

    async def fetch_models(self) -> list[ModelConfig]:
        """GET /chat/model-config → 모델 목록 조회."""
        session = await self._get_session()
        try:
            async with session.get("/chat/model-config", headers=self._auth_headers()) as resp:
                if resp.status != 200:
                    logger.error(f"모델 목록 조회 실패: {resp.status}")
                    return []
                data = await resp.json()
                self._models = [ModelConfig.from_dict(m) for m in data]
                logger.info(f"모델 {len(self._models)}개 로드")
                return self._models
        except aiohttp.ClientError as e:
            logger.error(f"모델 목록 조회 에러: {e}")
            return []

    async def create_model(self, config: ModelConfig) -> ModelConfig | None:
        """POST /chat/model-config → 모델 설정 등록."""
        session = await self._get_session()
        try:
            async with session.post(
                "/chat/model-config",
                json=config.to_dict(),
                headers=self._auth_headers(),
            ) as resp:
                if resp.status not in (200, 201):
                    body = await resp.text()
                    logger.error(f"모델 등록 실패: {resp.status} {body[:200]}")
                    return None
                data = await resp.json()
                created = ModelConfig.from_dict(data)
                await self.fetch_models()
                return created
        except aiohttp.ClientError as e:
            logger.error(f"모델 등록 에러: {e}")
            return None

    def get_default_model(self) -> ModelConfig | None:
        """캐시된 모델 중 is_default=True인 것 반환."""
        for m in self._models:
            if m.is_default:
                return m
        # default 없으면 첫 번째 모델
        for m in self._models:
            return m
        return None

    def get_stream_model(self) -> ModelConfig | None:
        """스트리밍 가능한 모델 반환."""
        for m in self._models:
            if m.is_default and m.supports_stream:
                return m
        for m in self._models:
            if m.supports_stream:
                return m
        return None

    @property
    def models(self) -> list[ModelConfig]:
        return self._models

    # ── 헬스체크 ───────────────────────────────────────

    async def check_health(self) -> bool:
        try:
            session = await self._get_session()
            async with session.get("/health") as resp:
                return resp.status == 200
        except Exception as e:
            logger.warning(f"JARVIS Core 헬스체크 실패: {e}")
            return False

    # ── SSE 스트리밍 ───────────────────────────────────

    async def stream_conversation(
        self,
        prompt: str,
        context: list[dict[str, str]] | None = None,
        task_type: str = "general",
        confirm: bool = False,
    ) -> AsyncIterator[EventEnvelope]:
        self.reset_cancellation()
        session = await self._get_session()

        payload = {
            "message": prompt,
        }

        headers = self._auth_headers()
        headers["Accept"] = "text/event-stream"

        try:
            async with session.post(
                "/conversation/stream",
                json=payload,
                headers=headers,
            ) as resp:
                if resp.status != 200:
                    body = await resp.text()
                    logger.error(f"HTTP 에러: {resp.status} body={body[:300]}")
                    yield EventEnvelope(
                        type="conversation.error",
                        payload={"message": f"HTTP {resp.status}", "body": body[:300]},
                    )
                    return

                current_event = ""

                async for raw_line in resp.content:
                    if self._cancelled:
                        break

                    line = raw_line.decode("utf-8", errors="replace").strip()

                    if not line:
                        current_event = ""
                        continue

                    if line.startswith("event:"):
                        current_event = line[len("event:"):].strip()
                        continue

                    if not line.startswith("data:"):
                        continue

                    data_str = line[len("data:"):].strip()
                    try:
                        data = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue

                    if current_event == "meta":
                        continue

                    if current_event == "classification":
                        yield EventEnvelope(
                            type="conversation.classification",
                            payload=data,
                        )

                    elif current_event == "thinking":
                        yield EventEnvelope(
                            type="conversation.thinking",
                            payload=data,
                        )

                    elif current_event == "plan_step":
                        yield EventEnvelope(
                            type="conversation.plan_step",
                            payload=data,
                        )

                    elif current_event == "assistant_delta":
                        content = data.get("content", "")
                        if content:
                            yield EventEnvelope(
                                type="conversation.delta",
                                payload={"text": content},
                            )

                    elif current_event == "assistant_done":
                        yield EventEnvelope(
                            type="conversation.done",
                            payload={"text": data.get("content", "")},
                        )
                        return

                    elif current_event == "error":
                        yield EventEnvelope(
                            type="conversation.error",
                            payload={"message": data.get("content", "unknown error")},
                        )
                        return

        except aiohttp.ClientError as e:
            logger.error(f"요청 에러: {e}")
            yield EventEnvelope(
                type="conversation.error",
                payload={"message": "[Error: Connection failed]"},
            )
        except asyncio.CancelledError:
            logger.info("LLM 스트림 태스크 취소됨")
            yield EventEnvelope(type="conversation.done", payload={"text": ""})

    async def stream_generate(
        self,
        prompt: str,
        context: list[dict[str, str]] | None = None,
        task_type: str = "general",
        confirm: bool = False,
    ) -> AsyncIterator[StreamChunk]:
        async for event in self.stream_conversation(
            prompt,
            context=context,
            task_type=task_type,
            confirm=confirm,
        ):
            if event.type == "conversation.delta":
                yield StreamChunk(text=str(event.payload.get("text", "")), is_done=False)
            elif event.type == "conversation.done":
                yield StreamChunk(
                    text=str(event.payload.get("text", "")),
                    is_done=True,
                )
                return
            elif event.type == "conversation.error":
                yield StreamChunk(
                    text=str(event.payload.get("message", "[Error]")),
                    is_done=True,
                )
                return

    async def generate_sync(
        self,
        prompt: str,
        context: list[dict[str, str]] | None = None,
    ) -> str:
        """동기식 응답 — 전체 텍스트를 모아서 반환."""
        full_text = ""
        async for chunk in self.stream_generate(prompt, context):
            full_text += chunk.text
            if chunk.is_done:
                break
        return full_text.strip()


_default_client: OllamaClient | None = None


def get_ollama_client(config: OllamaConfig | None = None) -> OllamaClient:
    global _default_client
    if _default_client is None:
        _default_client = OllamaClient(config)
    return _default_client


async def cleanup_ollama_client() -> None:
    global _default_client
    if _default_client:
        await _default_client.close()
        _default_client = None
