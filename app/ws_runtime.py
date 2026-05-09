from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any

from app.actions.dispatcher import ActionDispatcher
from app.actions.models import PendingClientAction
from app.actions.policy import actions_to_dict, persist_actions_patch
from app.actions.setup import register_default_handlers
from app.client_context import build_runtime_headers, build_runtime_profile
from app.config import ActionSettings
from app.models.messages import EventEnvelope

logger = logging.getLogger(__name__)

EmitJson = Callable[[dict[str, object]], Awaitable[None]]
EmitEnvelope = Callable[[EventEnvelope], Awaitable[None]]


def build_action_dispatcher(
    actions: ActionSettings,
    *,
    emit: EmitEnvelope,
) -> ActionDispatcher:
    enabled_set = set(actions.enabled_types)
    dispatcher = ActionDispatcher(
        emit=emit,
        enabled_types=(enabled_set if actions.enabled_types else None),
        force_confirm_types=enabled_set & set(actions.force_confirm_types),
        enabled_capabilities=set(actions.enabled_capabilities),
        force_confirm_capabilities=set(actions.force_confirm_capabilities),
    )
    register_default_handlers(dispatcher, actions)
    return dispatcher


async def sync_runtime_profile(action_api: Any, actions: ActionSettings) -> None:
    try:
        profile = await action_api.upsert_runtime_profile(build_runtime_profile(actions))
        app_count = len(profile.get("applications") or []) if isinstance(profile, dict) else 0
        print(f"[CTX] runtime profile synced applications={app_count}", flush=True)
    except Exception as exc:
        logger.warning("runtime profile sync failed: %s", exc)


def apply_dispatcher_policy(
    dispatcher: ActionDispatcher,
    actions: ActionSettings,
) -> None:
    enabled_set = set(actions.enabled_types)
    dispatcher.set_policy(
        enabled_types=(enabled_set if actions.enabled_types else None),
        force_confirm_types=enabled_set & set(actions.force_confirm_types),
        enabled_capabilities=set(actions.enabled_capabilities),
        force_confirm_capabilities=set(actions.force_confirm_capabilities),
    )
    dispatcher.clear_handlers()
    register_default_handlers(dispatcher, actions)
    print(
        f"[CFG] actions updated  enabled={sorted(enabled_set)}  "
        f"force_confirm={sorted(actions.force_confirm_types)}",
        flush=True,
    )


async def apply_actions_config_patch(
    *,
    config_path: str,
    payload: dict[str, Any],
    runtime_headers: dict[str, str],
    action_api: Any,
    dispatcher: ActionDispatcher,
    reload_settings: Callable[[], ActionSettings],
) -> dict[str, object]:
    new_actions = persist_actions_patch(config_path, payload)
    actions = reload_settings()
    runtime_headers.clear()
    runtime_headers.update(build_runtime_headers(actions))
    await sync_runtime_profile(action_api, actions)
    apply_dispatcher_policy(dispatcher, actions)
    return actions_to_dict(new_actions)


async def forward_conversation_events(
    events: Any,
    *,
    emit_conversation: EmitEnvelope,
    poller: Any,
) -> None:
    async for event in events:
        if event.type != "conversation.action_dispatch":
            await emit_conversation(event)
            continue

        try:
            pending = PendingClientAction.model_validate(event.payload)
        except Exception as exc:
            await emit_conversation(event)
            logger.warning("invalid action_dispatch payload: %s", exc)
            poller.start()
            poller.wake()
            continue

        await emit_conversation(event)
        poller.dispatch_pending(pending)


async def send_events(
    events: list[EventEnvelope],
    *,
    send_json: EmitJson,
) -> None:
    for event in events:
        await send_json(event.model_dump())
