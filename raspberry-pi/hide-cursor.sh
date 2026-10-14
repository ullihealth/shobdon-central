#!/bin/bash
# Run this ONCE over SSH on any kiosk Pi to permanently hide the mouse
# pointer on the kiosk display. OS/compositor-level only - never touches
# the AirfieldCentral web app, so office/pilot users on normal browsers
# keep their cursor as normal.
#
# Why this approach (2026-10-14): labwc 0.9.8 (the compositor this kiosk
# runs under, Wayland - confirmed via `labwc --version` and a full search
# of `man labwc-config`) has no native "hide the cursor" option. The only
# supported cursor-related knobs are the XCURSOR_* environment variables.
# `unclutter` (already installed, already referenced in
# ~/.config/labwc/autostart) does NOT work here - it's X11-only and this
# is a Wayland session, exactly as you'd expect.
#
# So: build a fully-transparent Xcursor theme named "invisible" (every
# standard cursor shape name compiled from one 32x32 all-alpha-zero PNG,
# via xcursorgen) and set it as XCURSOR_THEME in labwc's own user
# environment file. Confirmed for real on the Meg's Cafe Pi
# (192.168.1.119) that this reaches the systemd --user manager's own
# environment (`systemctl --user show-environment`), which is what
# kiosk.service's Chromium process inherits from since kiosk.service's own
# Environment= line only overrides XDG_RUNTIME_DIR/WAYLAND_DISPLAY, not
# XCURSOR_THEME/XCURSOR_SIZE - no change to kiosk.service was needed.
#
# What it does, in order:
#   1. Builds ~/.icons/invisible - a fully transparent Xcursor theme
#      covering every common cursor shape name, so no shape ever falls
#      through to a visible system theme. Needs `xcursorgen` (ships in
#      the `x11-apps` package, not installed on the kiosk image by
#      default) and Python3 + Pillow (already present on Raspberry Pi OS)
#      to build the theme - x11-apps is purged again afterwards so the
#      kiosk's installed-package footprint doesn't grow.
#   2. Backs up and appends XCURSOR_THEME=invisible / XCURSOR_SIZE=32 to
#      ~/.config/labwc/environment (labwc's own user environment file -
#      XCURSOR_SIZE must be set alongside XCURSOR_THEME or it has no
#      effect, per labwc's own docs).
#   3. Comments out the dead `unclutter -idle 0.5 -root &` line in
#      ~/.config/labwc/autostart (backed up first) - it's inert under
#      Wayland and left in place it wrongly suggests unclutter is what's
#      hiding the cursor.
#   4. Prints a reminder to reboot (`sudo reboot`) to apply it.
#
# Safe to re-run - every step is idempotent (checks what's already in
# place before changing anything).
#
# Usage:
#   ./hide-cursor.sh
#       Builds the theme and edits the config files, as above.
#
#   ./hide-cursor.sh --undo
#       Reverses it: restores ~/.config/labwc/environment and
#       ~/.config/labwc/autostart from their .bak-pre-cursor-fix backups
#       (if present) and removes ~/.icons/invisible. Reboot afterwards to
#       bring the cursor back.
#
# Run this ON the Pi itself (over SSH), same as personalize-tenant.sh -
# it is not meant to run on a Mac.

set -euo pipefail

UNDO=0
case "${1:-}" in
  --undo)
    UNDO=1
    ;;
  -h|--help)
    grep '^#' "$0" | sed '1d;s/^# \{0,1\}//'
    exit 0
    ;;
  "")
    ;;
  *)
    echo "Unknown argument: $1" >&2
    echo "Run with --help for usage." >&2
    exit 1
    ;;
esac

LABWC_DIR="$HOME/.config/labwc"
ENV_FILE="$LABWC_DIR/environment"
ENV_BACKUP="$LABWC_DIR/environment.bak-pre-cursor-fix"
AUTOSTART_FILE="$LABWC_DIR/autostart"
AUTOSTART_BACKUP="$LABWC_DIR/autostart.bak-pre-cursor-fix"
THEME_DIR="$HOME/.icons/invisible"
BUILD_DIR="/tmp/invisible-cursor-build"

if [ "$UNDO" -eq 1 ]; then
  if [ -f "$ENV_BACKUP" ]; then
    cp "$ENV_BACKUP" "$ENV_FILE"
    echo "Restored $ENV_FILE from backup"
  else
    echo "No $ENV_BACKUP found - leaving $ENV_FILE as-is" >&2
  fi

  if [ -f "$AUTOSTART_BACKUP" ]; then
    cp "$AUTOSTART_BACKUP" "$AUTOSTART_FILE"
    echo "Restored $AUTOSTART_FILE from backup"
  else
    echo "No $AUTOSTART_BACKUP found - leaving $AUTOSTART_FILE as-is" >&2
  fi

  if [ -d "$THEME_DIR" ]; then
    rm -rf "$THEME_DIR"
    echo "Removed $THEME_DIR"
  fi

  echo "Undo complete. Reboot (sudo reboot) to bring the cursor back."
  exit 0
fi

# --- 1. Build the invisible Xcursor theme -------------------------------

if [ -f "$THEME_DIR/cursors/default" ]; then
  echo "$THEME_DIR already built - skipping theme build."
