#!/usr/bin/env python3
"""Shrink the screenshots in this folder in place: 256-colour palette PNGs, about 60% smaller.

The interface uses a handful of flat colours plus anti-aliased text, so a 256-colour palette looks the same
and keeps each picture well under 500 KB. Needs Pillow (pip install pillow). Safe to run twice: pictures that
already use a palette are left alone.
"""

from pathlib import Path

from PIL import Image

for path in sorted(Path(__file__).parent.glob("*.png")):
    image = Image.open(path)
    if image.mode == "P":
        continue
    before = path.stat().st_size
    image.convert("RGB").quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(path, optimize=True)
    print(f"{path.name}: {before // 1024} KB -> {path.stat().st_size // 1024} KB")
