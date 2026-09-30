"""Download raster tiles from local vt-raster-converter.

Full download (z=3..7 inclusive):
    sum((2**z)**2 for z in 3..7) = 64+256+1024+4096+16384 = 21824 tiles

Usage:
    python3 download_tiles.py --test            # fetch only Chicago 7/32/47
    python3 download_tiles.py --test-pyramid    # fetch Chicago tile at each zoom 3..7 (5 tiles)
    python3 download_tiles.py                   # full download z=3..7 (21824 tiles)
    python3 download_tiles.py --min-zoom 3 --max-zoom 5 --workers 16
"""

import argparse
import binascii
import io
import os
import struct
import sys
import time
import urllib.error
import urllib.request
import zlib
from concurrent.futures import ThreadPoolExecutor, as_completed

from PIL import Image

CHICAGO_TILE = (7, 32, 47)

DEFAULT_BASE = "http://localhost:8081/tiles"
DEFAULT_STYLE = "pebble_bw"
DEFAULT_TILE_SIZE = 256
DEFAULT_MIN_ZOOM = 3
DEFAULT_MAX_ZOOM = 7
DEFAULT_OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "png_tiles")


def tile_url(base, style, z, x, y):
    return f"{base.rstrip('/')}/{style}/{z}/{x}/{y}"


def tile_path(out_dir, z, x, y):
    # <out>/<z>/<x>/<y>.png  e.g. png_tiles/7/32/47.png
    return os.path.join(out_dir, str(z), str(x), f"{y}.png")


# Four gray levels (2bpp). LUT boundaries match
# `magick -dither None -posterize 4`: 0-42 -> 0, 43-127 -> 1, etc.
CRUSH_LUT = [min(3, round(v / 85)) for v in range(256)]

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def png_chunk(chunk_type, data):
    body = chunk_type + data
    return (struct.pack(">I", len(data)) + body
            + struct.pack(">I", binascii.crc32(body) & 0xFFFFFFFF))


def encode_2bit_grayscale(indexed, width, height):
    """Pack values 0..3 into a 2-bit grayscale PNG.

    Rows are stored unfiltered: packed bytes of flat map art compress
    better untouched than with PNG filters applied.
    """
    row_bytes = (width * 2 + 7) // 8
    raw = bytearray(height * (row_bytes + 1))
    pos = 0
    for y in range(height):
        offset, out = y * width, pos + 1  # first byte of each row selects no filtering
        for i in range(0, width - width % 4, 4):
            raw[out + (i >> 2)] = ((indexed[offset + i] << 6)
                                   | (indexed[offset + i + 1] << 4)
                                   | (indexed[offset + i + 2] << 2)
                                   | indexed[offset + i + 3])
        if width % 4:
            value = 0
            for j in range(width % 4):
                value |= indexed[offset + width - width % 4 + j] << (6 - 2 * j)
            raw[out + (width >> 2)] = value
        pos += row_bytes + 1
    header = struct.pack(">IIBBBBB", width, height, 2, 0, 0, 0, 0)
    return (PNG_MAGIC + png_chunk(b"IHDR", header)
            + png_chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + png_chunk(b"IEND", b""))


def crush_to_2bpp(png_data):
    """Grayscale, 4 levels, no dither. Returns 2-bit PNG bytes."""
    with Image.open(io.BytesIO(png_data)) as img:
        gray = img.convert("L")
    width, height = gray.size
    return encode_2bit_grayscale(gray.point(CRUSH_LUT).tobytes(), width, height)


def chicago_pyramid(min_zoom, max_zoom):
    """Ancestors/descendants of the Chicago tile for each zoom in range.

    XYZ tiles halve on zoom-out: parent(z-1) = (x//2, y//2).
    """
    az, ax, ay = CHICAGO_TILE
    tiles = []
    for z in range(min_zoom, max_zoom + 1):
        if z == az:
            x, y = ax, ay
        elif z < az:
            shift = az - z
            x, y = ax >> shift, ay >> shift
        else:  # z > az: pick top-left child (arbitrary but contains Chicago area)
            shift = z - az
            x, y = ax << shift, ay << shift
        tiles.append((z, x, y))
    return tiles


