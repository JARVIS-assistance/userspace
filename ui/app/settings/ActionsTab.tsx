import { useEffect, useMemo, useState } from "react";
import {
    ActionsConfig,
    CAPABILITY_DESCRIPTIONS,
    FALLBACK_ALL_CAPABILITIES,
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

const GROUPS = [
    {
        title: "Browser",
        capabilities: [
            "browser.open",
            "browser.navigate",
            "browser.search",
            "browser.extract_dom",
            "browser.click",
            "browser.type",
        ],
    },
    { title: "Applications", capabilities: ["app.open", "app.focus"] },
    {
        title: "Input",
        capabilities: ["keyboard.type", "keyboard.hotkey", "mouse.click", "mouse.drag"],
    },
    { title: "Screen", capabilities: ["screen.screenshot"] },
    {
        title: "System",
        capabilities: ["terminal.run", "file.read", "file.write", "clipboard.copy", "clipboard.paste"],
    },
];

export default function ActionsTab({
    config,
    onSave,
    onRequestRefresh,
    saving,
    error,
}: Props) {
    useEffect(() => {
        onRequestRefresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const [enabledDraft, setEnabledDraft] = useState<Set<string>>(new Set());
    const [confirmDraft, setConfirmDraft] = useState<Set<string>>(new Set());
    const [browserDraft, setBrowserDraft] = useState({
        default_browser: "chrome",
        search_engine: "google",
    });
    const [testStatus, setTestStatus] = useState("");

    useEffect(() => {
        if (!config) return;
        setEnabledDraft(new Set(config.enabled_capabilities || []));
        setConfirmDraft(new Set(config.force_confirm_capabilities || []));
        setBrowserDraft({
            default_browser: config.browser?.default_browser || "chrome",
            search_engine: config.browser?.search_engine || "google",
        });
    }, [config]);

    const allCapabilities = useMemo(() => {
        if (config?.all_capabilities?.length) return config.all_capabilities;
        return FALLBACK_ALL_CAPABILITIES;
    }, [config]);

    if (!config) {
        return (
            <p style={emptyStyle}>
                LOADING ACTIONS CONFIG...
            </p>
        );
    }

    const dirty =
        !setsEqual(enabledDraft, new Set(config.enabled_capabilities || []))
        || !setsEqual(confirmDraft, new Set(config.force_confirm_capabilities || []))
        || browserDraft.default_browser !== (config.browser?.default_browser || "chrome")
        || browserDraft.search_engine !== (config.browser?.search_engine || "google");

    const toggleEnabled = (capability: string, value: boolean) => {
        const next = new Set(enabledDraft);
        if (value) next.add(capability);
        else next.delete(capability);
        setEnabledDraft(next);
        if (!value && confirmDraft.has(capability)) {
            const confirmNext = new Set(confirmDraft);
            confirmNext.delete(capability);
            setConfirmDraft(confirmNext);
        }
    };

    const toggleConfirm = (capability: string, value: boolean) => {
        const next = new Set(confirmDraft);
        if (value) next.add(capability);
        else next.delete(capability);
        setConfirmDraft(next);
    };

    const handleSave = () => {
        onSave({
            enabled_capabilities: Array.from(enabledDraft),
            force_confirm_capabilities: Array.from(confirmDraft),
            browser: browserDraft,
        } as Partial<ActionsConfig>);
    };

    const handleReset = () => {
        setEnabledDraft(new Set(config.enabled_capabilities || []));
        setConfirmDraft(new Set(config.force_confirm_capabilities || []));
        setBrowserDraft({
            default_browser: config.browser?.default_browser || "chrome",
            search_engine: config.browser?.search_engine || "google",
        });
        setTestStatus("");
    };

    const runTest = (kind: "open" | "search") => {
        const capability = kind === "open" ? "browser.open" : "browser.search";
        if (!enabledDraft.has(capability)) {
            setTestStatus(`${capability} disabled`);
            return;
        }
        setTestStatus(
            kind === "open"
                ? `Ready: browser.open via ${browserDraft.default_browser}`
                : `Ready: browser.search via ${browserDraft.search_engine}`,
        );
    };

    return (
        <div>
            <p style={hintStyle}>
                BACKEND QUEUED ACTIONS ONLY · action_id가 있는 큐 액션만 실행
            </p>

            <section style={sectionStyle}>
                <div style={sectionHeaderStyle}>Browser</div>
                <div style={selectRowStyle}>
                    <label style={labelStyle}>
                        Default browser
                        <select
                            value={browserDraft.default_browser}
                            onChange={(event) => setBrowserDraft((s) => ({
                                ...s,
                                default_browser: event.target.value,
                            }))}
                            style={selectStyle}
                        >
                            {["chrome", "safari", "firefox", "edge", "default"].map((item) => (
                                <option key={item} value={item}>{item}</option>
                            ))}
                        </select>
                    </label>
                    <label style={labelStyle}>
                        Search engine
                        <select
                            value={browserDraft.search_engine}
                            onChange={(event) => setBrowserDraft((s) => ({
                                ...s,
                                search_engine: event.target.value,
                            }))}
                            style={selectStyle}
                        >
                            {["google", "naver", "duckduckgo"].map((item) => (
                                <option key={item} value={item}>{item}</option>
                            ))}
                        </select>
                    </label>
                </div>
                <div style={testRowStyle}>
                    <button style={css.btn("ghost")} onClick={() => runTest("open")}>
                        Test open
                    </button>
                    <button style={css.btn("ghost")} onClick={() => runTest("search")}>
                        Test search
                    </button>
                    <span style={statusStyle}>{testStatus || "No test run"}</span>
                </div>
            </section>

            {GROUPS.map((group) => (
                <CapabilityGroup
                    key={group.title}
                    title={group.title}
                    capabilities={group.capabilities.filter((cap) => allCapabilities.includes(cap))}
                    enabled={enabledDraft}
                    confirm={confirmDraft}
                    onEnabledChange={toggleEnabled}
                    onConfirmChange={toggleConfirm}
                />
            ))}

            {error && <p style={errorStyle}>{error}</p>}

            <div style={footerStyle}>
                <button style={css.btn("ghost")} onClick={handleReset} disabled={!dirty || saving}>
                    되돌리기
                </button>
                <button style={css.btn("primary")} onClick={handleSave} disabled={!dirty || saving}>
                    {saving ? "저장 중..." : "저장"}
                </button>
            </div>
        </div>
    );
}

function CapabilityGroup({
    title,
    capabilities,
    enabled,
    confirm,
    onEnabledChange,
    onConfirmChange,
}: {
    title: string;
    capabilities: string[];
    enabled: Set<string>;
    confirm: Set<string>;
    onEnabledChange: (capability: string, value: boolean) => void;
    onConfirmChange: (capability: string, value: boolean) => void;
}) {
    return (
        <section style={sectionStyle}>
            <div style={gridStyle}>
                <div style={sectionHeaderStyle}>{title}</div>
                <ColumnHeader>ENABLED</ColumnHeader>
                <ColumnHeader>CONFIRM</ColumnHeader>
                {capabilities.map((capability) => (
                    <CapabilityRow
                        key={capability}
                        capability={capability}
                        enabled={enabled.has(capability)}
                        confirm={confirm.has(capability)}
                        onEnabledChange={(value) => onEnabledChange(capability, value)}
                        onConfirmChange={(value) => onConfirmChange(capability, value)}
                    />
                ))}
            </div>
        </section>
    );
}

function CapabilityRow({
    capability,
    enabled,
    confirm,
    onEnabledChange,
    onConfirmChange,
}: {
    capability: string;
    enabled: boolean;
    confirm: boolean;
    onEnabledChange: (value: boolean) => void;
    onConfirmChange: (value: boolean) => void;
}) {
    return (
        <>
            <div style={capabilityCellStyle}>
                <div style={capabilityNameStyle}>{capability}</div>
                <div style={capabilityDescriptionStyle}>
                    {CAPABILITY_DESCRIPTIONS[capability] || ""}
                </div>
            </div>
            <CellToggle value={enabled} onChange={onEnabledChange} />
            <CellToggle value={confirm} onChange={onConfirmChange} disabled={!enabled} />
        </>
    );
}

function ColumnHeader({ children }: { children: React.ReactNode }) {
    return <div style={columnHeaderStyle}>{children}</div>;
}

function CellToggle({
    value,
    onChange,
    disabled = false,
}: {
    value: boolean;
    onChange: (value: boolean) => void;
    disabled?: boolean;
}) {
    return (
        <div style={{ ...toggleCellStyle, opacity: disabled ? 0.4 : 1 }}>
            <Toggle value={value} onChange={onChange} label="" />
        </div>
    );
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
}

const emptyStyle: React.CSSProperties = {
    color: "rgba(120,80,40,0.55)",
    fontSize: 13,
    textAlign: "center",
    padding: "20px 0",
};

const hintStyle: React.CSSProperties = {
    fontSize: 11,
    color: "rgba(120,80,40,0.6)",
    fontFamily: "monospace",
    letterSpacing: "0.05em",
    margin: "0 0 16px",
    lineHeight: 1.5,
};

const sectionStyle: React.CSSProperties = {
    borderTop: "1px solid rgba(120,80,30,0.18)",
    padding: "12px 0",
};

const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr 78px 78px",
    columnGap: 12,
    alignItems: "center",
};

const sectionHeaderStyle: React.CSSProperties = {
    fontSize: 11,
    letterSpacing: "0.16em",
    color: "rgba(220,150,80,0.85)",
    fontFamily: "monospace",
    padding: "8px 0",
};

const columnHeaderStyle: React.CSSProperties = {
    fontSize: 9,
    letterSpacing: "0.12em",
    color: "rgba(120,80,40,0.55)",
    fontFamily: "monospace",
    textAlign: "center",
};

const capabilityCellStyle: React.CSSProperties = {
    padding: "9px 0",
    borderTop: "1px solid rgba(120,80,30,0.08)",
};

const capabilityNameStyle: React.CSSProperties = {
    fontSize: 12,
    color: "rgba(210,180,140,0.92)",
    fontFamily: "monospace",
};

const capabilityDescriptionStyle: React.CSSProperties = {
    fontSize: 10,
    color: "rgba(120,80,40,0.55)",
    marginTop: 2,
};

const toggleCellStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "center",
    borderTop: "1px solid rgba(120,80,30,0.08)",
    padding: "9px 0",
};

const selectRowStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
};

const labelStyle: React.CSSProperties = {
    display: "grid",
    gap: 6,
    color: "rgba(160,130,100,0.8)",
    fontSize: 11,
    fontFamily: "monospace",
};

const selectStyle: React.CSSProperties = {
    background: "#141414",
    color: "rgba(230,200,160,0.95)",
    border: "1px solid rgba(120,80,30,0.35)",
    borderRadius: 6,
    padding: "8px 10px",
};

const testRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
};

const statusStyle: React.CSSProperties = {
    fontSize: 10,
    color: "rgba(150,180,210,0.75)",
    fontFamily: "monospace",
};

const errorStyle: React.CSSProperties = {
    fontSize: 11,
    color: "rgba(220,80,60,0.85)",
    fontFamily: "monospace",
    margin: "0 0 12px",
};

const footerStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
};
