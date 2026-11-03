"""
生成应用图标：写入 src-tauri/icons/（窗口、任务栏、托盘、安装包共用）。
只依赖 Python 标准库，避免为了一个图标去装 Pillow。

图案：圆角渐变底板 + 若干条长度递减的白色横条（工具列表的意象），
配色与侧边栏 brand-mark 保持一致。

清晰度策略：
  - 大尺寸按比例渲染，抗锯齿靠超采样（尺寸越大采样越少，控制生成时间）。
  - 小尺寸（≤ 40px）改成「按像素对齐」：横条高度取整数像素、左右端点吸附
    到整像素、圆角归零，避免 16px 下三条横条糊成一块白斑。
  - 16px 只画两条：三条在 16px 里挤不出空隙。
"""

import os
import struct
import zlib

BG_TOP = (77, 123, 251)      # #4D7BFB
BG_BOTTOM = (47, 79, 203)    # #2F4FCB
BARS = [
    (0.345, 0.735, 0.96),
    (0.500, 0.615, 0.84),
    (0.655, 0.680, 0.72),
]
# 20px 以内只放两条，三条必然粘连
BARS_TINY = [
    (0.375, 0.800, 1.0),
    (0.625, 0.640, 0.9),
]

# 40 / 96 是 Windows 125% / 150% 缩放下任务栏会挑的尺寸，给足了才不会拿别的尺寸硬放
SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]


def inside_round_rect(x, y, x0, y0, x1, y1, r):
    dx = max(x0 + r - x, 0.0, x - (x1 - r))
    dy = max(y0 + r - y, 0.0, y - (y1 - r))
    return dx * dx + dy * dy <= r * r


# 托盘小尺寸专用：间距拉开、线宽收窄，
# 否则 16px 下三条横条糊成一团，只能看到一块白色斑点
TRAY_BARS = [
    (0.30, 0.78, 0.95),
    (0.52, 0.60, 0.88),
    (0.74, 0.69, 0.82),
]


def supersample_for(S):
    """小图多采样，大图少采样——512px 用 9 次已经够，再多只是白等"""
    if S <= 48:
        return 8
    if S <= 128:
        return 4
    return 3


def snapped_rects(S, bars, bar_px, left_px, round_end=False):
    """按像素网格算横条矩形：整像素厚度 + 整像素端点，边缘才锐"""
    x0 = round(left_px) / S
    radius = (bar_px / 2) / S if round_end else 0.0
    rects = []
    for cy, right, alpha in bars:
        top = round(cy * S - bar_px / 2)
        rects.append((x0, top / S, round(right * S) / S, (top + bar_px) / S, radius, alpha))
    return rects


def scaled_rects(S, bars):
    """大尺寸按比例走，端点是圆的"""
    bar_h = max(0.078, 1.6 / S)
    rects = []
    for cy, right, alpha in bars:
        rects.append((0.255, cy - bar_h / 2, right, cy + bar_h / 2, bar_h / 2, alpha))
    return rects


def rects_for(S, bars=None):
    if S <= 20:
        # 16px：两条 3px，直角端点最锐
        return snapped_rects(S, BARS_TINY, 3, max(3, round(S * 0.24)))
    if S <= 28:
        return snapped_rects(S, bars or BARS, 3, max(3, round(S * 0.25)))
    if S <= 40:
        return snapped_rects(S, bars or BARS, 4, max(5, round(S * 0.26)), round_end=True)
    if S <= 48:
        return snapped_rects(S, bars or BARS, 5, max(6, round(S * 0.26)), round_end=True)
    return scaled_rects(S, bars or BARS)


def render(S, bars=None):
    ss = supersample_for(S)
    pad = 0.02
    radius = 0.225
    card = (pad, pad, 1 - pad, 1 - pad, radius)
    rects = rects_for(S, bars)

    rows = []
    for ly in range(S):
        row = bytearray()
        for lx in range(S):
            cov_bg = _cov(lx, ly, S, card, ss)
            if cov_bg <= 0:
                row += b"\x00\x00\x00\x00"
                continue

            t = (ly + 0.5) / S
            r = BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t
            g = BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t
            b = BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t

            for x0, y0, x1, y1, rad, alpha in rects:
                cov = _cov(lx, ly, S, (x0, y0, x1, y1, rad), ss)
                if cov <= 0:
                    continue
                a = cov * alpha
                r = r * (1 - a) + 255 * a
                g = g * (1 - a) + 255 * a
                b = b * (1 - a) + 255 * a

            row += bytes(
                (
                    int(round(max(0, min(255, r)))),
                    int(round(max(0, min(255, g)))),
                    int(round(max(0, min(255, b)))),
                    int(round(cov_bg * 255)),
                )
            )
        rows.append(bytes(row))
    return rows


def _cov(lx, ly, S, rect, ss):
    x0, y0, x1, y1, r = rect
    hit = 0
    for sy in range(ss):
        yy = (ly + (sy + 0.5) / ss) / S
        for sx in range(ss):
            xx = (lx + (sx + 0.5) / ss) / S
            if inside_round_rect(xx, yy, x0, y0, x1, y1, r):
                hit += 1
    return hit / (ss * ss)


def png_bytes(S, bars=None):
    rows = render(S, bars)
    raw = b"".join(b"\x00" + row for row in rows)

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", S, S, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def write_ico(path):
    images = [png_bytes(S) for S in SIZES]
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = len(header) + 16 * len(images)
    entries = b""
    for S, data in zip(SIZES, images):
        entries += struct.pack(
            "<BBBBHHII",
            0 if S >= 256 else S,
            0 if S >= 256 else S,
            0,
            0,
            1,
            32,
            len(data),
            offset,
        )
        offset += len(data)
    with open(path, "wb") as fh:
        fh.write(header + entries + b"".join(images))


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))          # <repo>/src-tauri/tools
    repo = os.path.dirname(os.path.dirname(here))               # <repo>
    tauri_icons = os.path.join(repo, "src-tauri", "icons")
    os.makedirs(tauri_icons, exist_ok=True)

    # Tauri 需要在 src-tauri/icons 下放 PNG（窗口/任务栏/托盘）+ ico（安装包）
    for size, name in (
        (32, "32x32.png"),
        (128, "128x128.png"),
        (256, "128x128@2x.png"),
        (512, "icon.png"),
    ):
        out = os.path.join(tauri_icons, name)
        with open(out, "wb") as fh:
            fh.write(png_bytes(size))
        print(f"生成 {out}（{size}x{size}，{os.path.getsize(out)} 字节）")

    ico = os.path.join(tauri_icons, "icon.ico")
    write_ico(ico)
    print(f"生成 {ico}（{os.path.getsize(ico)} 字节，{len(SIZES)} 个尺寸）")
