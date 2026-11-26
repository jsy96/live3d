"""Generate the tray/window icons for ai-live3d.

Outputs:
  assets/icon.png  256x256 (window / packaging icon)
  assets/tray.png   32x32  (system tray)
"""

from pathlib import Path

from PIL import Image, ImageDraw

BASE = Path(__file__).resolve().parent.parent
ASSETS = BASE / "assets"
ASSETS.mkdir(exist_ok=True)

SIZE = 256
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# Rounded-square background.
d.rounded_rectangle([8, 8, SIZE - 8, SIZE - 8], radius=56, fill=(91, 155, 213, 255))

# Face: eyes, blush, smile.
d.ellipse([70, 92, 106, 128], fill=(255, 255, 255, 255))
d.ellipse([150, 92, 186, 128], fill=(255, 255, 255, 255))
d.ellipse([80, 102, 96, 118], fill=(40, 40, 40, 255))
d.ellipse([160, 102, 176, 118], fill=(40, 40, 40, 255))
d.ellipse([56, 134, 88, 152], fill=(255, 170, 170, 200))
d.ellipse([168, 134, 200, 152], fill=(255, 170, 170, 200))
d.arc([96, 122, 160, 172], start=20, end=160, fill=(40, 40, 40, 255), width=10)

img.save(ASSETS / "icon.png")
img.resize((32, 32), Image.LANCZOS).save(ASSETS / "tray.png")
print(f"icons written to {ASSETS}")
