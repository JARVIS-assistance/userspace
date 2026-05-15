import type React from "react";

interface Props {
    text: string;
    active: boolean;
    onClose: () => void;
}

export default function DeepResponsePanel({ text, active, onClose }: Props) {
    return (
        <section
            aria-label="Deep response"
            style={{
                position: "fixed",
                left: 16,
                top: 62,
                bottom: 82,
                width: "min(560px, calc(100vw - 32px))",
                zIndex: 7550,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                color: "rgba(235,225,210,0.94)",
                background: "rgba(10,10,10,0.9)",
                border: "1px solid rgba(150,120,220,0.35)",
                borderRadius: 8,
                boxShadow: "0 20px 54px rgba(0,0,0,0.42)",
                backdropFilter: "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
            }}
        >
            <header
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 12px 8px",
                    borderBottom: "1px solid rgba(150,120,220,0.18)",
                    fontFamily: "monospace",
                }}
            >
                <span
                    style={{
                        color: active
                            ? "rgba(170,150,230,0.92)"
                            : "rgba(150,210,150,0.92)",
                        fontSize: 10,
                        letterSpacing: "0.14em",
                    }}
                >
                    {active ? "THINKING" : "DONE"}
                </span>
                <span
                    style={{
                        color: "rgba(150,170,200,0.72)",
                        fontSize: 10,
                        letterSpacing: "0.1em",
                    }}
                >
                    DEEP RESPONSE
                </span>
                <button
                    type="button"
                    onClick={onClose}
                    title="Close deep response"
                    style={{
                        marginLeft: "auto",
                        border: "none",
                        background: "transparent",
                        color: "rgba(210,180,140,0.64)",
                        cursor: "pointer",
                        fontSize: 14,
                        lineHeight: 1,
                        padding: 2,
                    }}
                >
                    {"✕"}
                </button>
            </header>

            <div
                style={{
                    flex: 1,
                    overflow: "auto",
                    padding: "14px 16px 18px",
                    fontSize: 13,
                    lineHeight: 1.6,
                    color: "rgba(235,230,220,0.9)",
                }}
            >
                {text ? (
                    <MarkdownView text={text} />
                ) : (
                    <div style={{ color: "rgba(210,180,140,0.68)" }}>
                        깊이 생각해보고 있어요.
                    </div>
                )}
            </div>
        </section>
    );
}

