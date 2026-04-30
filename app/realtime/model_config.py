"""LLM 모델 설정 dataclass."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal


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
