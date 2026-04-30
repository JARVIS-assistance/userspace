import { useEffect, useMemo, useState } from "react";
import {
    ActionsConfig,
    FALLBACK_ALL_TYPES,
    TYPE_DESCRIPTIONS,
} from "./actionsConfig";
import { css } from "./styles";
import Toggle from "./Toggle";

interface Props {
    config: ActionsConfig | null;
    onSave: (patch: Partial<ActionsConfig>) => void;
    onRequestRefresh: () => void;
    saving: boolean;
    error: string | null;
}

export default function ActionsTab({
    config,
    onSave,
    onRequestRefresh,
    saving,
    error,
}: Props) {
    // 처음 열릴 때 한 번 데이터 요청
    useEffect(() => {
        onRequestRefresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const [enabledDraft, setEnabledDraft] = useState<Set<string>>(new Set());
    const [forceDraft, setForceDraft] = useState<Set<string>>(new Set());

    // 서버에서 받은 config로 draft 동기화
    useEffect(() => {
        if (!config) return;
        setEnabledDraft(new Set(config.enabled_types));
        setForceDraft(new Set(config.force_confirm_types));
    }, [config]);

    const allTypes = useMemo<string[]>(() => {
        if (config?.all_types && config.all_types.length > 0) return config.all_types;
        return FALLBACK_ALL_TYPES;
    }, [config]);

    if (!config) {
        return (
            <p
                style={{
                    color: "rgba(120,80,40,0.55)",
                    fontSize: 13,
                    textAlign: "center",
                    padding: "20px 0",
                }}
            >
                LOADING ACTIONS CONFIG...
            </p>
        );
    }

    const dirty =
        !setsEqual(enabledDraft, new Set(config.enabled_types)) ||
        !setsEqual(forceDraft, new Set(config.force_confirm_types));

    const toggleEnabled = (t: string, v: boolean) => {
        const next = new Set(enabledDraft);
        if (v) next.add(t);
        else next.delete(t);
        setEnabledDraft(next);
        // 비활성화하면 force_confirm에서도 빼는 게 자연스러움
        if (!v && forceDraft.has(t)) {
            const f = new Set(forceDraft);
            f.delete(t);
            setForceDraft(f);
        }
    };

    const toggleForce = (t: string, v: boolean) => {
        const next = new Set(forceDraft);
        if (v) next.add(t);
        else next.delete(t);
        setForceDraft(next);
    };

    const handleSave = () => {
        onSave({
            enabled_types: Array.from(enabledDraft),
            force_confirm_types: Array.from(forceDraft),
        });
    };

    const handleReset = () => {
        if (!config) return;
        setEnabledDraft(new Set(config.enabled_types));
        setForceDraft(new Set(config.force_confirm_types));
    };

    return (
        <div>
            <p
                style={{
                    fontSize: 11,
                    color: "rgba(120,80,40,0.6)",
                    fontFamily: "monospace",
                    letterSpacing: "0.05em",
                    margin: "0 0 16px",
                    lineHeight: 1.5,
                }}
            >
                ENABLED: 액션 타입 허용 여부 · CONFIRM: 사용자 확인 강제 여부
                (백엔드가 requires_confirm=false 보내도 적용)
            </p>

            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto auto",
                    columnGap: 12,
                    rowGap: 0,
                    alignItems: "center",
                    marginBottom: 16,
                }}
            >
                <ColumnHeader>TYPE</ColumnHeader>
                <ColumnHeader align="center">ENABLED</ColumnHeader>
                <ColumnHeader align="center">CONFIRM</ColumnHeader>

                {allTypes.map((t) => {
                    const en = enabledDraft.has(t);
                    const fc = forceDraft.has(t);
                    return (
                        <Row
                            key={t}
                            type={t}
                            enabled={en}
                            forceConfirm={fc}
                            onEnabledChange={(v) => toggleEnabled(t, v)}
                            onForceConfirmChange={(v) => toggleForce(t, v)}
                        />
                    );
                })}
            </div>

            {error && (
                <p
                    style={{
                        fontSize: 11,
                        color: "rgba(220,80,60,0.85)",
                        fontFamily: "monospace",
                        margin: "0 0 12px",
                    }}
                >
                    {error}
                </p>
            )}

            <div
                style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 10,
                }}
            >
                <button
                    style={css.btn("ghost")}
                    onClick={handleReset}
                    disabled={!dirty || saving}
                >
                    되돌리기
                </button>
                <button
                    style={css.btn("primary")}
                    onClick={handleSave}
                    disabled={!dirty || saving}
                >
                    {saving ? "저장 중..." : "저장"}
                </button>
            </div>
        </div>
    );
}

// ── 서브 컴포넌트 ────────────────────────────────────

function ColumnHeader({
    children,
    align = "left",
}: {
    children: React.ReactNode;
    align?: "left" | "center";
}) {
    return (
        <div
            style={{
                fontSize: 10,
                letterSpacing: "0.18em",
                color: "rgba(120,80,40,0.55)",
                fontFamily: "monospace",
                padding: "8px 0",
                borderBottom: "1px solid rgba(120,80,30,0.18)",
                textAlign: align,
            }}
        >
            {children}
        </div>
    );
}

function Row({
    type,
    enabled,
    forceConfirm,
    onEnabledChange,
    onForceConfirmChange,
}: {
    type: string;
    enabled: boolean;
    forceConfirm: boolean;
    onEnabledChange: (v: boolean) => void;
    onForceConfirmChange: (v: boolean) => void;
}) {
    return (
        <>
            <div
                style={{
                    padding: "10px 0",
                    borderBottom: "1px solid rgba(120,80,30,0.1)",
                }}
            >
                <div
                    style={{
                        fontSize: 13,
                        color: "rgba(210,180,140,0.92)",
                        fontFamily: "monospace",
                    }}
                >
                    {type}
                </div>
                <div
                    style={{
                        fontSize: 10,
                        color: "rgba(120,80,40,0.55)",
                        marginTop: 2,
                    }}
                >
                    {TYPE_DESCRIPTIONS[type] || ""}
                </div>
            </div>
            <CellToggle value={enabled} onChange={onEnabledChange} />
            <CellToggle
                value={forceConfirm}
                onChange={onForceConfirmChange}
                disabled={!enabled}
            />
        </>
    );
}

function CellToggle({
    value,
    onChange,
    disabled = false,
}: {
    value: boolean;
    onChange: (v: boolean) => void;
    disabled?: boolean;
}) {
    return (
        <div
            style={{
                padding: "10px 0",
                borderBottom: "1px solid rgba(120,80,30,0.1)",
                display: "flex",
                justifyContent: "center",
                opacity: disabled ? 0.4 : 1,
                pointerEvents: disabled ? "none" : "auto",
            }}
        >
            <Toggle value={value} onChange={onChange} label="" />
        </div>
    );
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
}
