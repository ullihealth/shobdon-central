#!/bin/bash
# comitup's own external_callback - see /etc/comitup.conf's own comment
# for the exact contract this script must honour: comitup calls it with
# exactly one argument - HOTSPOT, CONNECTING, or CONNECTED - on every
# state transition, "run with the permissions of the owning user" (i.e.
# whatever user comitup.service itself runs as - root, confirmed, since
# comitup needs root to manage NetworkManager/the hotspot). That's a
# DIFFERENT user than kiosk.service's own admin (uid 1000), so talking to
# that --user service needs an explicit XDG_RUNTIME_DIR below - the same
# requirement kiosk.service's own comment already documents, for the
# unrelated reason of Chromium needing to find the right Wayland session.
#
# Writes the raw state verbatim to STATE_FILE - this is the ONE shared
# signal every other piece of this feature reads: wifi-setup-server.py's
# own /state endpoint (for its lightweight status-line poll) and
# kiosk-watchdog.py's render-check suppression (see that file's own
# comment) both read this exact file, never comitup directly.
#
# Only restarts kiosk.service on an actual COARSE bucket change (not-
# connected -> connected, or the reverse) - HOTSPOT and CONNECTING both
# mean "not connected" as far as kiosk-wrapper.sh's own URL choice cares
# (it shows the local setup page for either), so the HOTSPOT->CONNECTING
# sub-transition deliberately does NOT restart anything - only
# wifi-setup-server.py's own poll needs to notice that one, to flip its
# "Connected - starting your screen" line without a disruptive relaunch.
# "Only act on a real state change, never spam" - same posture this
# round's sibling CEC investigation already settled on for a different
# piece of hardware.
set -euo pipefail

STATE="${1:-}"
STATE_FILE=/run/airfieldcentral-network-state
PREV_BUCKET_FILE=/run/airfieldcentral-network-bucket
KIOSK_USER=admin
KIOSK_UID=1000

if [ -z "$STATE" ]; then
  echo "comitup-callback: no state argument given" >&2
  exit 1
fi

bucket() {
  case "$1" in
    CONNECTED) echo "connected" ;;
    *) echo "not-connected" ;;
  esac
}

echo "$STATE" > "$STATE_FILE"

new_bucket="$(bucket "$STATE")"
old_bucket="$(cat "$PREV_BUCKET_FILE" 2>/dev/null || echo "")"

if [ "$new_bucket" != "$old_bucket" ]; then
  echo "$new_bucket" > "$PREV_BUCKET_FILE"
  # runuser, not sudo -u - this script already runs as root (comitup's
  # own user), and runuser is the more direct "root switches to another
  # user" tool, with no dependency on sudoers policy at all.
  runuser -u "$KIOSK_USER" -- env XDG_RUNTIME_DIR="/run/user/$KIOSK_UID" systemctl --user restart kiosk.service
fi
