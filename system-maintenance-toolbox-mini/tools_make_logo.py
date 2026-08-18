"""将用户提供的 Logo 图片转换为 Windows 资源使用的正方形 BMP。"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "assets" / "logo_source.jpg"
OUTPUT = ROOT / "assets" / "logo.bmp"
CANVAS = 96
PADDING = 4


def main() -> None:
    source = Image.open(SOURCE).convert("RGB")
    source.thumbnail((CANVAS - PADDING * 2, CANVAS - PADDING * 2), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (CANVAS, CANVAS), "#f8fafc")
    offset = ((CANVAS - source.width) // 2, (CANVAS - source.height) // 2)
    canvas.paste(source, offset)
    canvas.save(OUTPUT, format="BMP")
    print(f"已生成：{OUTPUT}，尺寸 {canvas.width}×{canvas.height}。")


if __name__ == "__main__":
    main()
