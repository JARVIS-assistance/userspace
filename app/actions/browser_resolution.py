"""Helpers for resolving "open this result in the current browser" requests."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse


_OPEN_WORDS = ("들어가", "열어", "선택", "클릭", "이동")
_CURRENT_BROWSER_MARKERS = (
    "지금 브라우저",
    "현재 브라우저",
    "브라우저에서",
    "검색 결과에서",
    "현재 페이지",
)
_PAGE_HINTS = ("레시피", "블로그", "기사", "뉴스", "사이트", "페이지")
_REMOVE_PATTERNS = (
    r"지금",
    r"현재",
    r"브라우저에서",
    r"브라우저",
    r"검색\s*결과에서",
    r"현재\s*페이지에서",
    r"페이지",
    r"링크",
    r"로\s*가줘",
    r"으로\s*가줘",
    r"들어가\s*줘",
    r"들어가줘",
    r"들어가",
    r"열어\s*줘",
    r"열어줘",
    r"열어",
    r"선택해\s*줘",
    r"선택해줘",
    r"선택",
    r"클릭해\s*줘",
    r"클릭해줘",
    r"클릭",
    r"이동해\s*줘",
    r"이동해줘",
    r"이동",
)
_STOPWORDS = {
    "지금",
    "현재",
    "브라우저",
    "페이지",
    "링크",
    "결과",
    "검색",
    "들어가",
    "열어",
    "선택",
    "클릭",
    "이동",
    "줘",
}


def extract_current_browser_open_query(text: str) -> str | None:
    """Return target query for Korean current-browser open commands.

    This intentionally excludes normal search requests such as
    "브라우저 열어서 ... 검색해줘".
    """
    raw = " ".join(str(text or "").split())
    if not raw:
        return None
    if "검색해" in raw or "검색 해" in raw:
        return None
    has_current_marker = any(marker in raw for marker in _CURRENT_BROWSER_MARKERS)
    has_page_hint = any(hint in raw for hint in _PAGE_HINTS)
    if not has_current_marker and not has_page_hint:
        return None
    if not any(word in raw for word in _OPEN_WORDS):
        return None

    query = raw
    for pattern in _REMOVE_PATTERNS:
        query = re.sub(pattern, " ", query)
    query = " ".join(query.split()).strip(" '\"")
    return query or None


def choose_best_link(links: list[dict[str, Any]], query: str) -> dict[str, Any] | None:
    tokens = _tokens(query)
    if not tokens:
        return None

    best: tuple[float, dict[str, Any]] | None = None
    for position, link in enumerate(links):
        href = str(link.get("href") or "").strip()
        text = str(link.get("text") or "").strip()
        title = str(link.get("title") or "").strip()
        aria = str(link.get("ariaLabel") or "").strip()
        if not href.startswith(("http://", "https://")):
            continue

        hay_text = _norm(" ".join([text, title, aria]))
        hay_href = _norm(href)
        score = 0.0
        query_norm = _norm(query)
        if query_norm and query_norm in hay_text:
            score += 15
        for token in tokens:
            if token in hay_text:
                score += 4
            if token in hay_href:
                score += 1
        score += max(0, 2 - position * 0.05)

        host = urlparse(href).netloc.lower()
        if "google." in host:
            score -= 5

        if best is None or score > best[0]:
            best = (score, link)

    if best is None or best[0] < max(4, len(tokens) * 2):
        return None
    return best[1]


def _tokens(value: str) -> list[str]:
    normalized = _norm(value)
    tokens = [
        token
        for token in re.split(r"[^0-9a-z가-힣]+", normalized)
        if len(token) >= 2 and token not in _STOPWORDS
    ]
    return list(dict.fromkeys(tokens))


def _norm(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").lower()).strip()
