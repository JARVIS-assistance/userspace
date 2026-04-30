export function cleanAssistantText(value: string): string {
    return value
        .replace(/```(?:json|actions)?[\s\S]*?```/gi, " ")
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
        .replace(/`{1,3}/g, "")
        .replace(/^#{1,6}\s*/gm, "")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/^\s*[-*]\s+/gm, "")
        .replace(/^\s*---+\s*$/gm, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export function displayPlanStep(payload: Record<string, any>): string {
    const raw = String(
        payload.description || payload.title || payload.text || "",
    ).trim();
    const cleaned = cleanAssistantText(raw);
    return cleaned || String(payload.title || "").trim();
}

export function displayDoneText(payload: Record<string, any>): string {
    const actionText = displayActionResults(payload);
    if (actionText) return actionText;

    const summary = String(payload.summary || "").trim();
    if (summary && summary !== "direct client action dispatched") {
        return summary;
    }
    return cleanAssistantText(String(payload.text || ""));
}

function displayActionResults(payload: Record<string, any>): string {
    const results = Array.isArray(payload.action_results)
        ? payload.action_results
        : [];
    if (results.length === 0) return "";

    const completed = results.filter((item) => item?.status === "completed");
    const failed = results.filter((item) => item?.status && item.status !== "completed");

    if (completed.length === 1 && failed.length === 0) {
        return displaySingleCompletedAction(completed[0]);
    }

    if (completed.length > 0 && failed.length === 0) {
        return `외부 작업 ${completed.length}개를 완료했습니다.`;
    }

    if (failed.length > 0 && completed.length === 0) {
        return displaySingleFailedAction(failed[0]);
    }

    if (failed.length > 0) {
        return `외부 작업 ${completed.length}개를 완료했고 ${failed.length}개는 실패했습니다.`;
    }

    return "";
}

function displaySingleCompletedAction(result: Record<string, any>): string {
    const action = result.action || {};
    const output = result.output || {};
    const type = String(action.type || "");
    const command = String(output.command || action.command || "");

    if (type === "browser_control" && command === "select_result") {
        const index = Number(output.index || action.args?.index || 1);
        const title = firstLine(output.title);
        return title
            ? `${index}번째 검색 결과를 열었습니다: ${title}`
            : `${index}번째 검색 결과를 열었습니다.`;
    }

    if (type === "browser_control" || type === "open_url") {
        const title = firstLine(output.title);
        const opened = String(output.opened || action.target || "").trim();
        if (title) return `브라우저에서 열었습니다: ${title}`;
        if (opened) return `브라우저에서 페이지를 열었습니다.`;
        return "브라우저 작업을 완료했습니다.";
    }

    if (type === "web_search") {
        return "검색을 완료했습니다.";
    }

    if (type === "notify") {
        return "알림을 표시했습니다.";
    }

    const description = cleanAssistantText(String(action.description || ""));
    return description ? `${description} 완료` : "외부 작업을 완료했습니다.";
}

function displaySingleFailedAction(result: Record<string, any>): string {
    const action = result.action || {};
    const description = cleanAssistantText(String(action.description || ""));
    const error = formatActionError(String(result.error || ""));
    if (description && error) return `${description}에 실패했습니다. ${error}`;
    if (description) return `${description}에 실패했습니다.`;
    return error ? `외부 작업에 실패했습니다. ${error}` : "외부 작업에 실패했습니다.";
}

function firstLine(value: unknown): string {
    return cleanAssistantText(String(value || ""))
        .split(/\s{2,}|\n/u)[0]
        .trim()
        .slice(0, 80);
}

function formatActionError(error: string): string {
    if (/JavaScript from Apple Events|Apple Events/i.test(error)) {
        return "Chrome에서 보기 > 개발자 > Apple Events의 JavaScript 허용을 켠 뒤 다시 시도하세요.";
    }
    if (/no active browser tab/i.test(error)) {
        return "활성 브라우저 탭을 앞으로 가져온 뒤 다시 시도하세요.";
    }
    if (/timed out|timeout/i.test(error)) {
        return "결과가 제시간에 확인되지 않았습니다.";
    }
    return cleanAssistantText(error);
}
