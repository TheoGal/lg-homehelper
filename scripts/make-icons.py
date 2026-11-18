#!/usr/bin/env python3
"""Draw the tile icons for Home Helper and Home Helper Settings: solid yellow
houses (the settings one with a gear cut out). The LG Shortcuts tiles live in
their own repository, TheoGal/lg-shortcuts.

  python3 scripts/make-icons.py

Writes icon.png (80 px) and largeIcon.png (130 px) into each app folder, and the
256 px README icon to docs/icon.png. Needs Pillow (pip install pillow).

App icons are full squares, coloured to the edges: LG Home and launchers such as
Hearth give every tile their own rounded shape, and corners rounded in the icon
itself show up as notches or a second, mismatched curve. Only the README icon is
rounded here, since GitHub shows it as it is.
"""
import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SCALE = 4  # draw large, then shrink for smooth edges

DARK = (36, 29, 25)
YELLOW = (255, 196, 0)
WHITE = (255, 255, 255)
BLUE = (64, 168, 232)
PINK = (236, 72, 140)
GREY = (118, 124, 134)
DARK_GREY = (72, 76, 84)


def canvas(size, background):
    W = size * SCALE
    im = Image.new('RGBA', (W, W), background + (255,))
    d = ImageDraw.Draw(im)
    return im, d, W


def rounded(im):
    """The README icon only: rounded corners, as a launcher would show it."""
    W = im.size[0]
    mask = Image.new('L', (W, W), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, W - 1], radius=W // 5, fill=255)
    out = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    out.paste(im, (0, 0), mask)
    return out


def stroke(W):
    return max(2, round(W * 0.055))


def outline(d, points, colour, width):
    """Closed outline with rounded joins."""
    d.line(points + points[:2], fill=colour, width=width, joint='curve')
    r = width / 2
    for x, y in points:
        d.ellipse([x - r, y - r, x + r, y + r], fill=colour)


def smooth(mask, r):
    """Round every corner of a 1-bit shape (blur, then threshold)."""
    return mask.filter(ImageFilter.GaussianBlur(r)).point(lambda v: 255 if v >= 128 else 0)


def odd(n):
    n = max(3, int(round(n)))
    return n if n % 2 else n + 1


def outline_of(mask, width):
    """A stroke centred on the edge of a shape."""
    grow = mask.filter(ImageFilter.MaxFilter(odd(width)))
    shrink = mask.filter(ImageFilter.MinFilter(odd(width)))
    return ImageChops.subtract(grow, shrink)


def paint(im, mask, colour):
    im.paste(Image.new('RGBA', im.size, colour + (255,)), (0, 0), mask)


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


def save(draw, folder):
    for size, name in ((80, 'icon.png'), (130, 'largeIcon.png')):
        im = draw(size)
        im.resize((size, size), Image.LANCZOS).save(ROOT / folder / name, optimize=True)


def main():
    save(home_helper, 'app')
    save(home_helper_settings, 'settings')
    rounded(home_helper(256)).resize((256, 256), Image.LANCZOS).save(ROOT / 'docs/icon.png', optimize=True)
    print('icons written')


if __name__ == '__main__':
    main()
