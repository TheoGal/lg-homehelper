#!/usr/bin/env python3
"""Draw the tile icons for all five apps: solid yellow houses for Home Helper,
outlined white symbols on coloured tiles for the three LG shortcuts.

  python3 scripts/make-icons.py

Writes icon.png (80 px) and largeIcon.png (130 px) into each app folder, and the
256 px README icon to docs/icon.png. Needs Pillow (pip install pillow).
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SCALE = 4  # draw large, then shrink for smooth edges

DARK = (36, 29, 25)
YELLOW = (255, 196, 0)
WHITE = (255, 255, 255)
BLUE = (64, 168, 232)
PINK = (236, 72, 140)
GREY = (118, 124, 134)


def canvas(size, background):
    W = size * SCALE
    im = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, W - 1, W - 1], radius=W // 5, fill=background + (255,))
    return im, d, W


def stroke(W):
    return max(2, round(W * 0.055))


def outline(d, points, colour, width):
    """Closed outline with rounded joins."""
    d.line(points + points[:2], fill=colour, width=width, joint='curve')
    r = width / 2
    for x, y in points:
        d.ellipse([x - r, y - r, x + r, y + r], fill=colour)


def house(d, W, colour, door=True):
    w = stroke(W)
    left, right, top, eave, bottom = W * 0.24, W * 0.76, W * 0.22, W * 0.46, W * 0.78
    outline(d, [(W / 2, top), (right + W * 0.04, eave), (right, eave), (right, bottom),
                (left, bottom), (left, eave), (left - W * 0.04, eave)], colour, w)
    if door:
        dl, dr, dt = W * 0.44, W * 0.56, W * 0.6
        d.line([(dl, bottom), (dl, dt), (dr, dt), (dr, bottom)], fill=colour, width=w, joint='curve')


def gear(d, W, colour, cx, cy, radius, width=None):
    w = width or stroke(W)
    teeth = 8
    r_out, r_in = radius, radius * 0.76
    pts = []
    for i in range(teeth * 2):
        r = r_out if i % 2 == 0 else r_in
        for k in (-0.3, 0.3):  # flat tooth tops
            a = (i + 0.5 + k) * math.pi / teeth
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    outline(d, pts, colour, w)
    h = radius * 0.34
    d.ellipse([cx - h, cy - h, cx + h, cy + h], outline=colour, width=w)


def bell(d, W, colour):
    w = stroke(W)
    c = W / 2
    top, shoulder, rim = W * 0.25, W * 0.4, W * 0.67
    # dome
    d.arc([c - W * 0.17, top, c + W * 0.17, top + W * 0.3], 180, 360, fill=colour, width=w)
    # sides flaring to the rim
    d.line([(c - W * 0.17, shoulder - W * 0.002), (c - W * 0.17, W * 0.55), (c - W * 0.25, rim)],
           fill=colour, width=w, joint='curve')
    d.line([(c + W * 0.17, shoulder - W * 0.002), (c + W * 0.17, W * 0.55), (c + W * 0.25, rim)],
           fill=colour, width=w, joint='curve')
    d.line([(c - W * 0.27, rim), (c + W * 0.27, rim)], fill=colour, width=w)
    r = w / 2
    for x in (c - W * 0.27, c + W * 0.27):
        d.ellipse([x - r, rim - r, x + r, rim + r], fill=colour)
    # knob and clapper
    d.line([(c, top - W * 0.05), (c, top)], fill=colour, width=w)
    d.arc([c - W * 0.07, rim + W * 0.02, c + W * 0.07, rim + W * 0.12], 0, 180, fill=colour, width=w)


def live_tv(d, W, colour, background):
    w = stroke(W)
    c = W / 2
    # antenna
    d.line([(c - W * 0.12, W * 0.17), (c, W * 0.3), (c + W * 0.12, W * 0.17)], fill=colour, width=w, joint='curve')
    # screen
    d.rounded_rectangle([W * 0.16, W * 0.3, W * 0.84, W * 0.72], radius=W * 0.06, outline=colour, width=w)
    # stand
    d.line([(W * 0.36, W * 0.8), (W * 0.64, W * 0.8)], fill=colour, width=w)
    r = w / 2
    for x in (W * 0.36, W * 0.64):
        d.ellipse([x - r, W * 0.8 - r, x + r, W * 0.8 + r], fill=colour)
    # LIVE
    for name in ('DejaVuSans-Bold.ttf', 'Arial Bold.ttf', 'arialbd.ttf'):
        try:
            font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/' + name if name.startswith('DejaVu') else name,
                                      round(W * 0.15))
            break
        except OSError:
            font = None
    if font is None:
        font = ImageFont.load_default()
    box = d.textbbox((0, 0), 'LIVE', font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    d.text((c - tw / 2 - box[0], W * 0.51 - th / 2 - box[1]), 'LIVE', fill=colour, font=font)


def house_filled(d, W, colour):
    left, right, top, eave, bottom = W * 0.24, W * 0.76, W * 0.22, W * 0.46, W * 0.78
    pts = [(W / 2, top), (right + W * 0.06, eave + W * 0.01), (right, eave + W * 0.01), (right, bottom),
           (left, bottom), (left, eave + W * 0.01), (left - W * 0.06, eave + W * 0.01)]
    d.polygon(pts, fill=colour)
    outline(d, pts, colour, round(W * 0.03))  # soften the corners


def gear_points(cx, cy, radius):
    teeth, r_out, r_in, pts = 8, radius, radius * 0.74, []
    for i in range(teeth * 2):
        r = r_out if i % 2 == 0 else r_in
        for k in (-0.3, 0.3):  # flat tooth tops
            a = (i + 0.5 + k) * math.pi / teeth
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def home_helper(size):
    """Solid yellow house with the door cut out."""
    im, d, W = canvas(size, DARK)
    house_filled(d, W, YELLOW)
    d.rounded_rectangle([W * 0.43, W * 0.6, W * 0.57, W * 0.85], radius=W * 0.02, fill=DARK + (255,))
    return im


def home_helper_settings(size):
    """Solid yellow house with a gear cut out (its centre hole stays yellow)."""
    im, d, W = canvas(size, DARK)
    house_filled(d, W, YELLOW)
    cx, cy, r = W / 2, W * 0.6, W * 0.135
    d.polygon(gear_points(cx, cy, r), fill=DARK + (255,))
    h = r * 0.36
    d.ellipse([cx - h, cy - h, cx + h, cy + h], fill=YELLOW + (255,))
    return im


def lg_settings(size):
    im, d, W = canvas(size, GREY)
    gear(d, W, WHITE, W / 2, W / 2, W * 0.27)
    return im


def lg_notifications(size):
    im, d, W = canvas(size, BLUE)
    bell(d, W, WHITE)
    return im


def lg_live_tv(size):
    im, d, W = canvas(size, PINK)
    live_tv(d, W, WHITE, PINK)
    return im


def save(draw, folder):
    for size, name in ((80, 'icon.png'), (130, 'largeIcon.png')):
        im = draw(size)
        im.resize((size, size), Image.LANCZOS).save(ROOT / folder / name, optimize=True)


def main():
    save(home_helper, 'app')
    save(home_helper_settings, 'settings')
    save(lg_settings, 'shortcuts/lgsettings')
    save(lg_notifications, 'shortcuts/lgnotifications')
    save(lg_live_tv, 'shortcuts/lglivetv')
    home_helper(256).resize((256, 256), Image.LANCZOS).save(ROOT / 'docs/icon.png', optimize=True)
    print('icons written')


if __name__ == '__main__':
    main()
