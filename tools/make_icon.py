"""Generate the macOS app icon set (assets/icon/) from the character PNGs.

Background: "Meeting Room" — the meeting_room.png office scene (slightly
blurred, bottom-shaded for character contrast) with a ground contact shadow
and an inner highlight border. Requires Pillow; run: python3 tools/make_icon.py
"""
from PIL import Image, ImageDraw, ImageFilter
import os, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(ROOT, "assets/images")
OUT = os.path.join(ROOT, "assets/icon")
os.makedirs(OUT, exist_ok=True)

S = 1024
INSET = 100    # transparent margin (macOS icon grid)
RADIUS = 185   # rounded-rect corner radius at 1024

MASK = Image.new("L", (S, S), 0)
ImageDraw.Draw(MASK).rounded_rectangle(
    [INSET, INSET, S - INSET, S - INSET], radius=RADIUS, fill=255
)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def vgrad(top, bottom):
    g = Image.new("RGBA", (S, S))
    px = g.load()
    for y in range(S):
        r, gg, b = lerp(top, bottom, y / (S - 1))
        for x in range(S):
            px[x, y] = (r, gg, b, 255)
    return g


def radial_glow(center, color, inner_r, outer_r, max_alpha):
    cx, cy = center
    g = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    px = g.load()
    span = max(outer_r - inner_r, 1)
    for y in range(S):
        for x in range(S):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if d <= inner_r:
                a = max_alpha
            elif d >= outer_r:
                a = 0
            else:
                a = int(max_alpha * (1 - (d - inner_r) / span))
            if a:
                px[x, y] = (color[0], color[1], color[2], a)
    return g


def apply_mask(overlay):
    return Image.composite(overlay, Image.new("RGBA", (S, S), (0, 0, 0, 0)), MASK)


def vignette(strength):
    v = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(v)
    d.ellipse([-S * 0.20, -S * 0.20, S * 1.20, S * 1.20], fill=255)
    v = v.filter(ImageFilter.GaussianBlur(140))
    dark = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    dpx = dark.load()
    vpx = v.load()
    for y in range(S):
        for x in range(S):
            a = int((255 - vpx[x, y]) / 255 * strength)
            if a:
                dpx[x, y] = (0, 0, 0, a)
    return dark


# ── Meeting Room background ───────────────────────────────────────────
room = Image.open(os.path.join(IMG, "meeting_room.png")).convert("RGBA")
room = room.resize((S - 2 * INSET, S - 2 * INSET), Image.LANCZOS)
room = room.filter(ImageFilter.GaussianBlur(2.5))  # 캐릭터가 주인공이 되도록 살짝 블러
base = Image.new("RGBA", (S, S), (0, 0, 0, 0))
base.paste(room, (INSET, INSET))
bg = apply_mask(base)

# 하단 음영 — 캐릭터·바닥 대비 확보
shade = Image.new("RGBA", (S, S), (0, 0, 0, 0))
spx = shade.load()
for y in range(520, S):
    a = int(90 * (y - 520) / (S - 520))
    for x in range(S):
        spx[x, y] = (16, 22, 38, a)
bg = Image.alpha_composite(bg, apply_mask(shade))
bg = Image.alpha_composite(bg, apply_mask(vignette(45)))

# 바닥 접지 그림자 — 캐릭터가 바닥에 앉아 있는 느낌
ground = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(ground).ellipse([236, 800, 788, 872], fill=(10, 14, 26, 90))
bg = Image.alpha_composite(bg, apply_mask(ground.filter(ImageFilter.GaussianBlur(26))))

# 안쪽 하이라이트 테두리 (유리 느낌)
edge = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(edge).rounded_rectangle(
    [INSET + 3, INSET + 3, S - INSET - 3, S - INSET - 3],
    radius=RADIUS - 3, outline=(255, 255, 255, 130), width=4
)
bg = Image.alpha_composite(bg, apply_mask(edge.filter(ImageFilter.GaussianBlur(2))))


# ── Characters: kitty left, rabbit right (behind), foxy center front ──
def load(name, size):
    im = Image.open(os.path.join(IMG, name)).convert("RGBA")
    return im.resize((size, size), Image.LANCZOS)


def shadow_paste(base, im, pos):
    sh = Image.new("RGBA", base.size, (0, 0, 0, 0))
    alpha = im.split()[3].point(lambda a: int(a * 0.30))
    black = Image.new("RGBA", im.size, (0, 0, 0, 255))
    black.putalpha(alpha)
    sh.paste(black, (pos[0] + 8, pos[1] + 18), black)
    sh = sh.filter(ImageFilter.GaussianBlur(14))
    base.alpha_composite(sh)
    base.alpha_composite(im, pos)


canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
shadow_paste(canvas, load("kitty_marketer-removebg-preview.png", 430), (140, 330))
shadow_paste(canvas, load("rabbit_accountant-removebg-preview.png", 430), (470, 330))
shadow_paste(canvas, load("foxy_developer-removebg-preview.png", 560), (232, 300))
icon = Image.alpha_composite(bg, apply_mask(canvas))

icon.save(os.path.join(OUT, "icon_1024.png"))

# ── iconset → icns, dock/tray PNGs ───────────────────────────────────
iconset = os.path.join(OUT, "agents.iconset")
os.makedirs(iconset, exist_ok=True)
for s in [16, 32, 128, 256, 512]:
    icon.resize((s, s), Image.LANCZOS).save(os.path.join(iconset, f"icon_{s}x{s}.png"))
    icon.resize((s * 2, s * 2), Image.LANCZOS).save(os.path.join(iconset, f"icon_{s}x{s}@2x.png"))
subprocess.run(["iconutil", "-c", "icns", iconset, "-o", os.path.join(OUT, "agents.icns")], check=True)
subprocess.run(["rm", "-rf", iconset], check=True)

icon.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, "dock.png"))
icon.resize((18, 18), Image.LANCZOS).save(os.path.join(OUT, "tray.png"))
icon.resize((36, 36), Image.LANCZOS).save(os.path.join(OUT, "tray@2x.png"))
print("done:", sorted(os.listdir(OUT)))
