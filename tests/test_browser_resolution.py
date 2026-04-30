from __future__ import annotations

import unittest

from app.actions.browser_resolution import (
    choose_best_link,
    extract_current_browser_open_query,
)


class BrowserResolutionTests(unittest.TestCase):
    def test_extract_current_browser_open_query(self) -> None:
        self.assertEqual(
            extract_current_browser_open_query(
                "지금 브라우저에서 소불고기 황금 양념 레시피 들어가줘"
            ),
            "소불고기 황금 양념 레시피",
        )

    def test_search_request_is_not_current_browser_open(self) -> None:
        self.assertIsNone(
            extract_current_browser_open_query(
                "브라우저 열어서 소불고기 레시피 검색해줘"
            )
        )

    def test_recipe_open_without_browser_marker_uses_current_page(self) -> None:
        self.assertEqual(
            extract_current_browser_open_query(
                "냉장고 털어서 뚝딱 만든 순두부찌개 레시피 열어줘"
            ),
            "냉장고 털어서 뚝딱 만든 순두부찌개 레시피",
        )

    def test_choose_best_link(self) -> None:
        links = [
            {
                "text": "다른 레시피",
                "href": "https://example.com/other",
                "title": "다른 레시피",
                "ariaLabel": "",
            },
            {
                "text": "소불고기 황금 양념 레시피",
                "href": "https://www.10000recipe.com/recipe/6879215",
                "title": "소불고기 황금 양념 레시피",
                "ariaLabel": "",
            },
        ]
        selected = choose_best_link(links, "소불고기 황금 양념 레시피")
        self.assertIsNotNone(selected)
        self.assertEqual(
            selected["href"],
            "https://www.10000recipe.com/recipe/6879215",
        )


if __name__ == "__main__":
    unittest.main()
