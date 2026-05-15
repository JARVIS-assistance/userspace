import { useCallback, useEffect, useRef, useState } from "react";
import ActionsTab from "./settings/ActionsTab";
import type { ActionsConfig } from "./settings/actionsConfig";
import CameraTab from "./settings/CameraTab";
import ModelTab from "./settings/ModelTab";
import PersonaTab from "./settings/PersonaTab";
import TtsTab from "./settings/TtsTab";
import VisualTab from "./settings/VisualTab";
import WakewordTab from "./settings/WakewordTab";
import {
    deleteModelConfig,
    fetchModelConfigs,
    fetchModelSelection,
    saveModelConfig,
    saveModelSelection,
} from "./settings/modelApi";
import { fetchPersonas, savePersona } from "./settings/personaApi";
import { loadLocal, saveLocal } from "./settings/storage";
import { css } from "./settings/styles";
import type {
    ModelConfig,
    ModelSelection,
    Persona,
    SettingsData,
    TtsConfig,
    VisualConfig,
    CameraConfig,
    WakewordConfig,
} from "./settings/types";

type TabKey = "model" | "persona" | "tts" | "camera" | "wakeword" | "visual" | "actions";

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
    const [personaLoading, setPersonaLoading] = useState(false);
    const [personaError, setPersonaError] = useState<string | null>(null);
    const onSettingsChangeRef = useRef(onSettingsChange);

    useEffect(() => {
        onSettingsChangeRef.current = onSettingsChange;
    }, [onSettingsChange]);

    const emitSettingsChange = useCallback((next: SettingsData) => {
        onSettingsChangeRef.current?.(next);
    }, []);

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
            const [models, personas, selection] = await Promise.all([
                fetchModelConfigs(hdrs),
                fetchPersonas(hdrs),
                fetchModelSelection(hdrs),
            ]);
            if (models || personas || selection) {
                setData((prev) => {
                    const selectedPersona =
                        personas?.find((item) => item.selected) ??
                        personas?.[0];
                    const next = {
                        ...prev,
                        ...(models ? { models } : {}),
                        ...(selection ? { modelSelection: selection } : {}),
                        ...(selectedPersona
                            ? {
                                  persona: {
                                      ...prev.persona,
                                      ...selectedPersona,
                                  },
                              }
                            : {}),
                    };
                    saveLocal(next);
                    emitSettingsChange(next);
                    return next;
                });
            }
        } catch (_) {
            setModelError("모델 목록을 불러오지 못했습니다.");
        }
        setLoading(false);
    }, [emitSettingsChange, hdrs]);

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

    const persistModelSelection = useCallback(
        async (patch: Partial<ModelSelection>) => {
            setLoading(true);
            setModelError(null);
            const previousSelection = data.modelSelection;
            const optimisticSelection = { ...previousSelection, ...patch };
            setData((prev) => {
                const next = { ...prev, modelSelection: optimisticSelection };
                saveLocal(next);
                emitSettingsChange(next);
                return next;
            });
            try {
                const saved = await saveModelSelection(patch, hdrs);
                if (!saved) {
                    setModelError("모델 선택을 저장하지 못했습니다.");
                    setData((prev) => {
                        const next = {
                            ...prev,
                            modelSelection: previousSelection,
                        };
                        saveLocal(next);
                        emitSettingsChange(next);
                        return next;
                    });
                    return;
                }
                setData((prev) => {
                    const next = {
                        ...prev,
                        modelSelection: {
                            realtime_model_config_id:
                                saved.realtime_model_config_id ??
                                optimisticSelection.realtime_model_config_id,
                            deep_model_config_id:
                                saved.deep_model_config_id ??
                                optimisticSelection.deep_model_config_id,
                        },
                    };
                    saveLocal(next);
                    emitSettingsChange(next);
                    return next;
                });
            } catch (_) {
                setModelError("모델 선택을 저장하지 못했습니다.");
                setData((prev) => {
                    const next = { ...prev, modelSelection: previousSelection };
                    saveLocal(next);
                    emitSettingsChange(next);
                    return next;
                });
            } finally {
                setLoading(false);
            }
        },
        [data.modelSelection, emitSettingsChange, hdrs],
    );

    const setPerson = useCallback((u: Partial<Persona>) => {
        setData((prev) => {
            const next = { ...prev, persona: { ...prev.persona, ...u } };
            saveLocal(next);
            emitSettingsChange(next);
            return next;
        });
    }, [emitSettingsChange]);

    const persistPersona = useCallback(async () => {
        setPersonaLoading(true);
        setPersonaError(null);
        try {
            const saved = await savePersona(data.persona, hdrs);
            if (!saved) {
                setPersonaError("페르소나를 저장하지 못했습니다.");
                return;
            }
            setData((prev) => {
                const next = {
                    ...prev,
                    persona: { ...prev.persona, ...saved },
                };
                saveLocal(next);
                emitSettingsChange(next);
                return next;
            });
        } catch (_) {
            setPersonaError("페르소나를 저장하지 못했습니다.");
        } finally {
            setPersonaLoading(false);
        }
    }, [data.persona, emitSettingsChange, hdrs]);

    const setTts = useCallback((u: Partial<TtsConfig>) => {
        setData((prev) => {
            const next = { ...prev, tts: { ...prev.tts, ...u } };
            saveLocal(next);
            emitSettingsChange(next);
            return next;
        });
    }, [emitSettingsChange]);

    const setVisual = useCallback((u: Partial<VisualConfig>) => {
        setData((prev) => {
            const next = { ...prev, visual: { ...prev.visual, ...u } };
            saveLocal(next);
            emitSettingsChange(next);
            return next;
        });
    }, [emitSettingsChange]);

    const setCamera = useCallback((u: Partial<CameraConfig>) => {
        setData((prev) => {
            const next = { ...prev, camera: { ...prev.camera, ...u } };
            saveLocal(next);
            void (window as any).jarvisBridge?.setVisionEnabled?.(
                next.camera.enabled === true,
            );
            if (next.camera.enabled !== true) {
                void (window as any).jarvisBridge?.closeVisionWindow?.();
            }
            window.dispatchEvent(
                new CustomEvent("jarvis-camera-settings-changed", {
                    detail: next.camera,
                }),
            );
            emitSettingsChange(next);
            return next;
        });
    }, [emitSettingsChange]);

    const setWakeword = useCallback((u: Partial<WakewordConfig>) => {
        setData((prev) => {
            const next = { ...prev, wakeword: { ...prev.wakeword, ...u } };
            saveLocal(next);
            emitSettingsChange(next);
            return next;
        });
    }, [emitSettingsChange]);

    useEffect(() => {
        void (window as any).jarvisBridge?.setVisionEnabled?.(
            data.camera.enabled === true,
        );
        if (data.camera.enabled !== true) {
            void (window as any).jarvisBridge?.closeVisionWindow?.();
        }
    }, [data.camera.enabled]);

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
                        style={css.tab(tab === "wakeword")}
                        onClick={() => setTab("wakeword")}
                    >
                        WAKEWORD
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
                        selection={data.modelSelection}
                        onEdit={setEditing}
                        onSave={saveModel}
                        onDelete={deleteModel}
                        onSaveSelection={persistModelSelection}
                        error={modelError}
                    />
                )}

                {tab === "persona" && (
                    <PersonaTab
                        persona={data.persona}
                        loading={personaLoading}
                        error={personaError}
                        onChange={setPerson}
                        onSave={persistPersona}
                    />
                )}

                {tab === "tts" && (
                    <TtsTab config={data.tts} onChange={setTts} />
                )}

                {tab === "camera" && (
                    <CameraTab config={data.camera} onChange={setCamera} />
                )}

                {tab === "wakeword" && (
                    <WakewordTab config={data.wakeword} onChange={setWakeword} />
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
