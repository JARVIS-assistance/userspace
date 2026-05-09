import { resolveApiBase } from "./storage";
import type { ModelConfig } from "./types";

type HeadersFactory = () => Record<string, string>;

export async function fetchModelConfigs(
    headers: HeadersFactory,
): Promise<ModelConfig[] | null> {
    const apiBase = await resolveApiBase();
    const res = await fetch(`${apiBase}/chat/model-config`, {
        headers: headers(),
    });
    if (!res.ok) return null;
    return await res.json();
}

export async function saveModelConfig(
    model: ModelConfig,
    headers: HeadersFactory,
): Promise<boolean> {
    const isNew = !model.id;
    const apiBase = await resolveApiBase();
    const res = await fetch(
        isNew
            ? `${apiBase}/chat/model-config`
            : `${apiBase}/chat/model-config/${model.id}`,
        {
            method: isNew ? "POST" : "PUT",
            headers: headers(),
            body: JSON.stringify({
                provider_mode: model.provider_mode,
                provider_name: model.provider_name,
                model_name: model.model_name,
                api_key: model.api_key || undefined,
                endpoint: model.endpoint || undefined,
                is_default: model.is_default,
                supports_stream: model.supports_stream,
                supports_realtime: model.supports_realtime,
                transport: model.transport,
                input_modalities: model.input_modalities,
                output_modalities: model.output_modalities,
            }),
        },
    );
    return res.ok;
}

export async function deleteModelConfig(
    model: ModelConfig,
    headers: HeadersFactory,
): Promise<boolean> {
    if (!model.id) return false;
    const apiBase = await resolveApiBase();
    const res = await fetch(`${apiBase}/chat/model-config/${model.id}`, {
        method: "DELETE",
        headers: headers(),
    });
    return res.ok;
}
