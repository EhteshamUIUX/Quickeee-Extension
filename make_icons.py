"""Generate the extension PNG icons (brand 'Q' on a rounded blue tile).

Run:  python make_icons.py
Requires Pillow (pip install pillow). Re-run only when the icon design changes.
"""
from __future__ import annotations

import os

from PIL import Image, ImageDraw, ImageFont

BRAND = (37, 99, 235, 255)  # brand-600
WHITE = (255, 255, 255, 255)
SIZES = [16, 32, 48, 128]
OUT = os.path.join(os.path.dirname(__file__), "icons")


def _font(size: int):
    for name in ("seguisb.ttf", "segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def make(size: int) -> None:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = max(2, size // 5)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=BRAND)
    font = _font(int(size * 0.66))
    text = "Q"
    bbox = d.textbbox((0, 0), text, font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((size - w) / 2 - bbox[0], (size - h) / 2 - bbox[1]), text, font=font, fill=WHITE)
    img.save(os.path.join(OUT, f"icon{size}.png"))


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for s in SIZES:
        make(s)
    print(f"Wrote {len(SIZES)} icons to {OUT}")


if __name__ == "__main__":
    main()
