"""
Ollama LLM Client with streaming support for real-time conversation.
Supports barge-in by exposing cancellation mechanism.
"""
from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import httpx

logger = logging.getLogger(__name__)


@dataclass
class OllamaConfig:
    """Ollama connection configuration."""
    base_url: str = "http://localhost:11434"
    model: str = "gemma3:4b"
    timeout: float = 60.0
    # Generation parameters
    temperature: float = 0.7
    top_p: float = 0.9
    max_tokens: int = 512
    system_prompt: str = "You are JARVIS, a helpful AI assistant. Respond concisely and naturally in conversation."


@dataclass
class StreamChunk:
    """A single chunk from streaming response."""
    text: str
    is_done: bool
    model: str = ""
    created_at: str = ""


class OllamaClient:
    """
    Async Ollama client with streaming support.
    
    Features:
    - Streaming responses for low-latency conversation
    - Cancellation support for barge-in
    - Connection pooling via httpx
    """

    def __init__(self, config: OllamaConfig | None = None) -> None:
        self.config = config or OllamaConfig()
        self._client: httpx.AsyncClient | None = None
        self._current_task: asyncio.Task[Any] | None = None
        self._cancelled = False

    async def _get_client(self) -> httpx.AsyncClient:
        """Lazy-init HTTP client with connection pooling."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.config.base_url,
                timeout=httpx.Timeout(self.config.timeout, connect=10.0),
            )
        return self._client

    async def close(self) -> None:
        """Close HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    def cancel(self) -> None:
        """
        Cancel the current streaming response (for barge-in).
        This sets a flag that the stream_generate method checks.
        """
        self._cancelled = True
        if self._current_task and not self._current_task.done():
            self._current_task.cancel()
            logger.info("Ollama stream cancelled (barge-in)")

    def reset_cancellation(self) -> None:
        """Reset cancellation flag for new request."""
        self._cancelled = False

    async def check_health(self) -> bool:
        """Check if Ollama server is reachable."""
        try:
            client = await self._get_client()
            response = await client.get("/api/tags")
            return response.status_code == 200
        except Exception as e:
            logger.warning(f"Ollama health check failed: {e}")
            return False

    async def stream_generate(
        self,
        prompt: str,
        context: list[dict[str, str]] | None = None,
    ) -> AsyncIterator[StreamChunk]:
        """
        Stream generate response from Ollama.
        
        Args:
            prompt: User input text
            context: Optional conversation history [{"role": "user/assistant", "content": "..."}]
        
        Yields:
            StreamChunk with partial text
        """
        self.reset_cancellation()
        client = await self._get_client()

        # Build messages for chat format
        messages: list[dict[str, str]] = []
        
        # Add system prompt
        if self.config.system_prompt:
            messages.append({"role": "system", "content": self.config.system_prompt})
        
        # Add conversation history
        if context:
            messages.extend(context)
        
        # Add current user message
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": self.config.model,
            "messages": messages,
            "stream": True,
            "options": {
                "temperature": self.config.temperature,
                "top_p": self.config.top_p,
                "num_predict": self.config.max_tokens,
            },
        }

        try:
            async with client.stream("POST", "/api/chat", json=payload) as response:
                response.raise_for_status()
                
                async for line in response.aiter_lines():
                    # Check for cancellation (barge-in)
                    if self._cancelled:
                        logger.debug("Stream cancelled, stopping iteration")
                        break

                    if not line.strip():
                        continue

                    try:
                        data = json.loads(line)
                        
                        message = data.get("message", {})
                        content = message.get("content", "")
                        is_done = data.get("done", False)
                        
                        if content or is_done:
                            yield StreamChunk(
                                text=content,
                                is_done=is_done,
                                model=data.get("model", self.config.model),
                                created_at=data.get("created_at", ""),
                            )
                        
                        if is_done:
                            break

                    except json.JSONDecodeError:
                        logger.warning(f"Failed to parse Ollama response line: {line[:100]}")
                        continue

        except httpx.HTTPStatusError as e:
            logger.error(f"Ollama HTTP error: {e.response.status_code}")
            yield StreamChunk(text=f"[Error: HTTP {e.response.status_code}]", is_done=True)
        except httpx.RequestError as e:
            logger.error(f"Ollama request error: {e}")
            yield StreamChunk(text="[Error: Connection failed]", is_done=True)
        except asyncio.CancelledError:
            logger.info("Ollama stream task cancelled")
            yield StreamChunk(text="", is_done=True)

    async def generate_sync(
        self,
        prompt: str,
        context: list[dict[str, str]] | None = None,
    ) -> str:
        """
        Non-streaming generate (for simple use cases).
        Collects all chunks and returns full response.
        """
        full_text = ""
        async for chunk in self.stream_generate(prompt, context):
            full_text += chunk.text
            if chunk.is_done:
                break
        return full_text.strip()


# Singleton instance for module-level access
_default_client: OllamaClient | None = None


def get_ollama_client(config: OllamaConfig | None = None) -> OllamaClient:
    """Get or create default Ollama client."""
    global _default_client
    if _default_client is None:
        _default_client = OllamaClient(config)
    return _default_client


async def cleanup_ollama_client() -> None:
    """Cleanup default client on shutdown."""
    global _default_client
    if _default_client:
        await _default_client.close()
        _default_client = None
