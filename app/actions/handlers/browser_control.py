"""Basic browser control handler."""

from __future__ import annotations

import asyncio
import json
import sys
from typing import Any

from app.actions.handlers._browsers import _MACOS_APPS, DEFAULT_BROWSER, open_in_browser
from app.actions.handlers.base import HandlerError
from app.actions.handlers.browser import build_search_url
from app.actions.models import ClientAction


def make_browser_control(enabled: bool, default_browser: str = DEFAULT_BROWSER):
    async def browser_control(action: ClientAction) -> dict[str, Any]:
        if not enabled:
            raise HandlerError("browser_control disabled by policy")
        command = _normalize_command(action)
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
                used = await open_in_browser(target, browser=browser or default_browser)
            except RuntimeError as e:
                raise HandlerError(str(e)) from e
            return {"command": command, "opened": target, "browser": used}

        if command == "select_result":
            return await _select_result(action)

        if command == "extract_dom":
            return await _extract_dom(action)

        if command == "click_element":
            return await _click_element(action)

        if command == "type_element":
            return await _type_element(action)

        if command == "scroll":
            return await _scroll(action)

        if command == "search":
            return await _browser_control_search(action, default_browser=default_browser)

        if command == "new_tab":
            return await _new_tab(action, default_browser=default_browser)

        if command == "new_window":
            return await _new_window(action, default_browser=default_browser)

        if sys.platform != "darwin":
            raise HandlerError(f"browser_control {command!r} not supported on {sys.platform}")

        if command == "back":
            script = 'tell application "System Events" to key code 123 using {command down}'
        elif command == "forward":
            script = 'tell application "System Events" to key code 124 using {command down}'
        elif command == "reload":
            script = 'tell application "System Events" to keystroke "r" using {command down}'
        elif command == "close_tab":
            script = 'tell application "System Events" to keystroke "w" using {command down}'
        elif command == "focus_address_bar":
            script = 'tell application "System Events" to keystroke "l" using {command down}'
        else:
            raise HandlerError(f"unsupported browser_control command: {command!r}")
        await _run_system_events_script(script)
        return {"command": command}

    return browser_control


async def _run_system_events_script(script: str) -> None:
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


async def _scroll(action: ClientAction) -> dict[str, Any]:
    args = action.args or {}
    direction = str(args.get("direction") or "down").strip().lower()
    if direction not in {"up", "down", "left", "right"}:
        raise HandlerError(f"unsupported scroll direction: {direction!r}")
    try:
        amount = int(args.get("amount", 600))
    except (TypeError, ValueError) as e:
        raise HandlerError(
            "invalid scroll amount",
            output={"command": "scroll", "amount": args.get("amount")},
        ) from e
    dx, dy = {
        "down": (0, amount),
        "up": (0, -amount),
        "right": (amount, 0),
        "left": (-amount, 0),
    }[direction]
    js = f"window.scrollBy({dx}, {dy}); JSON.stringify({{ ok: true }});"
    result = await _run_browser_javascript_action(
        command="scroll",
        javascript=js,
        output_base={"command": "scroll", "direction": direction, "amount": amount},
    )
    result["command"] = "scroll"
    result["direction"] = direction
    result["amount"] = amount
    return result


async def _browser_control_search(
    action: ClientAction, *, default_browser: str
) -> dict[str, Any]:
    args = action.args or {}
    query = str(args.get("query") or action.payload or "").strip()
    if not query:
        raise HandlerError("browser_control search requires args.query")
    engine = str(args.get("engine") or args.get("search_engine") or "google")
    url = build_search_url(query=query, engine=engine)
    output_base = {"command": "search", "query": query, "generated_url": url}

    if bool(args.get("new_tab", False)):
        browser = ""
        raw_browser = args.get("browser")
        if isinstance(raw_browser, str):
            browser = raw_browser
        try:
            used = await open_in_browser(url, browser=browser or default_browser)
        except RuntimeError as e:
            raise HandlerError(str(e), output=output_base) from e
        return {**output_base, "opened": url, "browser": used}

    js = f"window.location.href = {json.dumps(url)}; JSON.stringify({{ ok: true }});"
    result = await _run_browser_javascript_action(
        command="search", javascript=js, output_base=output_base
    )
    return {**output_base, **result, "opened": url}


