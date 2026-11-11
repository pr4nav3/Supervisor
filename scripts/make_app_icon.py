#!/usr/bin/env python3
"""Generate the app icons (src-tauri/icons): the site's eye, redrawn bolder below 64 px.

Each size is drawn at 8x and averaged down, so edges are smooth. The ICO holds every size
Windows asks for, as plain bitmaps below 256 px.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path


INK = (16, 16, 16, 255)
PAPER = (244, 234, 215, 255)
ACID = (168, 235, 55, 255)
COBALT = (50, 103, 255, 255)
CLEAR = (0, 0, 0, 0)


def lerp(a: int, b: int, t: float) -> int:
    return int(round(a + (b - a) * t))


def mix(c0: tuple[int, int, int, int], c1: tuple[int, int, int, int], t: float) -> tuple[int, int, int, int]:
    return tuple(lerp(a, b, t) for a, b in zip(c0, c1))  # type: ignore[return-value]


SUPERSAMPLE = 8


def draw_icon(size: int, supersample: int = SUPERSAMPLE) -> list[list[tuple[int, int, int, int]]]:
    """Each pixel averages an 8x8 grid of samples, so the circle's edge is a smooth gradient of
    alpha rather than a staircase: at 16 and 32 px the ring still reads as round."""
    big = size * supersample
    centre = big / 2
    if size < 64:
        # Taskbar, title bar, small dock: the site's eye with its inner bands grown so they
        # stay apart at 24 px, a small pupil (a full one's soft rim would cover the two pixels
        # of blue around it), and drawn to the box's edge so it sits at its neighbours' size.
        outer = big * 0.5
        border = big * 0.06
        acid_r = big * 0.29
        cobalt_r = big * 0.195
        pupil_r = big * 0.06
    else:
        # Explorer, the installer, a large dock: the site's eye exactly (website/assets/eye.svg,
        # a 128 box: ring to 58.88, paper to 51.2, green to 28.16, blue to 16.64, pupil to 7.04).
        outer = big * (58.88 / 128)
        border = big * ((58.88 - 51.2) / 128)
        acid_r = big * (28.16 / 128)
        cobalt_r = big * (16.64 / 128)
        pupil_r = big * (7.04 / 128)

    def sample(x: int, y: int) -> tuple[int, int, int, int]:
        dx = x + 0.5 - centre
        dy = y + 0.5 - centre
        dist = (dx * dx + dy * dy) ** 0.5
        if dist > outer:
            return CLEAR
        if dist > outer - border:
            return INK
        if dist > acid_r:
            return PAPER
        if dist > cobalt_r:
            return ACID
        if dist > pupil_r:
            return COBALT
        return INK

    pixels = []
    n = supersample * supersample
    for py in range(size):
        row = []
        for px in range(size):
            r = g = b = a = 0
            for sy in range(supersample):
                for sx in range(supersample):
                    sr, sg, sb, sa = sample(px * supersample + sx, py * supersample + sy)
                    # Colour weighted by coverage, so edge pixels don't darken toward black.
                    r += sr * sa
                    g += sg * sa
                    b += sb * sa
                    a += sa
            if a == 0:
                row.append(CLEAR)
            else:
                row.append((round(r / a), round(g / a), round(b / a), round(a / n)))
        pixels.append(row)
    return pixels


def png_bytes(pixels: list[list[tuple[int, int, int, int]]]) -> bytes:
    height = len(pixels)
    width = len(pixels[0])
    raw = b"".join(
        b"\x00" + b"".join(struct.pack("BBBB", *pixel) for pixel in row) for row in pixels
    )

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def dib_bytes(pixels: list[list[tuple[int, int, int, int]]]) -> bytes:
    """A 32-bit bottom-up DIB with its AND mask: the plain ICO entry every Windows shell path
    decodes without a PNG step. PNG entries are only safe at 256 px."""
    height = len(pixels)
    width = len(pixels[0])
    header = struct.pack("<IiiHHIIiiII", 40, width, height * 2, 1, 32, 0, 0, 0, 0, 0, 0)
    colour = b"".join(
        b"".join(struct.pack("BBBB", b, g, r, a) for (r, g, b, a) in row) for row in reversed(pixels)
    )
    mask_row_bytes = ((width + 31) // 32) * 4
    mask = b""
    for row in reversed(pixels):
        bits = 0
        for x, (_, _, _, a) in enumerate(row):
            if a == 0:
                bits |= 1 << (mask_row_bytes * 8 - 1 - x)
        mask += bits.to_bytes(mask_row_bytes, "big")
    return header + colour + mask


def ico_bytes(images: dict[int, bytes]) -> bytes:
    # 48 px first: Tauri gives a running window the ICO's first image, and Windows scales that one
    # for the taskbar (24 px at 100%). Halving 48 stays sharp; stretching 16 was blurry.
    sizes = sorted(images, key=lambda size: (size != 48, size))
    count = len(sizes)
    offset = 6 + 16 * count
    entries = b""
    payloads = b""
    for size in sizes:
        data = images[size]
        width_byte = 0 if size >= 256 else size
        entries += struct.pack("<BBBBHHII", width_byte, width_byte, 0, 0, 1, 32, len(data), offset)
        payloads += data
        offset += len(data)
    return struct.pack("<HHH", 0, 1, count) + entries + payloads


def main() -> None:
    repo = Path(__file__).resolve().parents[1]
    icons = repo / "src-tauri" / "icons"
    icons.mkdir(parents=True, exist_ok=True)

    # Every size Windows asks for at the common scales, so the shell never stretches one:
    # 16/20/24 for title bars and taskbars, 32/40/48 at higher scales, 64 to 256 for Explorer.
    drawn = {size: draw_icon(size) for size in (16, 20, 24, 32, 40, 48, 64, 96, 128, 256)}
    (icons / "32x32.png").write_bytes(png_bytes(drawn[32]))
    (icons / "128x128.png").write_bytes(png_bytes(drawn[128]))
    (icons / "icon.png").write_bytes(png_bytes(drawn[256]))
    # The Mac's Dock and Finder on a Retina screen: Tauri builds icon.icns from these (the
    # @2x one is 1024 px). Fewer samples per pixel here only because pure Python
    # is slow at 1024 px.
    (icons / "512x512.png").write_bytes(png_bytes(draw_icon(512, 4)))
    (icons / "512x512@2x.png").write_bytes(png_bytes(draw_icon(1024, 2)))
    entries = {size: (png_bytes(pixels) if size >= 256 else dib_bytes(pixels)) for size, pixels in drawn.items()}
    (icons / "icon.ico").write_bytes(ico_bytes(entries))
    print(f"wrote icons in {icons}")


if __name__ == "__main__":
    main()
