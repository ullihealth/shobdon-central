#!/bin/bash
# install-branding.sh [--dry-run]
#
# One-shot installer for the dark branded wallpaper + Chromium
# white-flash fix shown during a kiosk.service restart - see commit
# b90f9c9's own message for the full story (generate-wallpaper.py,
# set-dark-background.py). Gap found 2026-10-18: both were only ever
# applied BY HAND on AA0001, never captured in a script - every other
# box (Meg's live AA0002, Tiger's AA0003, and the master image itself)
# never got either fix. This closes that gap.
#
# Same shape as install-wifi-setup.sh: plain `sudo`/no-sudo per
# operation rather than a whole-script sudo, --dry-run support, safe to
# re-run (every step below overwrites, nothing accumulates). Never
# touches kiosk.service itself, kiosk-watchdog.service, comitup, WiFi,
# the nightly reboot, or tenant-config.txt.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DRY_RUN=false
[ "${1:-}" = "--dry-run" ] && DRY_RUN=true

SYSTEMD_USER_DIR="/home/admin/.config/systemd/user"
WALLPAPER_PATH="/home/admin/.config/airfieldcentral-wallpaper.png"
PCMANFM_DIR="/home/admin/.config/pcmanfm/default"

run() {
  if $DRY_RUN; then
    echo "[dry-run] $*"
  else
    "$@"
  fi
}

echo "1. set-dark-background.py (Chromium first-paint white-flash fix)"
run mkdir -p "$SYSTEMD_USER_DIR"
run install -m 755 "$SCRIPT_DIR/set-dark-background.py" "$SYSTEMD_USER_DIR/set-dark-background.py"

echo "2. Branded wallpaper image (1920x1080)"
run python3 "$SCRIPT_DIR/generate-wallpaper.py" "$WALLPAPER_PATH" 1920 1080

echo "3. pcmanfm desktop config"
run mkdir -p "$PCMANFM_DIR"
for n in 0 1; do
  SRC="/etc/xdg/pcmanfm/default/desktop-items-${n}.conf"
  DEST="$PCMANFM_DIR/desktop-items-${n}.conf"
  if [ ! -f "$SRC" ]; then
    echo "  (skip) ${SRC} does not exist on this box"
    continue
  fi
  if $DRY_RUN; then
    echo "[dry-run] would copy ${SRC} to ${DEST}, then set wallpaper=${WALLPAPER_PATH}, wallpaper_mode=fit, desktop_bg=#020617"
    continue
  fi
  cp "$SRC" "$DEST"
  # Set/override the three keys in place - add if missing, replace if
  # present. Assumes the stock file's usual single "[*]"-section, flat
  # key=value layout (confirmed on AA0001's own copy) - worth a glance
  # via --dry-run (or `cat` the result) on the first box this runs on,
  # in case a future Raspberry Pi OS release restructures this file.
  for kv in "wallpaper=${WALLPAPER_PATH}" "wallpaper_mode=fit" "desktop_bg=#020617"; do
    key="${kv%%=*}"
    if grep -q "^${key}=" "$DEST"; then
      sed -i "s|^${key}=.*|${kv}|" "$DEST"
    else
      echo "$kv" >> "$DEST"
    fi
  done
  echo "  wrote ${DEST}"
done

echo
if $DRY_RUN; then
  echo "Dry run only - nothing was changed. Re-run without --dry-run to apply."
else
  echo "Done. Restart kiosk.service (or reboot) to see it take effect:"
  echo "  systemctl --user restart kiosk.service"
fi
