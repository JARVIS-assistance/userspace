import { useCallback, useEffect, useState } from "react";
import ActionsTab from "./settings/ActionsTab";
import type { ActionsConfig } from "./settings/actionsConfig";
import ModelTab from "./settings/ModelTab";
import PersonaTab from "./settings/PersonaTab";
import TtsTab from "./settings/TtsTab";
import { loadLocal, resolveApiBase, saveLocal } from "./settings/storage";
import { css } from "./settings/styles";
import type { ModelConfig, Persona, SettingsData, TtsConfig } from "./settings/types";

type TabKey = "model" | "persona" | "tts" | "actions";

interface Props {
    open: boolean;
    token: string;
    onClose: () => void;
    // actions 탭용 — App.tsx의 WS와 연결
    actionsConfig: ActionsConfig | null;
    actionsSaving: boolean;
    actionsError: string | null;
    onRequestActionsConfig: () => void;
    onSaveActionsConfig: (patch: Partial<ActionsConfig>) => void;
    onSettingsChange?: (data: SettingsData) => void;
}

export default function SettingsModal({
    open,
    token,
    onClose,
    actionsConfig,
    actionsSaving,
    actionsError,
    onRequestActionsConfig,
    onSaveActionsConfig,
    onSettingsChange,
}: Props) {
    const [tab, setTab] = useState<TabKey>("model");
    const [data, setData] = useState<SettingsData>(loadLocal);
    const [editing, setEditing] = useState<ModelConfig | null>(null);
    const [loading, setLoading] = useState(false);

    const hdrs = useCallback(
        (): Record<string, string> => ({
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        }),
        [token],
    );

    const sync = useCallback(async () => {
        setLoading(true);
        try {
            const apiBase = await resolveApiBase();
            const res = await fetch(`${apiBase}/chat/model-config`, {
                headers: hdrs(),
            });
            if (res.ok) {
                const models: ModelConfig[] = await res.json();
                setData((prev) => {
                    const next = { ...prev, models };
                    saveLocal(next);
                    return next;
                });
            }
        } catch (_) {}
        setLoading(false);
    }, [hdrs]);

    useEffect(() => {
        if (open) sync();
    }, [open, sync]);

    const saveModel = useCallback(
        async (m: ModelConfig) => {
            setLoading(true);
            try {
                const isNew = !m.id;
                const apiBase = await resolveApiBase();
                const res = await fetch(
                    isNew
                        ? `${apiBase}/chat/model-config`
                        : `${apiBase}/chat/model-config/${m.id}`,
                    {
                        method: isNew ? "POST" : "PUT",
                        headers: hdrs(),
                        body: JSON.stringify({
                            provider_mode: m.provider_mode,
                            provider_name: m.provider_name,
                            model_name: m.model_name,
                            api_key: m.api_key || undefined,
                            endpoint: m.endpoint || undefined,
                            is_default: m.is_default,
                            supports_stream: m.supports_stream,
                            supports_realtime: m.supports_realtime,
                            transport: m.transport,
                            input_modalities: m.input_modalities,
                            output_modalities: m.output_modalities,
                        }),
                    },
                );
                if (res.ok) {
                    await sync();
                    setEditing(null);
                }
            } catch (_) {}
            setLoading(false);
        },
        [hdrs, sync],
    );

    const setPerson = useCallback((u: Partial<Persona>) => {
        setData((prev) => {
            const next = { ...prev, persona: { ...prev.persona, ...u } };
            saveLocal(next);
            onSettingsChange?.(next);
            return next;
        });
    }, [onSettingsChange]);

    const setTts = useCallback((u: Partial<TtsConfig>) => {
        setData((prev) => {
            const next = { ...prev, tts: { ...prev.tts, ...u } };
            saveLocal(next);
            onSettingsChange?.(next);
            return next;
        });
    }, [onSettingsChange]);

    if (!open) return null;

    return (
        <div style={css.overlay} onClick={onClose}>
            <div style={css.modal} onClick={(e) => e.stopPropagation()}>
                <div style={css.header}>
                    <h2 style={css.title}>SETTINGS</h2>
                    <button style={css.closeBtn} onClick={onClose}>
                        {"✕"}
                    </button>
                </div>

                <div style={css.tabs}>
                    <button
                        style={css.tab(tab === "model")}
                        onClick={() => setTab("model")}
                    >
                        MODEL
                    </button>
                    <button
                        style={css.tab(tab === "persona")}
                        onClick={() => setTab("persona")}
                    >
                        PERSONA
                    </button>
                    <button
                        style={css.tab(tab === "tts")}
                        onClick={() => setTab("tts")}
                    >
                        TTS
                    </button>
                    <button
                        style={css.tab(tab === "actions")}
                        onClick={() => setTab("actions")}
                    >
                        ACTIONS
                    </button>
                </div>

                {tab === "model" && (
                    <ModelTab
                        models={data.models}
                        editing={editing}
                        loading={loading}
                        onEdit={setEditing}
                        onSave={saveModel}
                    />
                )}

                {tab === "persona" && (
                    <PersonaTab persona={data.persona} onChange={setPerson} />
                )}

                {tab === "tts" && (
                    <TtsTab config={data.tts} onChange={setTts} />
                )}

                {tab === "actions" && (
                    <ActionsTab
                        config={actionsConfig}
                        onSave={onSaveActionsConfig}
                        onRequestRefresh={onRequestActionsConfig}
                        saving={actionsSaving}
                        error={actionsError}
                    />
                )}
            </div>
        </div>
    );
}