def fetch_one(url, path, timeout=30, retries=3, overwrite=False):
    if os.path.exists(path) and not overwrite:
        return "skipped"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp_path = path + ".tmp"
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "doppler-tile-downloader/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if resp.status != 200:
                    raise urllib.error.HTTPError(url, resp.status, "bad status", None, None)
                data = resp.read()
            # basic PNG sanity check
            if len(data) < 8 or data[:8] != b"\x89PNG\r\n\x1a\n":
                raise ValueError(f"not a PNG (got {len(data)} bytes, magic={data[:8]!r})")
            data = crush_to_2bpp(data)
            with open(tmp_path, "wb") as f:
                f.write(data)
            os.replace(tmp_path, path)
            return "ok"
        except Exception as e:  # noqa: BLE001 - want to retry whatever the server does
            last_err = e
            if attempt < retries:
                time.sleep(0.5 * attempt)
    # cleanup partial tmp file
    try:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
    except OSError:
        pass
    return f"error: {last_err}"


def iter_full_range(min_zoom, max_zoom):
    for z in range(min_zoom, max_zoom + 1):
        n = 2**z
        for x in range(n):
            for y in range(n):
                yield (z, x, y)


def download(tiles, base, style, out_dir, workers, overwrite, timeout, retries):
    total = len(tiles)
    counts = {"ok": 0, "skipped": 0, "error": 0}
    errors = []
    start = time.time()
    print(f"Downloading {total} tiles (style={style}) "
          f"with {workers} workers -> {out_dir}/<z>/<x>/<y>.png")
    with ThreadPoolExecutor(max_workers=workers) as ex:
        fut_to_tile = {
            ex.submit(
                fetch_one,
                tile_url(base, style, z, x, y),
                tile_path(out_dir, z, x, y),
                timeout, retries, overwrite,
            ): (z, x, y)
            for (z, x, y) in tiles
        }
        done = 0
        for fut in as_completed(fut_to_tile):
            z, x, y = fut_to_tile[fut]
            try:
                res = fut.result()
            except Exception as e:  # noqa: BLE001
                res = f"error: {e}"
            done += 1
            if res == "ok":
                counts["ok"] += 1
            elif res == "skipped":
                counts["skipped"] += 1
            else:
                counts["error"] += 1
                if len(errors) < 10:
                    errors.append(f"{z}/{x}/{y}: {res}")
            if done % 500 == 0 or done == total:
                el = time.time() - start
                rate = done / el if el > 0 else 0
                print(f"  {done}/{total} ({100*done/total:.1f}%) "
                      f"ok={counts['ok']} skip={counts['skipped']} err={counts['error']} "
                      f"{rate:.0f} tiles/s")
    print(f"Done in {time.time()-start:.1f}s: {counts}")
    if errors:
        print("First errors:")
        for e in errors:
            print(f"  {e}")
    return counts


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base-url", default=DEFAULT_BASE)
    ap.add_argument("--style", default=DEFAULT_STYLE)
    ap.add_argument("--min-zoom", type=int, default=DEFAULT_MIN_ZOOM)
    ap.add_argument("--max-zoom", type=int, default=DEFAULT_MAX_ZOOM)
    ap.add_argument("--out-dir", default=DEFAULT_OUT_DIR)
    ap.add_argument("--workers", type=int, default=16)
    ap.add_argument("--overwrite", action="store_true", help="re-download even if file exists")
    ap.add_argument("--timeout", type=int, default=30)
    ap.add_argument("--retries", type=int, default=3)
    ap.add_argument("--test", action="store_true",
                    help="fetch ONLY the Chicago tile 8/131/190 (ignores zoom range)")
    ap.add_argument("--test-pyramid", action="store_true",
                    help="fetch the Chicago-containing tile at each zoom in range "
                         "(e.g. 6 tiles for z=3..8)")
    args = ap.parse_args(argv)

    if args.test and args.test_pyramid:
        ap.error("--test and --test-pyramid are mutually exclusive")

    if args.test:
        tiles = [CHICAGO_TILE]
    elif args.test_pyramid:
        tiles = chicago_pyramid(args.min_zoom, args.max_zoom)
        print("Test pyramid (Chicago-containing tile per zoom):")
        for t in tiles:
            print(f"  {t[0]}/{t[1]}/{t[2]}")
    else:
        n = sum((2**z) ** 2 for z in range(args.min_zoom, args.max_zoom + 1))
        print(f"Full download: zooms {args.min_zoom}..{args.max_zoom} = {n} tiles.")
        tiles = list(iter_full_range(args.min_zoom, args.max_zoom))

    counts = download(tiles, args.base_url, args.style,
                      args.out_dir, args.workers, args.overwrite,
                      args.timeout, args.retries)
    return 1 if counts["error"] else 0


if __name__ == "__main__":
    sys.exit(main())
