"""JARVIS Core LLM 클라이언트 — 모델 설정 관리 + SSE 스트리밍."""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

import aiohttp

from app.models.messages import EventEnvelope
from app.realtime.model_config import ModelConfig
from app.realtime.sse_parser import parse_conversation_stream

logger = logging.getLogger(__name__)


__all__ = [
    "ModelConfig",
    "OllamaConfig",
    "OllamaClient",
    "StreamChunk",
    "get_ollama_client",
    "cleanup_ollama_client",
]


# ── 클라이언트 설정 ────────────────────────────────────

DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:8001"


def _default_ollama_base_url() -> str:
    return str(os.getenv("OLLAMA_BASE_URL", DEFAULT_OLLAMA_BASE_URL)).rstrip("/")


@dataclass
class OllamaConfig:
    base_url: str = field(default_factory=_default_ollama_base_url)
    timeout: float = 60.0
    auth_token: str = ""
    client_id: str = ""
    runtime_headers: dict[str, str] = field(default_factory=dict)


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
        if self.config.client_id:
            h["x-client-id"] = self.config.client_id
        h.update(self.config.runtime_headers)
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
            async with session.get(
                "/chat/model-config", headers=self._auth_headers()
            ) as resp:
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

        payload = {"message": prompt}

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

                async for event in parse_conversation_stream(
                    resp,
                    is_cancelled=lambda: self._cancelled,
                ):
                    yield event

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
                yield StreamChunk(
                    text=str(event.payload.get("text", "")), is_done=False
                )
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
