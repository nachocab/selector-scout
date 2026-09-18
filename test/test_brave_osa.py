import contextlib
import importlib.util
import io
import pathlib
import unittest
from unittest import mock


MODULE_PATH = pathlib.Path(__file__).parents[1] / "tools" / "brave_osa.py"


def load_module():
    spec = importlib.util.spec_from_file_location("brave_osa", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BraveOsaTests(unittest.TestCase):
    def test_quotes_apple_script_strings(self):
        brave_osa = load_module()
        self.assertEqual(brave_osa.aps('a\\b"c'), '"a\\\\b\\"c"')

    def test_javascript_execution_targets_brave_by_window_id(self):
        brave_osa = load_module()
        tab = {
            "window": "42",
            "id": "9001",
            "index": 3,
            "title": "Fixture",
            "url": "https://example.test",
        }

        with mock.patch.object(brave_osa, "find_tab", return_value=tab), mock.patch.object(
            brave_osa, "osa", return_value='"Fixture"'
        ) as osa:
            result = brave_osa.run_js("Fixture", "document.title")

        self.assertEqual(result, '"Fixture"')
        script = osa.call_args.args[0]
        self.assertIn('tell application "Brave Browser"', script)
        self.assertIn("first window whose id is 42", script)
        self.assertIn('first tab of w whose id is "9001"', script)
        self.assertNotIn("tab 3 of w", script)

    def test_js_operation_always_prints_enable_and_disable_reminders(self):
        brave_osa = load_module()
        stderr = io.StringIO()

        with contextlib.redirect_stderr(stderr):
            result = brave_osa.with_javascript_reminders(lambda: "done")

        self.assertEqual(result, "done")
        output = stderr.getvalue()
        self.assertIn("ENABLE", output)
        self.assertIn("DISABLE", output)
        self.assertIn("Allow JavaScript from Apple Events", output)

    def test_js_operation_prints_disable_reminder_after_failure(self):
        brave_osa = load_module()
        stderr = io.StringIO()

        with self.assertRaisesRegex(RuntimeError, "boom"), contextlib.redirect_stderr(stderr):
            brave_osa.with_javascript_reminders(lambda: (_ for _ in ()).throw(RuntimeError("boom")))

        self.assertIn("DISABLE", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
