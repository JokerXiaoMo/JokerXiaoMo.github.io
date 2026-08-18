from __future__ import annotations

import ctypes
import os
import re
import shutil
import subprocess
import sys
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

import tkinter as tk
from tkinter import messagebox, ttk

from PIL import Image, ImageTk


APP_TITLE = "系统维护工具箱 mini"
APP_VERSION = "1.0.0"
WINDOWS_ONLY_MESSAGE = "此工具仅支持 Windows 7、Windows 10 和 Windows 11。"

BG = "#F4F7FB"
CARD = "#FFFFFF"
PRIMARY = "#1867C0"
PRIMARY_HOVER = "#0E55A3"
TEXT = "#1C2B39"
MUTED = "#637381"
SUCCESS = "#1B8F54"
WARNING = "#B46200"
ERROR = "#C0392B"
BORDER = "#D9E2EC"


@dataclass
class CommandResult:
    ok: bool
    summary: str
    detail: str = ""


def resource_path(relative_path: str) -> Path:
    """返回开发环境或 PyInstaller 打包环境中的资源路径。"""
    base_path = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))
    return base_path / relative_path


def is_windows() -> bool:
    return os.name == "nt"


def is_admin() -> bool:
    if not is_windows():
        return False
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def relaunch_as_admin() -> bool:
    """以管理员权限重启当前程序；用户取消 UAC 时返回 False。"""
    if not is_windows():
        return False
    if getattr(sys, "frozen", False):
        executable = sys.executable
        parameters = " ".join(f'"{arg}"' for arg in sys.argv[1:])
    else:
        executable = sys.executable
        parameters = " ".join(
            [f'"{Path(__file__).resolve()}"']
            + [f'"{arg}"' for arg in sys.argv[1:]]
        )
    try:
        result = ctypes.windll.shell32.ShellExecuteW(
            None, "runas", executable, parameters, None, 1
        )
        return result > 32
    except Exception:
        return False


def run_command(arguments: list[str]) -> tuple[int, str, str]:
    """隐藏控制台执行系统命令，返回状态码、标准输出和错误输出。"""
    if not is_windows():
        return 1, "", WINDOWS_ONLY_MESSAGE
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    completed = subprocess.run(
        arguments,
        capture_output=True,
        text=True,
        encoding="mbcs",
        errors="replace",
        creationflags=creationflags,
        check=False,
    )
    return completed.returncode, completed.stdout.strip(), completed.stderr.strip()


def clean_output(*chunks: str) -> str:
    text = "\n".join(chunk for chunk in chunks if chunk).strip()
    return text or "未返回额外信息。"


