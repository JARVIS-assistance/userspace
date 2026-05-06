import os
import time
import json
import base64
import asyncio
import websockets
import pyautogui
import pyperclip
from io import BytesIO
from playwright.async_api import async_playwright

BASE_DIR = "./agent_workspace"
os.makedirs(BASE_DIR, exist_ok=True)
SESSION_FILE = "agent_session.json"

async def get_screenshot() -> str:
    screenshot = pyautogui.screenshot()
    buffered = BytesIO()
    screenshot.save(buffered, format="JPEG", quality=60)
    return base64.b64encode(buffered.getvalue()).decode("utf-8")

DOM_PARSER_JS = """
() => {
    let id_counter = 1;
    let elements = document.querySelectorAll('button, a, input, textarea, select, [role="button"]');
    let output = [];
    elements.forEach(el => {
        // 화면에 보이지 않는 요소는 무시
        if (el.offsetWidth === 0 || el.offsetHeight === 0) return;
        
        let ai_id = id_counter++;
        el.setAttribute('ai-id', ai_id); // 고유 속성 부여
        
        let tag = el.tagName.toLowerCase();
        let text = el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || tag;
        text = text.replace(/\\n/g, ' ').substring(0, 50).trim();
        
        if(text) output.push(`[${ai_id}] ${tag} : ${text}`);
    });
    return output.join('\\n');
}
"""

async def listen_to_server(websocket, page, context):
    try:
        async for message in websocket:
            data = json.loads(message)
            msg_type = data.get("type")

            if msg_type == "execute_tool":
                tool_name = data.get("tool_name")
                params = data.get("parameters", {})
                print(f"\n[Client] ⚡ 명령 수행: {tool_name} {params}")
                
                res_status, res_msg = "success", "완료"
                
                try:
                    # --- 🌐 신규: 웹 제어 도구 매핑 ---
                    if tool_name == "web_goto":
                        await page.goto(params.get("url"), wait_until="domcontentloaded")
                        res_msg = f"{params.get('url')} 이동 완료"
                        
                    elif tool_name == "web_get_dom":
                        # 자바스크립트를 실행하여 요소 요약본 추출
                        dom_summary = await page.evaluate(DOM_PARSER_JS)
                        res_msg = f"DOM 추출 완료:\n{dom_summary}"
                        
                    elif tool_name == "web_click":
                        ai_id = params.get("ai_id")
                        # 부여했던 ai-id 속성으로 요소를 찾아 클릭
                        element = await page.query_selector(f"[ai-id='{ai_id}']")
                        if element:
                            await element.click()
                            res_msg = f"요소 [{ai_id}] 클릭 완료"
                            # 클릭 후 세션 상태(로그인 유지 등) 저장
                            await context.storage_state(path=SESSION_FILE)
                        else:
                            res_status, res_msg = "error", f"요소 [{ai_id}]를 찾을 수 없습니다."
                            
                    elif tool_name == "web_type":
                        ai_id = params.get("ai_id")
                        text = params.get("text")
                        element = await page.query_selector(f"[ai-id='{ai_id}']")
                        if element:
                            await element.fill(text)
                            res_msg = f"요소 [{ai_id}]에 '{text}' 입력 완료"
                        else:
                            res_status, res_msg = "error", "요소를 찾을 수 없습니다."

                    # --- 기존 OS 제어 도구 매핑 (그대로 유지) ---
                    elif tool_name == "create_file":
                        # ... (기존과 동일) ...
                        pass
                    # ... (생략: 기존 OS 툴들) ...
                    else:
                        res_status, res_msg = "error", "알 수 없는 도구입니다."
                except Exception as e:
                    res_status, res_msg = "error", str(e)
                
                await websocket.send(json.dumps({"type": "tool_result", "status": res_status, "message": res_msg}))

            elif msg_type == "request_vision":
                print(f"\n[Client] 📸 서버가 화면 캡처를 요청했습니다.")
                b64 = await get_screenshot()
                await websocket.send(json.dumps({"type": "vision_data", "image_base64": b64}))

            elif msg_type == "agent_reply":
                print(f"\n[Server AI] >> {data.get('text')}")
                print("\nUser >> ", end="", flush=True)
                
    except websockets.exceptions.ConnectionClosed:
        print("\n[Client] 서버와의 연결이 끊어졌습니다.")

async def user_input_loop(websocket):
    loop = asyncio.get_running_loop()
    await asyncio.sleep(0.5) # 터미널 출력이 겹치지 않게 살짝 대기
    while True:
        user_msg = await loop.run_in_executor(None, input, "\nUser >> ")
        if user_msg.lower() in ['quit', 'exit']: break
        
        req = {"type": "user_input", "text": user_msg}
        await websocket.send(json.dumps(req))

async def main():
    uri = "ws://localhost:8765"
    print(f"🔌 [Client] 서버에 접속 시도 중... ({uri})")
    
    # 💡 Playwright 브라우저를 클라이언트 수명과 함께 실행
    async with async_playwright() as p:
        # 세션 파일이 있으면 불러와서 자동 로그인 유지
        if os.path.exists(SESSION_FILE):
            context = await p.chromium.launch_persistent_context(user_data_dir="./agent_chrome_data", headless=False)
            page = context.pages[0]
        else:
            browser = await p.chromium.launch(headless=False)
            context = await browser.new_context()
            page = await context.new_page()

        async with websockets.connect(uri, max_size=None) as websocket:
            print("✅ 접속 및 브라우저 기동 성공! (명령을 입력하세요)")
            task1 = asyncio.create_task(listen_to_server(websocket, page, context)) # page 전달
            task2 = asyncio.create_task(user_input_loop(websocket))
            await asyncio.gather(task1, task2)

if __name__ == "__main__":
    asyncio.run(main())