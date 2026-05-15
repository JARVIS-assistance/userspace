from __future__ import annotations

import unittest
from unittest.mock import patch

from app.actions.handlers.todo import make_todo
from app.actions.models import ClientAction


class TestTodoAction(unittest.IsolatedAsyncioTestCase):
    async def test_create_todo_from_description(self) -> None:
        calls: list[tuple[str, str, str, str, dict | None]] = []

        async def fake_request(api_base, auth_token, method, path, payload):
            calls.append((api_base, auth_token, method, path, payload))
            return {"todo_id": "todo-1", **(payload or {})}

        handler = make_todo("http://api.test", "token")
        action = ClientAction(
            type="todo",
            command="create",
            description="Create todo: 할일에 컴파일러 과제 까지 이거 추가해줘",
            requires_confirm=False,
        )

        with patch("app.actions.handlers.todo._request", fake_request):
            result = await handler(action)

        self.assertEqual(result["command"], "create")
        self.assertEqual(calls[0][2], "POST")
        self.assertEqual(calls[0][3], "/todos")
        self.assertEqual(calls[0][4]["title"], "컴파일러 과제")
        self.assertEqual(calls[0][4]["metadata"], {"source": "client_action"})

    async def test_complete_todo_uses_patch(self) -> None:
        calls: list[tuple[str, str, str, str, dict | None]] = []

        async def fake_request(api_base, auth_token, method, path, payload):
            calls.append((api_base, auth_token, method, path, payload))
            return {"todo_id": "todo-1", **(payload or {})}

        handler = make_todo("http://api.test", "token")
        action = ClientAction(
            type="todo",
            command="complete",
            target="todo-1",
            description="Complete todo",
            requires_confirm=False,
        )

        with patch("app.actions.handlers.todo._request", fake_request):
            result = await handler(action)

        self.assertEqual(result["command"], "patch")
        self.assertEqual(calls[0][2], "PATCH")
        self.assertEqual(calls[0][3], "/todos/todo-1")
        self.assertEqual(calls[0][4], {"status": "completed"})


if __name__ == "__main__":
    unittest.main()
