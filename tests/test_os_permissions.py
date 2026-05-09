import unittest

from app import os_permissions


class MacOSPermissionTests(unittest.IsolatedAsyncioTestCase):
    async def test_skips_non_macos_platforms(self) -> None:
        original_platform = os_permissions.sys.platform
        os_permissions.sys.platform = "linux"
        try:
            status = await os_permissions.request_macos_action_permissions()
        finally:
            os_permissions.sys.platform = original_platform

        self.assertFalse(status.checked)
        self.assertIsNone(status.automation_granted)
        self.assertEqual(status.reason, "unsupported_platform")

    def test_korean_permission_error_maps_to_os_permission_missing(self) -> None:
        reason = os_permissions._osascript_permission_reason(
            "System Events에 키스트로크를 보내도록 허용되지 않습니다."
        )

        self.assertEqual(reason, "os_permission_missing")


if __name__ == "__main__":
    unittest.main()
