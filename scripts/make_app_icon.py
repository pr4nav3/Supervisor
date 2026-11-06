#!/usr/bin/env python3
"""Generate the Supervisor window/tray icons for Windows tauri-build: a smooth-edged ring."""

from __future__ import annotations

import struct
import zlib
from pathlib import Path


INK = (16, 16, 16, 255)
PAPER = (244, 234, 215, 255)
ACID = (183, 255, 60, 255)
COBALT = (50, 103, 255, 255)
CLEAR = (0, 0, 0, 0)


def lerp(a: int, b: int, t: float) -> int:
    return int(round(a + (b - a) * t))


def mix(c0: tuple[int, int, int, int], c1: tuple[int, int, int, int], t: float) -> tuple[int, int, int, int]:
    return tuple(lerp(a, b, t) for a, b in zip(c0, c1))  # type: ignore[return-value]


SUPERSAMPLE = 8


def draw_icon(size: int) -> list[list[tuple[int, int, int, int]]]:
    """Each pixel averages an 8x8 grid of samples, so the circle's edge is a smooth gradient of
    alpha rather than a staircase: at 16 and 32 px the ring still reads as round."""
    big = size * SUPERSAMPLE
    centre = big / 2
    # The ring fills its box, as the neighbouring taskbar icons do; the smooth edge keeps it
    # from reading as a hard square.
    outer = big * 0.495
    border = max(1.2 * SUPERSAMPLE, big * 0.06)
    acid_r = big * 0.22
    cobalt_r = big * 0.13
    pupil_r = big * 0.055

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
    n = SUPERSAMPLE * SUPERSAMPLE
    for py in range(size):
        row = []
        for px in range(size):
            r = g = b = a = 0
            for sy in range(SUPERSAMPLE):
                for sx in range(SUPERSAMPLE):
                    sr, sg, sb, sa = sample(px * SUPERSAMPLE + sx, py * SUPERSAMPLE + sy)
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


def ico_bytes(images: dict[int, bytes]) -> bytes:
    sizes = sorted(images)
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
    pngs = {size: png_bytes(draw_icon(size)) for size in (16, 20, 24, 32, 40, 48, 64, 96, 128, 256)}
    (icons / "32x32.png").write_bytes(pngs[32])
    (icons / "128x128.png").write_bytes(pngs[128])
    (icons / "icon.png").write_bytes(pngs[256])
    (icons / "icon.ico").write_bytes(ico_bytes(pngs))
    print(f"wrote icons in {icons}")


if __name__ == "__main__":
    main()