class SystemMaintenance:
    """封装 Windows 7 至 Windows 11 共通的网络与打印后台维护命令。"""

    wifi_keywords = ("wi-fi", "wifi", "wlan", "无线", "802.11")

    @staticmethod
    def _netsh_interfaces() -> tuple[bool, str]:
        code, output, error = run_command(["netsh", "interface", "show", "interface"])
        return code == 0, clean_output(output, error)

    def find_wifi_adapters(self) -> list[str]:
        """从 netsh 的接口列表中发现常见的无线网络接口名称。"""
        success, output = self._netsh_interfaces()
        if not success:
            return []

        candidates: list[str] = []
        for raw_line in output.splitlines():
            line = raw_line.strip()
            lowered = line.lower()
            if not line or not any(keyword in lowered for keyword in self.wifi_keywords):
                continue
            if "interface name" in lowered or "接口名称" in lowered:
                continue

            # netsh 通常使用至少两个空格分列，最后一列为接口名称。
            columns = [part.strip() for part in re.split(r"\s{2,}", line) if part.strip()]
            adapter = columns[-1] if columns else line
            if adapter and adapter not in candidates:
                candidates.append(adapter)
        return candidates

    def get_wifi_status(self, adapter_name: str) -> CommandResult:
        if not adapter_name.strip():
            return CommandResult(False, "未找到 Wi‑Fi 适配器", "请刷新列表，或手动填写无线网络接口名称。")
        success, output = self._netsh_interfaces()
        if not success:
            return CommandResult(False, "无法读取 Wi‑Fi 状态", output)

        target = adapter_name.strip().lower()
        for raw_line in output.splitlines():
            line = raw_line.strip()
            if target not in line.lower():
                continue
            lowered = line.lower()
            if "disabled" in lowered or "已禁用" in line or "禁用" in line:
                return CommandResult(True, "Wi‑Fi 已禁用", line)
            if "enabled" in lowered or "已启用" in line or "启用" in line:
                return CommandResult(True, "Wi‑Fi 已启用", line)
            return CommandResult(True, "Wi‑Fi 接口已找到", line)
        return CommandResult(False, "未在系统接口列表中找到该 Wi‑Fi", output)

    def set_wifi_enabled(self, adapter_name: str, enabled: bool) -> CommandResult:
        if not adapter_name.strip():
            return CommandResult(False, "未指定 Wi‑Fi 适配器", "请刷新列表，或手动填写无线网络接口名称。")
        state = "enabled" if enabled else "disabled"
        code, output, error = run_command(
            [
                "netsh",
                "interface",
                "set",
                "interface",
                f"name={adapter_name.strip()}",
                f"admin={state}",
            ]
        )
        action = "启用" if enabled else "禁用"
        if code == 0:
            return CommandResult(True, f"Wi‑Fi 已{action}", clean_output(output, error))
        return CommandResult(False, f"Wi‑Fi {action}失败", clean_output(output, error))

    def restart_spooler(self) -> CommandResult:
        stop_code, stop_output, stop_error = run_command(["net", "stop", "spooler"])
        start_code, start_output, start_error = run_command(["net", "start", "spooler"])
        details = clean_output(stop_output, stop_error, start_output, start_error)
        if start_code == 0:
            if stop_code == 0:
                return CommandResult(True, "打印后台服务已重启", details)
            return CommandResult(True, "打印后台服务已启动", details)
        return CommandResult(False, "打印后台服务重启失败", details)

    def clear_print_queue(self) -> CommandResult:
        """停止 Spooler，清除本地队列文件后重新启动服务。"""
        system_root = Path(os.environ.get("SystemRoot", r"C:\Windows"))
        queue_folder = system_root / "System32" / "spool" / "PRINTERS"
        messages: list[str] = []
        stop_code, stop_output, stop_error = run_command(["net", "stop", "spooler"])
        messages.append(clean_output(stop_output, stop_error))
        if stop_code != 0:
            return CommandResult(False, "无法停止打印后台服务", "\n".join(messages))

        deleted = 0
        failures: list[str] = []
        try:
            if queue_folder.exists():
                for item in queue_folder.iterdir():
                    try:
                        if item.is_dir():
                            shutil.rmtree(item)
                        else:
                            item.unlink()
                        deleted += 1
                    except OSError as exc:
                        failures.append(f"{item.name}: {exc}")
            else:
                failures.append(f"未找到队列目录：{queue_folder}")
        finally:
            start_code, start_output, start_error = run_command(["net", "start", "spooler"])
            messages.append(clean_output(start_output, start_error))

        if start_code != 0:
            return CommandResult(False, "队列文件已处理，但打印后台服务未能启动", "\n".join(messages + failures))
        if failures:
            return CommandResult(False, "打印队列清理不完整", "\n".join(messages + failures))
        return CommandResult(True, f"已清空打印队列（删除 {deleted} 项）", "\n".join(messages))


class MaintenanceApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.maintenance = SystemMaintenance()
        self.busy = False
        self.logo_image: Optional[ImageTk.PhotoImage] = None
        self.adapter_value = tk.StringVar(value="")
        self.status_value = tk.StringVar(value="正在检查管理员权限与网络接口…")
        self.status_color = MUTED
        self.adapter_hint = tk.StringVar(value="正在扫描 Wi‑Fi 适配器…")
        self.buttons: list[tk.Button] = []

        self.title(APP_TITLE)
        self.geometry("760x570")
        self.minsize(700, 530)
        self.configure(bg=BG)
        self._set_app_icon()
        self._build_styles()
        self._build_interface()
        self.after(150, self.refresh_adapters)

    def _set_app_icon(self) -> None:
        icon = resource_path("assets/app.ico")
        if icon.exists():
            try:
                self.iconbitmap(default=str(icon))
            except tk.TclError:
                pass

    def _build_styles(self) -> None:
        style = ttk.Style(self)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure(
            "Toolbox.TCombobox",
            fieldbackground="#FFFFFF",
            background="#FFFFFF",
            foreground=TEXT,
            bordercolor=BORDER,
            lightcolor=BORDER,
            darkcolor=BORDER,
            padding=8,
        )

    def _build_interface(self) -> None:
        outer = tk.Frame(self, bg=BG)
        outer.pack(fill="both", expand=True, padx=28, pady=24)

        header = tk.Frame(outer, bg=BG)
        header.pack(fill="x", pady=(0, 18))
        self._add_logo(header)
        text_area = tk.Frame(header, bg=BG)
        text_area.pack(side="left", padx=(14, 0), fill="x", expand=True)
        tk.Label(
            text_area,
            text=APP_TITLE,
            font=("Microsoft YaHei UI", 20, "bold"),
            bg=BG,
            fg=TEXT,
        ).pack(anchor="w")
        tk.Label(
            text_area,
            text="Wi‑Fi 与打印服务快速维护 · 兼容 Windows 7 / 10 / 11",
            font=("Microsoft YaHei UI", 10),
            bg=BG,
            fg=MUTED,
        ).pack(anchor="w", pady=(3, 0))
        tk.Label(
            header,
            text=f"v{APP_VERSION}",
            font=("Microsoft YaHei UI", 9),
            bg="#E6F0FC",
            fg=PRIMARY,
            padx=10,
            pady=5,
        ).pack(side="right", pady=10)

        status_card = tk.Frame(outer, bg="#EAF3FD", highlightbackground="#C9DFF6", highlightthickness=1)
        status_card.pack(fill="x", pady=(0, 16))
        status_inner = tk.Frame(status_card, bg="#EAF3FD")
        status_inner.pack(fill="x", padx=16, pady=12)
        tk.Label(
            status_inner,
            text="系统状态",
            font=("Microsoft YaHei UI", 10, "bold"),
            bg="#EAF3FD",
            fg=PRIMARY,
        ).pack(side="left")
        self.status_label = tk.Label(
            status_inner,
            textvariable=self.status_value,
            font=("Microsoft YaHei UI", 10),
            bg="#EAF3FD",
            fg=self.status_color,
        )
        self.status_label.pack(side="right")

        wifi_card = self._card(outer)
        wifi_card.pack(fill="x", pady=(0, 14))
        self._card_title(wifi_card, "Wi‑Fi 控制", "选择无线网络接口后，可安全启用或禁用 Wi‑Fi。")
        adapter_row = tk.Frame(wifi_card, bg=CARD)
        adapter_row.pack(fill="x", padx=18, pady=(0, 4))
        tk.Label(
            adapter_row,
            text="无线接口",
            width=9,
            anchor="w",
            font=("Microsoft YaHei UI", 10),
            bg=CARD,
            fg=TEXT,
        ).pack(side="left")
        self.adapter_box = ttk.Combobox(
            adapter_row,
            textvariable=self.adapter_value,
            style="Toolbox.TCombobox",
            font=("Microsoft YaHei UI", 10),
        )
        self.adapter_box.pack(side="left", fill="x", expand=True, padx=(6, 10))
        refresh = self._button(adapter_row, "刷新", self.refresh_adapters, neutral=True, width=9)
        refresh.pack(side="right")
        tk.Label(
            wifi_card,
            textvariable=self.adapter_hint,
            font=("Microsoft YaHei UI", 9),
            bg=CARD,
            fg=MUTED,
        ).pack(anchor="w", padx=18, pady=(1, 12))
        wifi_actions = tk.Frame(wifi_card, bg=CARD)
        wifi_actions.pack(fill="x", padx=18, pady=(0, 18))
        enable_wifi = self._button(wifi_actions, "启用 Wi‑Fi", lambda: self.set_wifi(True), width=16)
        enable_wifi.pack(side="left")
        disable_wifi = self._button(wifi_actions, "禁用 Wi‑Fi", lambda: self.set_wifi(False), destructive=True, width=16)
        disable_wifi.pack(side="left", padx=(10, 0))
        check_wifi = self._button(wifi_actions, "检查状态", self.check_wifi_status, neutral=True, width=13)
        check_wifi.pack(side="right")

        printer_card = self._card(outer)
        printer_card.pack(fill="x")
        self._card_title(printer_card, "打印维护", "修复卡住的打印任务；清空队列会取消所有尚未完成的本地打印作业。")
        printer_actions = tk.Frame(printer_card, bg=CARD)
        printer_actions.pack(fill="x", padx=18, pady=(0, 18))
        restart = self._button(printer_actions, "重启打印机服务", self.restart_printer_service, width=18)
        restart.pack(side="left")
        clear_queue = self._button(printer_actions, "清空打印列表", self.confirm_clear_queue, destructive=True, width=16)
        clear_queue.pack(side="left", padx=(10, 0))

        footer = tk.Label(
            outer,
            text="需要管理员权限。应用仅修改本机网络接口与打印后台服务，不会上传设备信息。",
            font=("Microsoft YaHei UI", 9),
            bg=BG,
            fg=MUTED,
        )
        footer.pack(anchor="w", pady=(14, 0))

    def _add_logo(self, parent: tk.Widget) -> None:
        image_path = resource_path("assets/source-icon.png")
        if image_path.exists():
            try:
                image = Image.open(image_path).convert("RGBA")
                image.thumbnail((62, 62), Image.Resampling.LANCZOS)
                self.logo_image = ImageTk.PhotoImage(image)
                tk.Label(parent, image=self.logo_image, bg=BG).pack(side="left")
                return
            except Exception:
                pass
        tk.Label(
            parent,
            text="维护",
            font=("Microsoft YaHei UI", 12, "bold"),
            bg=PRIMARY,
            fg="white",
            width=5,
            height=2,
        ).pack(side="left")

    def _card(self, parent: tk.Widget) -> tk.Frame:
        return tk.Frame(parent, bg=CARD, highlightbackground=BORDER, highlightthickness=1)

    def _card_title(self, parent: tk.Widget, title: str, subtitle: str) -> None:
        section = tk.Frame(parent, bg=CARD)
        section.pack(fill="x", padx=18, pady=(16, 10))
        tk.Label(
            section,
            text=title,
            font=("Microsoft YaHei UI", 12, "bold"),
            bg=CARD,
            fg=TEXT,
        ).pack(anchor="w")
        tk.Label(
            section,
            text=subtitle,
            font=("Microsoft YaHei UI", 9),
            bg=CARD,
            fg=MUTED,
            wraplength=660,
            justify="left",
        ).pack(anchor="w", pady=(3, 0))

    def _button(
        self,
        parent: tk.Widget,
        text: str,
        command: Callable[[], None],
        *,
        neutral: bool = False,
        destructive: bool = False,
        width: int = 14,
    ) -> tk.Button:
        if destructive:
            bg, active = "#C4493A", "#AA382B"
        elif neutral:
            bg, active = "#E8EEF5", "#D9E3EF"
        else:
            bg, active = PRIMARY, PRIMARY_HOVER
        fg = TEXT if neutral else "#FFFFFF"
        button = tk.Button(
            parent,
            text=text,
            command=command,
            font=("Microsoft YaHei UI", 10, "bold"),
            bg=bg,
            fg=fg,
            activebackground=active,
            activeforeground=fg,
            disabledforeground="#9AA5B1",
            relief="flat",
            bd=0,
            padx=10,
            pady=9,
            width=width,
            cursor="hand2",
        )
        self.buttons.append(button)
        return button

    def set_status(self, message: str, color: str = MUTED) -> None:
        self.status_value.set(message)
        self.status_color = color
        self.status_label.configure(fg=color)

    def set_busy(self, busy: bool) -> None:
        self.busy = busy
        state = "disabled" if busy else "normal"
        for button in self.buttons:
            button.configure(state=state)
        self.adapter_box.configure(state="disabled" if busy else "normal")

    def execute(self, action_text: str, action: Callable[[], CommandResult]) -> None:
        if self.busy:
            return
        self.set_busy(True)
        self.set_status(f"正在{action_text}…", PRIMARY)

        def worker() -> None:
            result = action()
            self.after(0, lambda: self._finish_action(result))

        threading.Thread(target=worker, daemon=True).start()

    def _finish_action(self, result: CommandResult) -> None:
        self.set_busy(False)
        self.set_status(result.summary, SUCCESS if result.ok else ERROR)
        if not result.ok:
            messagebox.showerror(APP_TITLE, f"{result.summary}\n\n{result.detail}")

    def refresh_adapters(self) -> None:
        def scan() -> CommandResult:
            adapters = self.maintenance.find_wifi_adapters()
            if adapters:
                return CommandResult(True, "已找到 Wi‑Fi 接口", "|".join(adapters))
            return CommandResult(False, "未自动识别到 Wi‑Fi 接口", "可在“无线接口”输入框中手动填写接口名称，例如 Wi‑Fi。")

        if self.busy:
            return
        self.set_busy(True)
        self.set_status("正在扫描 Wi‑Fi 接口…", PRIMARY)

        def worker() -> None:
            result = scan()
            self.after(0, lambda: self._finish_refresh(result))

        threading.Thread(target=worker, daemon=True).start()

    def _finish_refresh(self, result: CommandResult) -> None:
        self.set_busy(False)
        if result.ok:
            adapters = [item for item in result.detail.split("|") if item]
            self.adapter_box["values"] = adapters
            if not self.adapter_value.get().strip() or self.adapter_value.get() not in adapters:
                self.adapter_value.set(adapters[0])
            self.adapter_hint.set(f"已识别接口：{'、'.join(adapters)}")
            self.set_status("Wi‑Fi 接口就绪", SUCCESS)
        else:
            self.adapter_box["values"] = ()
            self.adapter_hint.set(result.detail)
            self.set_status(result.summary, WARNING)

    def set_wifi(self, enabled: bool) -> None:
        action_text = "启用 Wi‑Fi" if enabled else "禁用 Wi‑Fi"
        self.execute(action_text, lambda: self.maintenance.set_wifi_enabled(self.adapter_value.get(), enabled))

    def check_wifi_status(self) -> None:
        self.execute("检查 Wi‑Fi 状态", lambda: self.maintenance.get_wifi_status(self.adapter_value.get()))

    def restart_printer_service(self) -> None:
        self.execute("重启打印后台服务", self.maintenance.restart_spooler)

    def confirm_clear_queue(self) -> None:
        accepted = messagebox.askyesno(
            APP_TITLE,
            "确定要清空所有本地打印任务吗？\n\n此操作会取消尚未完成的打印作业，且无法恢复。",
            icon="warning",
        )
        if accepted:
            self.execute("清空打印队列", self.maintenance.clear_print_queue)


def main() -> None:
    if not is_windows():
        root = tk.Tk()
        root.withdraw()
        messagebox.showerror(APP_TITLE, WINDOWS_ONLY_MESSAGE)
        root.destroy()
        return

    if not is_admin():
        if not relaunch_as_admin():
            root = tk.Tk()
            root.withdraw()
            messagebox.showwarning(
                APP_TITLE,
                "本工具需要管理员权限才能管理 Wi‑Fi 和打印后台服务。\n请在 UAC 提示中选择“是”。",
            )
            root.destroy()
        return

    app = MaintenanceApp()
    app.mainloop()


if __name__ == "__main__":
    main()
