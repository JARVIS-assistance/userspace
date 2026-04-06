"""
Real-time Conversation Manager with Barge-in Support.

Manages the state machine for voice conversations:
IDLE -> LISTENING -> PROCESSING -> SPEAKING -> (repeat or IDLE)

Barge-in: When user speaks during SPEAKING state, immediately:
1. Cancel LLM streaming
2. Stop TTS (signal to frontend)
3. Transition to LISTENING
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable

from app.models.messages import EventEnvelope
from app.realtime.ollama_client import OllamaClient, OllamaConfig, StreamChunk

logger = logging.getLogger(__name__)


class ConversationState(str, Enum):
    """Conversation state machine states."""
    IDLE = "idle"
    LISTENING = "listening"
    PROCESSING = "processing"
    SPEAKING = "speaking"


@dataclass
class ConversationTurn:
    """A single turn in the conversation."""
    role: str  # "user" or "assistant"
    content: str
    timestamp: float = field(default_factory=time.time)


@dataclass
class ConversationContext:
    """Maintains conversation history and state."""
    history: list[ConversationTurn] = field(default_factory=list)
    max_history: int = 10  # Keep last N turns for context
    
    def add_turn(self, role: str, content: str) -> None:
        """Add a turn to history, pruning old entries."""
        self.history.append(ConversationTurn(role=role, content=content))
        if len(self.history) > self.max_history:
            self.history = self.history[-self.max_history:]
    
    def get_messages(self) -> list[dict[str, str]]:
        """Get history in Ollama message format."""
        return [{"role": t.role, "content": t.content} for t in self.history]
    
    def clear(self) -> None:
        """Clear conversation history."""
        self.history.clear()


class ConversationManager:
    """
    Manages real-time conversation flow with barge-in support.
    
    Flow:
    1. STT detects speech -> LISTENING state
    2. STT final result -> PROCESSING state (LLM generates)
    3. LLM streaming -> SPEAKING state (emit deltas)
    4. User speaks during SPEAKING -> BARGE-IN:
       - Cancel LLM
       - Emit stop_tts signal
       - Back to LISTENING
    """

    def __init__(
        self,
        ollama_config: OllamaConfig | None = None,
        on_state_change: Callable[[ConversationState], None] | None = None,
    ) -> None:
        self.ollama = OllamaClient(ollama_config)
        self.state = ConversationState.IDLE
        self.context = ConversationContext()
        self.on_state_change = on_state_change
        
        # Streaming state
        self._current_response: str = ""
        self._streaming_task: asyncio.Task[Any] | None = None
        self._barge_in_triggered = False
        
        # Accumulated user speech (for partial -> final)
        self._pending_user_text: str = ""

    def _set_state(self, new_state: ConversationState) -> EventEnvelope:
        """Change state and notify."""
        old_state = self.state
        self.state = new_state
        
        logger.info(f"Conversation state: {old_state.value} -> {new_state.value}")
        
        if self.on_state_change:
            self.on_state_change(new_state)
        
        return EventEnvelope(
            type="conversation.state",
            payload={
                "state": new_state.value,
                "previous": old_state.value,
                "timestamp": int(time.time() * 1000),
            },
        )

    async def handle_stt_partial(self, text: str) -> list[EventEnvelope]:
        """
        Handle partial STT result.
        
        If in IDLE or LISTENING: Just update pending text
        If in SPEAKING: BARGE-IN! Cancel LLM, stop TTS
        """
        events: list[EventEnvelope] = []
        
        # Store partial text
        self._pending_user_text = text
        
        # Check for barge-in (user speaking while AI is speaking)
        if self.state == ConversationState.SPEAKING:
            events.extend(await self._handle_barge_in())
        
        # Transition to LISTENING if idle
        if self.state == ConversationState.IDLE:
            events.append(self._set_state(ConversationState.LISTENING))
        
        return events

    async def handle_stt_final(self, text: str) -> AsyncIterator[EventEnvelope]:
        """
        Handle final STT result.
        
        Triggers LLM generation and streams response.
        """
        if not text.strip():
            return
        
        # Barge-in check
        if self.state == ConversationState.SPEAKING:
            for event in await self._handle_barge_in():
                yield event
        
        # Add user turn to history
        self.context.add_turn("user", text)
        self._pending_user_text = ""
        
        # Emit user message event
        yield EventEnvelope(
            type="conversation.user",
            payload={"text": text, "timestamp": int(time.time() * 1000)},
        )
        
        # Transition to PROCESSING
        yield self._set_state(ConversationState.PROCESSING)
        
        # Generate LLM response
        async for event in self._generate_response(text):
            yield event

    async def _handle_barge_in(self) -> list[EventEnvelope]:
        """
        Handle barge-in: Cancel current LLM streaming, signal TTS stop.
        """
        events: list[EventEnvelope] = []
        
        self._barge_in_triggered = True
        
        # Cancel Ollama streaming
        self.ollama.cancel()
        
        # Cancel streaming task if running
        if self._streaming_task and not self._streaming_task.done():
            self._streaming_task.cancel()
            try:
                await self._streaming_task
            except asyncio.CancelledError:
                pass
        
        # Save partial response to history (if any)
        if self._current_response.strip():
            self.context.add_turn("assistant", self._current_response + " [interrupted]")
        self._current_response = ""
        
        # Emit barge-in event (frontend should stop TTS)
        events.append(EventEnvelope(
            type="conversation.barge_in",
            payload={
                "timestamp": int(time.time() * 1000),
                "action": "stop_tts",
            },
        ))
        
        # Transition to LISTENING
        events.append(self._set_state(ConversationState.LISTENING))
        
        logger.info("Barge-in handled: LLM cancelled, TTS stop signaled")
        
        return events

    async def _generate_response(self, user_text: str) -> AsyncIterator[EventEnvelope]:
        """
        Generate LLM response with streaming.
        """
        self._barge_in_triggered = False
        self._current_response = ""
        speaking_started = False
        
        try:
            async for event in self.ollama.stream_conversation(
                prompt=user_text,
                context=self.context.get_messages()[:-1],  # Exclude current user msg (already in prompt)
            ):
                # Check for barge-in during streaming
                if self._barge_in_triggered:
                    logger.debug("Barge-in detected during LLM streaming, stopping")
                    break

                if event.type in {
                    "conversation.classification",
                    "conversation.thinking",
                    "conversation.plan_step",
                    "conversation.error",
                }:
                    payload = dict(event.payload)
                    payload.setdefault("timestamp", int(time.time() * 1000))
                    yield EventEnvelope(type=event.type, payload=payload)
                    continue

                if event.type == "conversation.delta":
                    text = str(event.payload.get("text", ""))
                    if text:
                        if not speaking_started:
                            yield self._set_state(ConversationState.SPEAKING)
                            speaking_started = True
                        self._current_response += text
                        yield EventEnvelope(
                            type="conversation.delta",
                            payload={
                                "text": text,
                                "timestamp": int(time.time() * 1000),
                            },
                        )
                    continue

                if event.type == "conversation.done":
                    done_text = str(event.payload.get("text", "")).strip()
                    if done_text and not self._current_response.strip():
                        self._current_response = done_text
                    break
        
        except asyncio.CancelledError:
            logger.info("LLM generation cancelled")
        except Exception as e:
            logger.error(f"LLM generation error: {e}")
            yield EventEnvelope(
                type="conversation.error",
                payload={"message": str(e), "timestamp": int(time.time() * 1000)},
            )
        
        # If not interrupted, finalize response
        if not self._barge_in_triggered and self._current_response.strip():
            # Add to history
            self.context.add_turn("assistant", self._current_response)
            
            # Emit done event
            yield EventEnvelope(
                type="conversation.done",
                payload={
                    "text": self._current_response,
                    "timestamp": int(time.time() * 1000),
                },
            )
            
            # Return to IDLE (will go back to LISTENING if STT detects speech)
            yield self._set_state(ConversationState.IDLE)
        
        self._current_response = ""

    async def handle_speech_start(self) -> list[EventEnvelope]:
        """
        Called when VAD detects speech start.
        """
        events: list[EventEnvelope] = []
        
        # If currently speaking (AI), trigger barge-in
        if self.state == ConversationState.SPEAKING:
            events.extend(await self._handle_barge_in())
        elif self.state == ConversationState.IDLE:
            events.append(self._set_state(ConversationState.LISTENING))
        
        return events

    async def handle_speech_end(self) -> list[EventEnvelope]:
        """
        Called when VAD detects speech end (silence).
        """
        # This is informational; actual processing happens on stt.final
        return [EventEnvelope(
            type="conversation.speech_end",
            payload={"timestamp": int(time.time() * 1000)},
        )]

    def reset(self) -> EventEnvelope:
        """Reset conversation state."""
        self.ollama.cancel()
        self.context.clear()
        self._current_response = ""
        self._pending_user_text = ""
        self._barge_in_triggered = False
        return self._set_state(ConversationState.IDLE)

    async def close(self) -> None:
        """Cleanup resources."""
        self.ollama.cancel()
        if self._streaming_task and not self._streaming_task.done():
            self._streaming_task.cancel()
        await self.ollama.close()
