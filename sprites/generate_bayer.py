"""Generate a MapLibre sprite source with 2x2 and 4x4 Bayer dither patterns.
https://maplibre.org/maplibre-style-spec/sprite/
"""

import json
from pathlib import Path

from PIL import Image

OUT_DIR = Path(__file__).resolve().parent

M2 = (
    (0, 2),
    (3, 1),
)

M4 = (
    (0, 8, 2, 10),
    (12, 4, 14, 6),
    (3, 11, 1, 9),
    (15, 7, 13, 5),
)

FG = (0, 0, 0, 255)
BG = (0, 0, 0, 0)


def cell_image(matrix, level):
    size = len(matrix)
    img = Image.new("RGBA", (size, size), BG)
    px = img.load()
    for y in range(size):
        for x in range(size):
            if matrix[y][x] < level:
                px[x, y] = FG
    return img


def build_atlas(pixel_ratio):
    gutter = pixel_ratio # 1px at 1x, 2px at 2x
    s2 = 2 * pixel_ratio
    s4 = 4 * pixel_ratio

    row0_w = 5 * s2 + 4 * gutter
    row1_w = 17 * s4 + 16 * gutter
    atlas_w = max(row0_w, row1_w)
    atlas_h = s2 + gutter + s4

    atlas = Image.new("RGBA", (atlas_w, atlas_h), BG)
    index = {}

    # Row 0: 2x2 levels 0..4
    y0 = 0
    for k in range(5):
        cell = cell_image(M2, k)
        if pixel_ratio > 1:
            cell = cell.resize((s2, s2), Image.NEAREST)
        x = k * (s2 + gutter)
        atlas.alpha_composite(cell, (x, y0))
        name = f"bayer2-{k:02d}"
        index[name] = {
            "width": s2,
            "height": s2,
            "x": x,
            "y": y0,
            "pixelRatio": pixel_ratio,
        }

    # Row 1: 4x4 levels 0..16
    y1 = s2 + gutter
    for k in range(17):
        cell = cell_image(M4, k)
        if pixel_ratio > 1:
            cell = cell.resize((s4, s4), Image.NEAREST)
        x = k * (s4 + gutter)
        atlas.alpha_composite(cell, (x, y1))
        name = f"bayer4-{k:02d}"
        index[name] = {
            "width": s4,
            "height": s4,
            "x": x,
            "y": y1,
            "pixelRatio": pixel_ratio,
        }

    return atlas, index


def main():
    for pixel_ratio, suffix in ((1, ""), (2, "@2x")):
        atlas, index = build_atlas(pixel_ratio)
        png_path = OUT_DIR / f"bayer{suffix}.png"
        json_path = OUT_DIR / f"bayer{suffix}.json"
        atlas.save(png_path)
        json_path.write_text(json.dumps(index, indent=2) + "\n")
        print(f"wrote {png_path.name} {atlas.size} + {json_path.name} ({len(index)} entries)")


if __name__ == "__main__":
    main()
