"""Basic browser control handler."""

from __future__ import annotations

import asyncio
import json
import sys
from typing import Any

from app.actions.handlers._browsers import DEFAULT_BROWSER, open_in_browser
from app.actions.handlers.base import HandlerError
from app.actions.models import ClientAction


def make_browser_control(enabled: bool):
    async def browser_control(action: ClientAction) -> dict[str, Any]:
        if not enabled:
            raise HandlerError("browser_control disabled by policy")
        command = (action.command or "open_url").lower()
        target = (action.target or action.payload or "").strip()

        if command in {"open", "open_url", "navigate"}:
            if not target.startswith(("http://", "https://")):
                raise HandlerError("browser_control navigate requires http(s) URL")
            browser = ""
            if action.args:
                raw = action.args.get("browser")
                if isinstance(raw, str):
                    browser = raw
            try:
                used = await open_in_browser(target, browser=browser or DEFAULT_BROWSER)
            except RuntimeError as e:
                raise HandlerError(str(e)) from e
            return {"command": command, "opened": target, "browser": used}

        if command == "select_result":
            return await _select_result(action)

        if command == "extract_dom":
            return await _extract_dom(action)

        if sys.platform != "darwin":
            raise HandlerError(f"browser_control {command!r} not supported on {sys.platform}")

        if command == "back":
            script = 'tell application "System Events" to key code 123 using {command down}'
        elif command == "forward":
            script = 'tell application "System Events" to key code 124 using {command down}'
        elif command == "reload":
            script = 'tell application "System Events" to keystroke "r" using {command down}'
        else:
            raise HandlerError(f"unsupported browser_control command: {command!r}")
        proc = await asyncio.create_subprocess_exec(
            "osascript",
            "-e",
            script,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, err = await proc.communicate()
        if proc.returncode != 0:
            raise HandlerError(
                f"browser_control failed rc={proc.returncode}: {err.decode(errors='replace')[:300]}"
            )
        return {"command": command}

    return browser_control


async def _select_result(action: ClientAction) -> dict[str, Any]:
    output_base = {"command": "select_result"}
    try:
        index = int((action.args or {}).get("index", 1))
    except (TypeError, ValueError) as e:
        raise HandlerError(
            "invalid select_result index",
            output={**output_base, "index": (action.args or {}).get("index")},
        ) from e
    if index < 1:
        raise HandlerError(
            "invalid select_result index",
            output={**output_base, "index": index},
        )

    if sys.platform != "darwin":
        raise HandlerError(
            f"browser_control select_result not supported on {sys.platform}",
            output={**output_base, "index": index},
        )

    js = _select_result_javascript(index)
    errors: list[str] = []
    for browser in ("Google Chrome", "Safari"):
        try:
            result = await _execute_browser_javascript(browser, js)
        except RuntimeError as e:
            errors.append(f"{browser}: {e}")
            continue
        result["command"] = "select_result"
        result["index"] = index
        result["browser"] = browser
        return result

    error = "search result link not found"
    if errors:
        error = _summarize_select_result_errors(errors)
    raise HandlerError(error, output={**output_base, "index": index})


async def _extract_dom(action: ClientAction) -> dict[str, Any]:
    args = action.args or {}
    output_base = {"command": "extract_dom"}
    try:
        max_links = int(args.get("max_links", 120))
    except (TypeError, ValueError) as e:
        raise HandlerError(
            "invalid extract_dom max_links",
            output={**output_base, "max_links": args.get("max_links")},
        ) from e
    if max_links < 1:
        raise HandlerError(
            "invalid extract_dom max_links",
            output={**output_base, "max_links": max_links},
        )
    max_links = min(max_links, 500)

    if sys.platform != "darwin":
        raise HandlerError(
            f"browser_control extract_dom not supported on {sys.platform}",
            output={**output_base, "max_links": max_links},
        )

    include_links = bool(args.get("include_links", True))
    purpose = str(args.get("purpose") or "")
    query = str(args.get("query") or "")
    js = _extract_dom_javascript(
        include_links=include_links,
        max_links=max_links,
    )
    errors: list[str] = []
    for browser in ("Google Chrome", "Safari"):
        try:
            result = await _execute_browser_javascript(browser, js)
        except RuntimeError as e:
            errors.append(f"{browser}: {e}")
            continue
        result["command"] = "extract_dom"
        result["browser"] = browser
        if purpose:
            result["purpose"] = purpose
        if query:
            result["query"] = query
        return result

    error = "browser DOM extraction failed"
    if errors:
        error = _summarize_browser_javascript_errors(errors, "extract_dom")
    raise HandlerError(error, output=output_base)


def _summarize_select_result_errors(errors: list[str]) -> str:
    return _summarize_browser_javascript_errors(errors, "select_result")


def _summarize_browser_javascript_errors(errors: list[str], command: str) -> str:
    joined = "; ".join(errors)
    if (
        "AppleScript를 통한 자바스크립트 실행 기능이 꺼져 있습니다" in joined
        or "Allow JavaScript from Apple Events" in joined
        or "applescript" in joined.lower()
    ):
        return (
            "Chrome JavaScript from Apple Events is disabled. "
            "Enable Chrome menu View > Developer > Allow JavaScript from Apple Events, "
            f"then retry {command}."
        )
    if "no active browser tab" in joined:
        return "no active browser tab"
    return joined[:500]


def _select_result_javascript(index: int) -> str:
    return f"""
(() => {{
  const index = {index};
  const isVisible = (el) => {{
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== "none"
      && style.visibility !== "hidden"
      && rect.width > 0
      && rect.height > 0;
  }};
  const normalizeHref = (href) => {{
    try {{
      const url = new URL(href);
      if (url.hostname.includes("google.") && url.pathname === "/url") {{
        return url.searchParams.get("q") || href;
      }}
    }} catch (_) {{}}
    return href;
  }};
  const isGoogleSearch = location.hostname.includes("google.") && location.pathname.includes("/search");
  const links = Array.from(document.querySelectorAll('a[href^="http"]'))
    .map((a) => {{
      const href = normalizeHref(a.href || "");
      const text = (a.innerText || a.textContent || "").trim();
      return {{ a, href, text }};
    }})
    .filter((item) => {{
      const href = item.href || "";
      const text = item.text || "";
      if (!text) return false;
      if (!isVisible(item.a)) return false;
      if (href.includes("google.com/search")) return false;
      if (href.includes("google.com/preferences")) return false;
      if (href.includes("google.com/settings")) return false;
      if (href.includes("webcache.googleusercontent.com")) return false;
      if (isGoogleSearch) {{
        try {{
          const url = new URL(href);
          if (url.hostname.includes("google.")) return false;
        }} catch (_) {{
          return false;
        }}
      }}
      return true;
    }});
  const target = links[index - 1];
  if (!target) {{
    return JSON.stringify({{ ok: false, error: "search result link not found" }});
  }}
  const result = {{
    ok: true,
    opened: target.href,
    title: target.text.slice(0, 120)
  }};
  window.location.href = target.href;
  return JSON.stringify(result);
}})();
"""


def _extract_dom_javascript(*, include_links: bool, max_links: int) -> str:
    include_links_json = json.dumps(include_links)
    return f"""
(() => {{
  const includeLinks = {include_links_json};
  const maxLinks = {max_links};
  const clean = (value) => (value || "").replace(/\\s+/g, " ").trim();
  const isVisible = (el) => {{
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== "none"
      && style.visibility !== "hidden"
      && rect.width > 0
      && rect.height > 0;
  }};
  const normalizeHref = (href) => {{
    try {{
      const url = new URL(href);
      if (url.hostname.includes("google.") && url.pathname === "/url") {{
        return url.searchParams.get("q") || href;
      }}
    }} catch (_) {{}}
    return href;
  }};
  const shouldKeep = (a, href, text) => {{
    if (!text) return false;
    if (!href) return false;
    if (!isVisible(a)) return false;
    if (href.includes("google.com/search")) return false;
    if (href.includes("google.com/preferences")) return false;
    if (href.includes("google.com/settings")) return false;
    if (href.includes("webcache.googleusercontent.com")) return false;
    return true;
  }};
  const links = includeLinks
    ? Array.from(document.querySelectorAll('a[href^="http"]'))
      .map((a) => {{
        const href = normalizeHref(a.href || "");
        const text = clean(a.innerText || a.textContent || "");
        return {{
          element: a,
          text,
          href,
          title: clean(a.getAttribute("title") || text),
          ariaLabel: clean(a.getAttribute("aria-label") || "")
        }};
      }})
      .filter((item) => shouldKeep(item.element, item.href, item.text))
      .slice(0, maxLinks)
      .map((item) => ({{
        text: item.text.slice(0, 240),
        href: item.href,
        title: item.title.slice(0, 240),
        ariaLabel: item.ariaLabel.slice(0, 240)
      }}))
    : [];
  return JSON.stringify({{
    ok: true,
    url: location.href,
    title: document.title || "",
    links
  }});
}})();
"""


async def _execute_browser_javascript(browser: str, javascript: str) -> dict[str, Any]:
    if browser == "Google Chrome":
        script = (
            'tell application "Google Chrome"\n'
            "if not (exists front window) then error \"no active browser tab\"\n"
            f"set _result to execute active tab of front window javascript {json.dumps(javascript)}\n"
            "end tell\n"
            "return _result"
        )
    elif browser == "Safari":
        script = (
            'tell application "Safari"\n'
            "if not (exists front window) then error \"no active browser tab\"\n"
            f"set _result to do JavaScript {json.dumps(javascript)} in current tab of front window\n"
            "end tell\n"
            "return _result"
        )
    else:
        raise RuntimeError(f"unsupported browser: {browser}")

    proc = await asyncio.create_subprocess_exec(
        "osascript",
        "-e",
        script,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=5.0)
    except asyncio.TimeoutError as e:
        proc.kill()
        await proc.communicate()
        raise RuntimeError("browser JavaScript timed out") from e
    if proc.returncode != 0:
        raise RuntimeError(err.decode(errors="replace").strip()[:300])

    raw = out.decode("utf-8", errors="replace").strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"invalid browser JavaScript result: {raw[:120]!r}") from e
    if not isinstance(data, dict):
        raise RuntimeError("invalid browser JavaScript result")
    if not data.get("ok"):
        raise RuntimeError(str(data.get("error") or "search result link not found"))
    return {str(key): value for key, value in data.items() if key != "ok"}
