import { useCallback, useEffect, useState } from "react";
import ActionsTab from "./settings/ActionsTab";
import type { ActionsConfig } from "./settings/actionsConfig";
import CameraTab from "./settings/CameraTab";
import ModelTab from "./settings/ModelTab";
import PersonaTab from "./settings/PersonaTab";
import TtsTab from "./settings/TtsTab";
import VisualTab from "./settings/VisualTab";
import {
    deleteModelConfig,
    fetchModelConfigs,
    saveModelConfig,
} from "./settings/modelApi";
import { loadLocal, saveLocal } from "./settings/storage";
import { css } from "./settings/styles";
import type {
    ModelConfig,
    Persona,
    SettingsData,
    TtsConfig,
    VisualConfig,
    CameraConfig,
} from "./settings/types";

type TabKey = "model" | "persona" | "tts" | "camera" | "visual" | "actions";

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
    const [modelError, setModelError] = useState<string | null>(null);

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
            const models = await fetchModelConfigs(hdrs);
            if (models) {
                setData((prev) => {
                    const next = { ...prev, models };
                    saveLocal(next);
                    return next;
                });
            }
        } catch (_) {
            setModelError("모델 목록을 불러오지 못했습니다.");
        }
        setLoading(false);
    }, [hdrs]);

    useEffect(() => {
        if (open) sync();
    }, [open, sync]);

    const saveModel = useCallback(
        async (m: ModelConfig) => {
            setLoading(true);
            setModelError(null);
            try {
                if (await saveModelConfig(m, hdrs)) {
                    await sync();
                    setEditing(null);
                } else {
                    setModelError("모델 설정을 저장하지 못했습니다.");
                }
            } catch (_) {
                setModelError("모델 설정을 저장하지 못했습니다.");
            }
            setLoading(false);
        },
        [hdrs, sync],
    );

    const deleteModel = useCallback(
        async (m: ModelConfig) => {
            if (loading) return;
            if (!m.id) {
                setModelError("저장되지 않은 모델은 삭제할 수 없습니다.");
                return;
            }
            const ok = window.confirm(`${m.model_name} 모델 설정을 삭제할까요?`);
            if (!ok) return;
            setLoading(true);
            setModelError(null);
            try {
                if (await deleteModelConfig(m, hdrs)) {
                    await sync();
                    setEditing(null);
                } else {
                    setModelError("모델 설정을 삭제하지 못했습니다.");
                }
            } catch (_) {
                setModelError("모델 설정을 삭제하지 못했습니다.");
            }
            setLoading(false);
        },
        [hdrs, loading, sync],
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

    const setVisual = useCallback((u: Partial<VisualConfig>) => {
        setData((prev) => {
            const next = { ...prev, visual: { ...prev.visual, ...u } };
            saveLocal(next);
            onSettingsChange?.(next);
            return next;
        });
    }, [onSettingsChange]);

    const setCamera = useCallback((u: Partial<CameraConfig>) => {
        setData((prev) => {
            const next = { ...prev, camera: { ...prev.camera, ...u } };
            saveLocal(next);
            window.dispatchEvent(
                new CustomEvent("jarvis-camera-settings-changed", {
                    detail: next.camera,
                }),
            );
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
                        style={css.tab(tab === "camera")}
                        onClick={() => setTab("camera")}
                    >
                        CAMERA
                    </button>
                    <button
                        style={css.tab(tab === "visual")}
                        onClick={() => setTab("visual")}
                    >
                        VISUAL
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
                        onDelete={deleteModel}
                        error={modelError}
                    />
                )}

                {tab === "persona" && (
                    <PersonaTab persona={data.persona} onChange={setPerson} />
                )}

                {tab === "tts" && (
                    <TtsTab config={data.tts} onChange={setTts} />
                )}

                {tab === "camera" && (
                    <CameraTab config={data.camera} onChange={setCamera} />
                )}

                {tab === "visual" && (
                    <VisualTab config={data.visual} onChange={setVisual} />
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