function MarkdownView({ text }: { text: string }) {
    const blocks = parseMarkdownBlocks(text);
    return (
        <div>
            {blocks.map((block, index) => {
                if (block.type === "code") {
                    return (
                        <pre
                            key={index}
                            style={{
                                margin: "10px 0",
                                padding: "10px 12px",
                                overflowX: "auto",
                                borderRadius: 6,
                                background: "rgba(0,0,0,0.36)",
                                border: "1px solid rgba(150,120,220,0.2)",
                                color: "rgba(230,230,220,0.92)",
                                fontFamily: "monospace",
                                fontSize: 12,
                                lineHeight: 1.5,
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                            }}
                        >
                            {block.text}
                        </pre>
                    );
                }
                if (block.type === "heading") {
                    return (
                        <h3
                            key={index}
                            style={{
                                margin: index === 0 ? "0 0 10px" : "16px 0 8px",
                                color: "rgba(220,200,245,0.96)",
                                fontSize: 15,
                                lineHeight: 1.35,
                                fontWeight: 600,
                            }}
                        >
                            {renderInlineMarkdown(block.text)}
                        </h3>
                    );
                }
                if (block.type === "list") {
                    const ListTag = block.ordered ? "ol" : "ul";
                    return (
                        <ListTag
                            key={index}
                            style={{
                                margin: "8px 0 10px",
                                paddingLeft: 20,
                            }}
                        >
                            {block.items.map((item, itemIndex) => (
                                <li key={itemIndex} style={{ marginBottom: 5 }}>
                                    {renderInlineMarkdown(item)}
                                </li>
                            ))}
                        </ListTag>
                    );
                }
                if (block.type === "table") {
                    return (
                        <div key={index} style={{ overflowX: "auto", margin: "10px 0" }}>
                            <table
                                style={{
                                    width: "100%",
                                    borderCollapse: "collapse",
                                    fontSize: 12,
                                    lineHeight: 1.45,
                                }}
                            >
                                <thead>
                                    <tr>
                                        {block.headers.map((header, cellIndex) => (
                                            <th
                                                key={cellIndex}
                                                style={tableCellStyle(true)}
                                            >
                                                {renderInlineMarkdown(header)}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {block.rows.map((row, rowIndex) => (
                                        <tr key={rowIndex}>
                                            {row.map((cell, cellIndex) => (
                                                <td
                                                    key={cellIndex}
                                                    style={tableCellStyle(false)}
                                                >
                                                    {renderInlineMarkdown(cell)}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    );
                }
                return (
                    <p
                        key={index}
                        style={{
                            margin: index === 0 ? "0 0 10px" : "10px 0",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                        }}
                    >
                        {renderInlineMarkdown(block.text)}
                    </p>
                );
            })}
        </div>
    );
}

type MarkdownBlock =
    | { type: "paragraph"; text: string }
    | { type: "heading"; text: string }
    | { type: "list"; items: string[]; ordered: boolean }
    | { type: "table"; headers: string[]; rows: string[][] }
    | { type: "code"; text: string };

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const blocks: MarkdownBlock[] = [];
    let paragraph: string[] = [];
    let listItems: string[] = [];
    let listOrdered = false;
    let codeLines: string[] = [];
    let inCode = false;

    const flushParagraph = () => {
        if (paragraph.length === 0) return;
        blocks.push({ type: "paragraph", text: paragraph.join("\n").trim() });
        paragraph = [];
    };
    const flushList = () => {
        if (listItems.length === 0) return;
        blocks.push({ type: "list", items: listItems, ordered: listOrdered });
        listItems = [];
        listOrdered = false;
    };

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (line.trim().startsWith("```")) {
            if (inCode) {
                blocks.push({ type: "code", text: codeLines.join("\n") });
                codeLines = [];
                inCode = false;
            } else {
                flushParagraph();
                flushList();
                inCode = true;
            }
            continue;
        }

        if (inCode) {
            codeLines.push(line);
            continue;
        }

        if (!line.trim()) {
            flushParagraph();
            flushList();
            continue;
        }

        const heading = line.match(/^#{1,4}\s+(.+)$/u);
        if (heading) {
            flushParagraph();
            flushList();
            blocks.push({ type: "heading", text: heading[1].trim() });
            continue;
        }

        if (
            line.includes("|")
            && index + 1 < lines.length
            && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/u.test(lines[index + 1])
        ) {
            flushParagraph();
            flushList();
            const headers = splitTableRow(line);
            const rows: string[][] = [];
            index += 2;
            while (index < lines.length && lines[index].includes("|")) {
                rows.push(splitTableRow(lines[index]));
                index += 1;
            }
            index -= 1;
            blocks.push({ type: "table", headers, rows });
            continue;
        }

        const list = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/u);
        if (list) {
            flushParagraph();
            const ordered = /^\s*\d+\./u.test(line);
            if (listItems.length > 0 && listOrdered !== ordered) {
                flushList();
            }
            listOrdered = ordered;
            listItems.push(list[1].trim());
            continue;
        }

        flushList();
        paragraph.push(line);
    }

    if (inCode) blocks.push({ type: "code", text: codeLines.join("\n") });
    flushParagraph();
    flushList();
    return blocks;
}

function splitTableRow(line: string): string[] {
    return line
        .trim()
        .replace(/^\|/u, "")
        .replace(/\|$/u, "")
        .split("|")
        .map((cell) => cell.trim());
}

function tableCellStyle(header: boolean): React.CSSProperties {
    return {
        padding: "7px 8px",
        border: "1px solid rgba(150,120,220,0.22)",
        background: header ? "rgba(150,120,220,0.16)" : "rgba(0,0,0,0.18)",
        color: header ? "rgba(230,220,255,0.96)" : "rgba(235,230,220,0.9)",
        textAlign: "left",
        verticalAlign: "top",
        fontWeight: header ? 600 : 400,
    };
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
    const nodes: React.ReactNode[] = [];
    const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/gu;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
        if (match.index > lastIndex) {
            nodes.push(text.slice(lastIndex, match.index));
        }
        const token = match[0];
        if (token.startsWith("`")) {
            nodes.push(
                <code
                    key={nodes.length}
                    style={{
                        padding: "1px 4px",
                        borderRadius: 4,
                        background: "rgba(150,120,220,0.18)",
                        color: "rgba(230,220,255,0.96)",
                        fontFamily: "monospace",
                        fontSize: "0.94em",
                    }}
                >
                    {token.slice(1, -1)}
                </code>,
            );
        } else {
            nodes.push(
                <strong key={nodes.length} style={{ color: "rgba(245,230,205,0.96)" }}>
                    {token.slice(2, -2)}
                </strong>,
            );
        }
        lastIndex = match.index + token.length;
    }

    if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
    return nodes;
}
