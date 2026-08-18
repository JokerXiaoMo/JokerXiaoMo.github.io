from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "src" / "main.py"
SPEC = importlib.util.spec_from_file_location("toolbox_main", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
main = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = main
SPEC.loader.exec_module(main)


class SystemMaintenanceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.original_is_windows = main.is_windows
        self.original_run_command = main.run_command
        main.is_windows = lambda: True
        self.commands: list[list[str]] = []

    def tearDown(self) -> None:
        main.is_windows = self.original_is_windows
        main.run_command = self.original_run_command

    def mock_commands(self, replies: list[tuple[int, str, str]]) -> None:
        queue = list(replies)

        def fake_run(arguments: list[str]) -> tuple[int, str, str]:
            self.commands.append(arguments)
            return queue.pop(0)

        main.run_command = fake_run

    def test_discovers_wifi_interface(self) -> None:
        self.mock_commands(
            [
                (
                    0,
                    "Admin State    State          Type             Interface Name\n"
                    "-------------------------------------------------------------------------\n"
                    "Enabled        Connected      Dedicated        Wi-Fi",
                    "",
                )
            ]
        )
        adapters = main.SystemMaintenance().find_wifi_adapters()
        self.assertEqual(adapters, ["Wi-Fi"])

    def test_builds_wifi_disable_command(self) -> None:
        self.mock_commands([(0, "Ok.", "")])
        result = main.SystemMaintenance().set_wifi_enabled("Wi-Fi", False)
        self.assertTrue(result.ok)
        self.assertEqual(
            self.commands,
            [["netsh", "interface", "set", "interface", "name=Wi-Fi", "admin=disabled"]],
        )

    def test_reads_disabled_wifi_status(self) -> None:
        self.mock_commands(
            [
                (
                    0,
                    "Disabled       Disconnected   Dedicated        Wi-Fi",
                    "",
                )
            ]
        )
        result = main.SystemMaintenance().get_wifi_status("Wi-Fi")
        self.assertTrue(result.ok)
        self.assertEqual(result.summary, "Wi‑Fi 已禁用")

    def test_restarts_print_spooler(self) -> None:
        self.mock_commands([(0, "The Print Spooler service was stopped.", ""), (0, "started", "")])
        result = main.SystemMaintenance().restart_spooler()
        self.assertTrue(result.ok)
        self.assertEqual(result.summary, "打印后台服务已重启")
        self.assertEqual(self.commands, [["net", "stop", "spooler"], ["net", "start", "spooler"]])


if __name__ == "__main__":
    unittest.main(verbosity=2)
