from __future__ import annotations

import logging
import os
from typing import Any

from playwright.async_api import async_playwright, Browser, BrowserContext, Page

logger = logging.getLogger(__name__)

SESSION_FILE = "agent_session.json"
CHROME_DATA_DIR = "./agent_chrome_data"

DOM_PARSER_JS = """
() => {
    let id_counter = 1;
    let elements = document.querySelectorAll('button, a, input, textarea, select, [role="button"]');
    let output = [];
    elements.forEach(el => {
        if (el.offsetWidth === 0 || el.offsetHeight === 0) return;
        
        let ai_id = id_counter++;
        el.setAttribute('ai-id', ai_id);
        
        let tag = el.tagName.toLowerCase();
        let text = el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || tag;
        text = text.replace(/\\n/g, ' ').substring(0, 50).trim();
        
        if(text) output.push(`[${ai_id}] ${tag} : ${text}`);
    });
    return output.join('\\n');
}
"""

class WebBrowserManager:
    _instance: WebBrowserManager | None = None

    def __init__(self) -> None:
        self.playwright = None
        self.browser: Browser | None = None
        self.context: BrowserContext | None = None
        self.page: Page | None = None

    @classmethod
    async def get_instance(cls) -> WebBrowserManager:
        if cls._instance is None:
            cls._instance = WebBrowserManager()
        return cls._instance

    async def ensure_page(self) -> Page:
        if self.page is None:
            if self.playwright is None:
                self.playwright = await async_playwright().start()
            
            # Launch persistent context to maintain sessions/login
            self.context = await self.playwright.chromium.launch_persistent_context(
                user_data_dir=CHROME_DATA_DIR,
                headless=False
            )
            self.page = self.context.pages[0]
        return self.page

    async def web_goto(self, args: dict[str, Any]) -> dict[str, Any]:
        url = args.get("url")
        if not url:
            return {"status": "error", "message": "URL이 필요합니다."}
        
        try:
            page = await self.ensure_page()
            await page.goto(url, wait_until="domcontentloaded")
            return {"status": "success", "message": f"{url} 이동 완료"}
        except Exception as e:
            logger.error(f"web_goto error: {e}")
            return {"status": "error", "message": str(e)}

    async def web_get_dom(self, args: dict[str, Any]) -> dict[str, Any]:
        try:
            page = await self.ensure_page()
            dom_summary = await page.evaluate(DOM_PARSER_JS)
            return {"status": "success", "message": dom_summary}
        except Exception as e:
            logger.error(f"web_get_dom error: {e}")
            return {"status": "error", "message": str(e)}

    async def web_click(self, args: dict[str, Any]) -> dict[str, Any]:
        ai_id = args.get("ai_id")
        if ai_id is None:
            return {"status": "error", "message": "ai_id가 필요합니다."}
        
        try:
            page = await self.ensure_page()
            element = await page.query_selector(f"[ai-id='{ai_id}']")
            if element:
                await element.click()
                # Save state after interaction
                await self.context.storage_state(path=SESSION_FILE)
                return {"status": "success", "message": f"요소 [{ai_id}] 클릭 완료"}
            else:
                return {"status": "error", "message": f"요소 [{ai_id}]를 찾을 수 없습니다."}
        except Exception as e:
            logger.error(f"web_click error: {e}")
            return {"status": "error", "message": str(e)}

    async def web_type(self, args: dict[str, Any]) -> dict[str, Any]:
        ai_id = args.get("ai_id")
        text = args.get("text")
        if ai_id is None or text is None:
            return {"status": "error", "message": "ai_id와 text가 필요합니다."}
        
        try:
            page = await self.ensure_page()
            element = await page.query_selector(f"[ai-id='{ai_id}']")
            if element:
                await element.fill(text)
                return {"status": "success", "message": f"요소 [{ai_id}]에 '{text}' 입력 완료"}
            else:
                return {"status": "error", "message": f"요소 [{ai_id}]를 찾을 수 없습니다."}
        except Exception as e:
            logger.error(f"web_type error: {e}")
            return {"status": "error", "message": str(e)}

    async def close(self) -> None:
        if self.context:
            await self.context.close()
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()
        self.page = None
        self.context = None
        self.browser = None
        self.playwright = None