async def _new_tab(action: ClientAction, *, default_browser: str) -> dict[str, Any]:
    url = _optional_url_arg(action)
    if url:
        browser = ""
        raw_browser = (action.args or {}).get("browser")
        if isinstance(raw_browser, str):
            browser = raw_browser
        try:
            used = await open_in_browser(url, browser=browser or default_browser)
        except RuntimeError as e:
            raise HandlerError(str(e)) from e
        return {"command": "new_tab", "opened": url, "browser": used}

    if sys.platform != "darwin":
        raise HandlerError(f"browser_control new_tab not supported on {sys.platform}")
    await _run_system_events_script(
        'tell application "System Events" to keystroke "t" using {command down}'
    )
    return {"command": "new_tab"}


async def _new_window(action: ClientAction, *, default_browser: str) -> dict[str, Any]:
    if sys.platform != "darwin":
        raise HandlerError(f"browser_control new_window not supported on {sys.platform}")

    browser = ""
    raw_browser = (action.args or {}).get("browser")
    if isinstance(raw_browser, str):
        browser = raw_browser
    app = _MACOS_APPS.get((browser or default_browser).strip().lower(), "Google Chrome")
    make_command = "make new document" if app == "Safari" else "make new window"
    await _run_system_events_script(f'tell application "{app}" to {make_command}')

    result: dict[str, Any] = {"command": "new_window", "browser": app}
    url = _optional_url_arg(action)
    if url:
        js = f"window.location.href = {json.dumps(url)}; JSON.stringify({{ ok: true }});"
        try:
            await _execute_browser_javascript(app, js)
        except RuntimeError as e:
            raise HandlerError(str(e), output=result) from e
        result["opened"] = url
    return result


def _optional_url_arg(action: ClientAction) -> str:
    args = action.args or {}
    url = str(args.get("url") or "").strip()
    if not url:
        return ""
    if not url.startswith(("http://", "https://")):
        raise HandlerError(f"browser_control url must be http(s): {url[:80]!r}")
    return url


def _normalize_command(action: ClientAction) -> str:
    if action.command:
        return action.command.strip().lower().replace(".", "_")
    action_type = str(action.type).strip().lower()
    return {
        "browser.extract_dom": "extract_dom",
        "browser.click": "click_element",
        "browser.type": "type_element",
        "browser.select_result": "select_result",
        "browser.navigate": "navigate",
        "browser.open": "open",
    }.get(action_type, "open_url")


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


async def _click_element(action: ClientAction) -> dict[str, Any]:
    args = action.args or {}
    output_base = {"command": "click_element"}
    try:
        ai_id = int(args.get("ai_id"))
    except (TypeError, ValueError) as e:
        raise HandlerError(
            "invalid click_element ai_id",
            output={**output_base, "ai_id": args.get("ai_id")},
        ) from e
    if ai_id < 1:
        raise HandlerError(
            "invalid click_element ai_id",
            output={**output_base, "ai_id": ai_id},
        )
    result = await _run_browser_javascript_action(
        command="click_element",
        javascript=_click_element_javascript(ai_id),
        output_base={**output_base, "ai_id": ai_id},
    )
    result["command"] = "click_element"
    result["ai_id"] = ai_id
    return result


async def _type_element(action: ClientAction) -> dict[str, Any]:
    args = action.args or {}
    output_base = {"command": "type_element"}
    try:
        ai_id = int(args.get("ai_id"))
    except (TypeError, ValueError) as e:
        raise HandlerError(
            "invalid type_element ai_id",
            output={**output_base, "ai_id": args.get("ai_id")},
        ) from e
    if ai_id < 1:
        raise HandlerError(
            "invalid type_element ai_id",
            output={**output_base, "ai_id": ai_id},
        )
    text = str(args.get("text") or args.get("value") or action.payload or "")
    result = await _run_browser_javascript_action(
        command="type_element",
        javascript=_type_element_javascript(ai_id=ai_id, text=text),
        output_base={**output_base, "ai_id": ai_id},
    )
    result["command"] = "type_element"
    result["ai_id"] = ai_id
    return result


