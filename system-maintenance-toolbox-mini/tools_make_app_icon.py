"""从当前 Logo 源图生成 Windows 应用图标。"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "assets" / "logo_source.jpg"
OUTPUT = ROOT / "assets" / "app.ico"
SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256)


def main() -> None:
    source = Image.open(SOURCE).convert("RGBA")
    canvas = Image.new("RGBA", (256, 256), (248, 250, 252, 255))
    source.thumbnail((240, 240), Image.Resampling.LANCZOS)
    offset = ((256 - source.width) // 2, (256 - source.height) // 2)
    canvas.alpha_composite(source, offset)
    canvas.save(OUTPUT, format="ICO", sizes=[(size, size) for size in SIZES])
    print(f"已生成：{OUTPUT}，包含 {', '.join(map(str, SIZES))} px 图标尺寸。")


if __name__ == "__main__":
    main()
