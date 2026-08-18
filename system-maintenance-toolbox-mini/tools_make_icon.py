"""将用户提供的 PNG 图片转换为多尺寸 Windows ICO 图标。"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "assets" / "source-icon.png"
TARGET = ROOT / "assets" / "app.ico"
SIZES = (16, 24, 32, 48, 64, 128, 256)


def make_square_icon(image: Image.Image, size: int) -> Image.Image:
    """等比缩放原图并置于白色画布，避免裁剪任何原始内容。"""
    source = image.convert("RGBA")
    source.thumbnail((size, size), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), "white")
    x = (size - source.width) // 2
    y = (size - source.height) // 2
    canvas.alpha_composite(source, (x, y))
    return canvas


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(f"找不到源图片：{SOURCE}")
    with Image.open(SOURCE) as image:
        largest_frame = make_square_icon(image, max(SIZES))
    largest_frame.save(
        TARGET,
        format="ICO",
        sizes=[(size, size) for size in SIZES],
    )
    print(f"已生成图标：{TARGET}")


if __name__ == "__main__":
    main()