else
  INSTALLED_X11_APPS=0
  if ! command -v xcursorgen >/dev/null 2>&1; then
    echo "xcursorgen not found - installing x11-apps (purged again after the build)..."
    sudo apt-get install -y --no-install-recommends x11-apps
    INSTALLED_X11_APPS=1
  fi

  mkdir -p "$BUILD_DIR"
  python3 - "$BUILD_DIR" "$THEME_DIR" <<'PYEOF'
import os
import subprocess
import sys
from PIL import Image

build_dir, theme_dir = sys.argv[1], sys.argv[2]
cursors_dir = os.path.join(theme_dir, "cursors")

png_path = os.path.join(build_dir, "transparent.png")
Image.new("RGBA", (32, 32), (0, 0, 0, 0)).save(png_path)

cfg_path = os.path.join(build_dir, "transparent.cursorgen")
with open(cfg_path, "w") as f:
    f.write(f"32 0 0 {png_path}\n")

os.makedirs(cursors_dir, exist_ok=True)
compiled_path = os.path.join(cursors_dir, "default")
subprocess.run(["xcursorgen", cfg_path, compiled_path], check=True)

# Every standard X/Xcursor/CSS cursor shape name a compositor or web page
# might request - all symlinked to the one compiled transparent cursor,
# so no shape is ever left uncovered (which would fall back to a visible
# system theme for just that one shape).
SHAPE_NAMES = [
    "text", "pointer", "left_ptr", "hand", "hand1", "hand2", "grab",
    "grabbing", "move", "crosshair", "wait", "watch", "progress", "help",
    "context-menu", "cell", "vertical-text", "alias", "copy", "no-drop",
    "not-allowed", "all-scroll", "col-resize", "row-resize", "n-resize",
    "s-resize", "e-resize", "w-resize", "ne-resize", "nw-resize",
    "se-resize", "sw-resize", "ew-resize", "ns-resize", "nesw-resize",
    "nwse-resize", "zoom-in", "zoom-out", "top_left_corner",
    "top_right_corner", "bottom_left_corner", "bottom_right_corner",
    "left_side", "right_side", "top_side", "bottom_side", "fleur",
    "X_cursor", "xterm", "ibeam", "question_arrow", "sb_h_double_arrow",
    "sb_v_double_arrow", "size_all", "plus", "circle", "dnd-none",
    "dnd-move", "dnd-copy", "dnd-link",
]
for name in SHAPE_NAMES:
    link_path = os.path.join(cursors_dir, name)
    if os.path.lexists(link_path):
        os.remove(link_path)
    os.symlink("default", link_path)

with open(os.path.join(theme_dir, "index.theme"), "w") as f:
    f.write("[Icon Theme]\nName=invisible\nComment=Fully transparent cursor theme for kiosk displays\n")

print(f"Built {theme_dir} with {len(SHAPE_NAMES) + 1} cursor names.")
PYEOF

  if [ "$INSTALLED_X11_APPS" -eq 1 ]; then
    sudo apt-get purge -y x11-apps
    sudo apt-get autoremove -y
    echo "Purged x11-apps again - only needed it to build the theme above."
  fi
fi

# --- 2. Set XCURSOR_THEME in labwc's user environment file -------------

mkdir -p "$LABWC_DIR"
touch "$ENV_FILE"

if grep -q '^XCURSOR_THEME=invisible$' "$ENV_FILE" 2>/dev/null; then
  echo "$ENV_FILE already sets XCURSOR_THEME=invisible - skipping."
else
  if [ ! -f "$ENV_BACKUP" ]; then
    cp "$ENV_FILE" "$ENV_BACKUP"
    echo "Backed up $ENV_FILE to $ENV_BACKUP"
  fi
  {
    echo ""
    echo "# Invisible-cursor fix (hide-cursor.sh) - fully transparent"
    echo "# Xcursor theme. XCURSOR_SIZE must be set alongside XCURSOR_THEME -"
    echo "# labwc's own docs note XCURSOR_THEME has no effect without it."
    echo "XCURSOR_THEME=invisible"
    echo "XCURSOR_SIZE=32"
  } >> "$ENV_FILE"
  echo "Appended XCURSOR_THEME=invisible to $ENV_FILE"
fi

# --- 3. Disable the dead X11-only unclutter autostart line --------------

if [ -f "$AUTOSTART_FILE" ] && grep -q '^unclutter ' "$AUTOSTART_FILE"; then
  if [ ! -f "$AUTOSTART_BACKUP" ]; then
    cp "$AUTOSTART_FILE" "$AUTOSTART_BACKUP"
    echo "Backed up $AUTOSTART_FILE to $AUTOSTART_BACKUP"
  fi
  sed -i \
    's/^unclutter .*/# &  (disabled by hide-cursor.sh - X11-only, inert under Wayland; see raspberry-pi\/hide-cursor.sh)/' \
    "$AUTOSTART_FILE"
  echo "Disabled the unclutter line in $AUTOSTART_FILE"
else
  echo "No active unclutter line in $AUTOSTART_FILE - nothing to disable."
fi

echo ""
echo "Done. Reboot (sudo reboot) for the invisible cursor to take effect."