async def _run_browser_javascript_action(
    *,
    command: str,
    javascript: str,
    output_base: dict[str, Any],
) -> dict[str, Any]:
    if sys.platform != "darwin":
        raise HandlerError(
            f"browser_control {command} not supported on {sys.platform}",
            output=output_base,
        )
    errors: list[str] = []
    for browser in ("Google Chrome", "Safari"):
        try:
            result = await _execute_browser_javascript(browser, javascript)
        except RuntimeError as e:
            errors.append(f"{browser}: {e}")
            continue
        result["browser"] = browser
        return result
    error = _summarize_browser_javascript_errors(errors, command) if errors else (
        f"{command} failed"
    )
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
  let nextAiId = 1;
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
      .map((item) => {{
        const aiId = nextAiId++;
        item.element.setAttribute("data-jarvis-ai-id", String(aiId));
        return {{
          ai_id: aiId,
          text: item.text.slice(0, 240),
          href: item.href,
          title: item.title.slice(0, 240),
          ariaLabel: item.ariaLabel.slice(0, 240)
        }};
      }})
    : [];
  const elements = Array.from(document.querySelectorAll('input, textarea, select, button, [role="button"], [role="textbox"], [contenteditable="true"]'))
    .filter((el) => isVisible(el))
    .slice(0, maxLinks)
    .map((el) => {{
      const aiId = nextAiId++;
      el.setAttribute("data-jarvis-ai-id", String(aiId));
      const tag = (el.tagName || "").toLowerCase();
      const id = el.getAttribute("id") || "";
      const ariaLabel = clean(el.getAttribute("aria-label") || "");
      let label = ariaLabel;
      if (!label && id) {{
        const labelEl = document.querySelector(`label[for="${{CSS.escape(id)}}"]`);
        label = clean(labelEl ? labelEl.innerText || labelEl.textContent || "" : "");
      }}
      if (!label) {{
        const parentLabel = el.closest("label");
        label = clean(parentLabel ? parentLabel.innerText || parentLabel.textContent || "" : "");
      }}
      return {{
        ai_id: aiId,
        tag,
        role: el.getAttribute("role") || "",
        type: el.getAttribute("type") || "",
        text: clean(el.innerText || el.textContent || el.value || "").slice(0, 240),
        placeholder: clean(el.getAttribute("placeholder") || ""),
        label: label.slice(0, 240),
        ariaLabel
      }};
    }});
  return JSON.stringify({{
    ok: true,
    url: location.href,
    title: document.title || "",
    links,
    elements
  }});
}})();
"""


def _click_element_javascript(ai_id: int) -> str:
    return f"""
(() => {{
  const aiId = {ai_id};
  const el = document.querySelector(`[data-jarvis-ai-id="${{aiId}}"]`);
  if (!el) return JSON.stringify({{ ok: false, error: "element not found" }});
  const href = el.href || el.getAttribute("href") || "";
  const title = (el.innerText || el.textContent || el.getAttribute("title") || "").trim().slice(0, 120);
  el.scrollIntoView({{ block: "center", inline: "center" }});
  el.click();
  return JSON.stringify({{ ok: true, clicked: true, opened: href, title }});
}})();
"""


def _type_element_javascript(*, ai_id: int, text: str) -> str:
    return f"""
(() => {{
  const aiId = {ai_id};
  const text = {json.dumps(text)};
  const el = document.querySelector(`[data-jarvis-ai-id="${{aiId}}"]`);
  if (!el) return JSON.stringify({{ ok: false, error: "element not found" }});
  el.scrollIntoView({{ block: "center", inline: "center" }});
  el.focus();
  if (el.isContentEditable) {{
    el.textContent = text;
  }} else {{
    el.value = text;
  }}
  el.dispatchEvent(new InputEvent("input", {{ bubbles: true, inputType: "insertText", data: text }}));
  el.dispatchEvent(new Event("change", {{ bubbles: true }}));
  return JSON.stringify({{ ok: true, typed: true, text }});
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
