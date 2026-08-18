"""验证 PE 可执行程序是否包含正确编码的 Windows 版本资源文字。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RELEASE = ROOT / "release"
TARGETS = (
    "系统维护工具箱mini",
    "樱花科技工作室",
    "系统维护工具箱 mini.exe",
    "0.05",
    "0.1.0",
)
GARBLED_MARKER = "ç³»ç»"


def contains_utf16le(data: bytes, text: str) -> bool:
    return text.encode("utf-16le") in data


def main() -> None:
    executables = sorted(RELEASE.glob("*.exe"))
    if not executables:
        raise SystemExit("未找到待验证的可执行程序。")

    for executable in executables:
        data = executable.read_bytes()
        missing = [text for text in TARGETS if not contains_utf16le(data, text)]
        garbled_found = contains_utf16le(data, GARBLED_MARKER)
        if missing or garbled_found:
            print(f"失败：{executable.name}")
            if missing:
                print(f"缺少：{', '.join(missing)}")
            if garbled_found:
                print("检测到旧版乱码标记。")
            raise SystemExit(1)
        print(f"通过：{executable.name} 的中文版本资源编码正确。")


if __name__ == "__main__":
    main()
