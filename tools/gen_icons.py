#!/usr/bin/env python3
"""生成 WeTalk 的 PNG 图标（纯标准库，无需 Pillow）。"""
import struct
import sys
import zlib
from pathlib import Path

SS = 3  # 超采样倍数


def rrect(x, y, x0, y0, x1, y1, r):
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r and x0 <= x <= x1 and y0 <= y <= y1


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def render(size):
    top, bottom = (7, 193, 96), (18, 183, 106)
    bubbles = [
        # (x0, y0, x1, y1, radius) 归一化坐标，白色气泡
        (0.24, 0.29, 0.76, 0.62, 0.13),
        (0.32, 0.66, 0.60, 0.80, 0.07),  # 小尾巴
    ]
    rows = bytearray()
    n = size * SS
    for py in range(size):
        rows.append(0)  # PNG filter: none
        for px in range(size):
            acc = [0.0, 0.0, 0.0]
            for sy in range(SS):
                for sx in range(SS):
                    u = (px * SS + sx + 0.5) / n
                    v = (py * SS + sy + 0.5) / n
                    # 圆角方块底
                    if rrect(u, v, 0.0, 0.0, 1.0, 1.0, 0.22):
                        col = lerp(top, bottom, (u + v) / 2)
                    else:
                        col = (237, 237, 237)
                    if any(rrect(u, v, x0, y0, x1, y1, r) for x0, y0, x1, y1, r in bubbles):
                        col = (255, 255, 255)
                    for i in range(3):
                        acc[i] += col[i]
            rows.extend(round(c / (SS * SS)) for c in acc)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + chunk(b"IEND", b""))


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "public")
    out.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        path = out / f"icon-{size}.png"
        path.write_bytes(render(size))
        print(f"wrote {path} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
