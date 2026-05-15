import { resolveApiBase } from "./storage";
import type { ModelConfig, ModelSelection } from "./types";

type HeadersFactory = () => Record<string, string>;

function normalizeModelConfig(model: ModelConfig): ModelConfig {
    return {
        ...model,
        is_active: model.is_active ?? true,
        supports_stream: model.supports_stream ?? true,
        supports_realtime: model.supports_realtime ?? false,
    };
}

function normalizeModelSelection(selection: ModelSelection): ModelSelection {
    return {
        realtime_model_config_id: selection.realtime_model_config_id || null,
        deep_model_config_id: selection.deep_model_config_id || null,
    };
}

export async function fetchModelConfigs(
    headers: HeadersFactory,
): Promise<ModelConfig[] | null> {
    const apiBase = await resolveApiBase();
    const res = await fetch(`${apiBase}/chat/model-config`, {
        headers: headers(),
    });
    if (!res.ok) return null;
    const models = (await res.json()) as ModelConfig[];
    return models.map(normalizeModelConfig);
}

export async function fetchModelSelection(
    headers: HeadersFactory,
): Promise<ModelSelection | null> {
    const apiBase = await resolveApiBase();
    const res = await fetch(`${apiBase}/chat/model-selection`, {
        headers: headers(),
    });
    if (!res.ok) return null;
    return normalizeModelSelection((await res.json()) as ModelSelection);
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
                api_key: model.api_key || null,
                endpoint: model.endpoint || null,
                is_default: model.is_default,
                supports_stream: model.supports_stream ?? true,
                supports_realtime: model.supports_realtime ?? false,
                transport: model.transport,
                input_modalities: model.input_modalities,
                output_modalities: model.output_modalities,
            }),
        },
    );
    return res.ok;
}

export async function saveModelSelection(
    selection: Partial<ModelSelection>,
    headers: HeadersFactory,
): Promise<Partial<ModelSelection> | null> {
    const apiBase = await resolveApiBase();
    const res = await fetch(`${apiBase}/chat/model-selection`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(selection),
    });
    if (!res.ok) return null;
    return (await fetchModelSelection(headers)) ?? selection;
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
