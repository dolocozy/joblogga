#!/usr/bin/env python3
"""Make the README's top picture: the applications list split down the middle, light theme on the left, dark on the right.

Two thumbnails side by side would shrink the text to a third of its size; one split picture keeps it readable and shows
both themes at once. Both halves are the same real screenshot of the same data (applications-list-light.png and
-dark.png, from capture.mjs); this only cuts and joins them. Run it after capture.mjs and before optimize.py. Needs Pillow.
"""

from pathlib import Path

from PIL import Image

HERE = Path(__file__).parent
SPLIT = 975  # x, in picture pixels: in the gap after the status meter and before the status menu and the filter boxes
HEIGHT = 1620  # stops after a whole row
RULE = 4  # a thin divider so the join reads as deliberate

light = Image.open(HERE / "applications-list-light.png").convert("RGB")
dark = Image.open(HERE / "applications-list-dark.png").convert("RGB")
assert light.size == dark.size, "the two shots must be the same size"

hero = Image.new("RGB", (light.width, HEIGHT))
hero.paste(light.crop((0, 0, SPLIT, HEIGHT)), (0, 0))
hero.paste(dark.crop((SPLIT, 0, light.width, HEIGHT)), (SPLIT, 0))
hero.paste((138, 138, 128), (SPLIT - RULE // 2, 0, SPLIT + RULE // 2, HEIGHT))
hero.save(HERE / "hero-light-dark.png")
print(f"hero-light-dark.png: {hero.width}x{hero.height}")
