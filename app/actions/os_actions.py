from __future__ import annotations

import base64
import logging
import os
from io import BytesIO
from typing import Any

import pyautogui
from app.models.messages import EventEnvelope

logger = logging.getLogger(__name__)

BASE_DIR = "./agent_workspace"
os.makedirs(BASE_DIR, exist_ok=True)

class OSManager:
    async def get_screenshot(self, args: dict[str, Any]) -> dict[str, Any]:
        try:
            screenshot = pyautogui.screenshot()
            buffered = BytesIO()
            screenshot.save(buffered, format="JPEG", quality=60)
            img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
            return {"status": "success", "image_base64": img_str}
        except Exception as e:
            logger.error(f"get_screenshot error: {e}")
            return {"status": "error", "message": str(e)}

    async def create_file(self, args: dict[str, Any]) -> dict[str, Any]:
        filename = args.get("filename")
        content = args.get("content", "")
        if not filename:
            return {"status": "error", "message": "파일명이 필요합니다."}
        
        try:
            path = os.path.join(BASE_DIR, filename)
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
            return {"status": "success", "message": f"파일 생성 완료: {path}"}
        except Exception as e:
            logger.error(f"create_file error: {e}")
            return {"status": "error", "message": str(e)}
