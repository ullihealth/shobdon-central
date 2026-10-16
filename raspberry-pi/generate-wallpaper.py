#!/usr/bin/env python3
"""Generates the dark, branded desktop wallpaper shown during the brief
gap whenever kiosk.service restarts (confirmed live, 2026-10-16:
pcmanfm-pi - part of the Raspberry Pi OS desktop, running independently
of this project's own kiosk setup - paints the stock Raspberry Pi
wallpaper underneath Chromium whenever no window covers the screen,
which briefly showed through during a kiosk restart and looked like a
crash rather than a normal, brief gap). Matches the project's existing
dark theme (wifi-setup-page/index.html's own palette) so the gap reads
as intentional.

Uses Pillow (already installed on this Pi - confirmed before writing
this, not an added dependency) rather than ImageMagick, which isn't
installed and would be one.

Usage: python3 generate-wallpaper.py <output-path> [width] [height]
"""
import sys

from PIL import Image, ImageDraw, ImageFont

BG = (2, 6, 23)  # #020617 - same page background as wifi-setup-page/index.html
BRAND_COLOR = (56, 189, 248)  # #38bdf8 - same sky accent
SUB_COLOR = (148, 163, 184)  # #94a3b8 - same muted sub-text color

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REGULAR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def main():
    if len(sys.argv) < 2:
        print("Usage: generate-wallpaper.py <output-path> [width] [height]", file=sys.stderr)
        sys.exit(1)
    out_path = sys.argv[1]
    width = int(sys.argv[2]) if len(sys.argv) > 2 else 1920
    height = int(sys.argv[3]) if len(sys.argv) > 3 else 1080

    img = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(img)

    brand_font = ImageFont.truetype(FONT_BOLD, int(height * 0.07))
    sub_font = ImageFont.truetype(FONT_REGULAR, int(height * 0.035))

    brand_text = "AIRFIELD CENTRAL"
    sub_text = "Starting your screen…"

    brand_bbox = draw.textbbox((0, 0), brand_text, font=brand_font)
    sub_bbox = draw.textbbox((0, 0), sub_text, font=sub_font)
    brand_w = brand_bbox[2] - brand_bbox[0]
    sub_w = sub_bbox[2] - sub_bbox[0]

    gap = int(height * 0.03)
    brand_h = brand_bbox[3] - brand_bbox[1]
    sub_h = sub_bbox[3] - sub_bbox[1]
    total_h = brand_h + gap + sub_h
    top = (height - total_h) // 2

    draw.text(((width - brand_w) // 2, top), brand_text, font=brand_font, fill=BRAND_COLOR)
    draw.text(((width - sub_w) // 2, top + brand_h + gap), sub_text, font=sub_font, fill=SUB_COLOR)

    img.save(out_path)
    print(f"Wrote {out_path} ({width}x{height})")


if __name__ == "__main__":
    main()
