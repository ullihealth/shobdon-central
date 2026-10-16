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
#
# Hotspot-reliability round (2026-10-16): an earlier version of this
# script also re-applied compatibility settings (PMF/channel) to the
# hotspot connection here on every HOTSPOT entry, reactivating it to
# make them take live effect - that reactivation caused a genuine
# restart loop on real hardware (each reactivation produced a fresh
# NetworkManager state-change event, which re-triggered this exact
# callback again). Removed entirely - that fix now lives at
# /etc/NetworkManager/conf.d/99-airfieldcentral-hotspot-pmf.conf as a
# NetworkManager-level default instead, which comitup's hotspot profile
# picks up automatically on creation, with no callback, no
# reactivation, and no possibility of a loop. This file now does
# exactly what it did before that attempt: relay state, restart the
# kiosk on a real bucket change. Nothing else.
set -euo pipefail

STATE="${1:-}"
STATE_FILE=/run/airfieldcentral-network-state
PREV_BUCKET_FILE=/run/airfieldcentral-network-bucket
CONNECTING_STARTED_FILE=/run/airfieldcentral-connecting-started
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

# Confirmation-hold round (2026-10-16): this script used to compute and
# enforce the "show the confirmation message for at least 10s" hold
# itself, by delaying the restart call below. Confirmed on real
# hardware that this doesn't work: this script only controls WHEN
# kiosk.service is TOLD to restart, not what gets shown once it does -
# nothing stops some OTHER trigger (kiosk-watchdog.py, a retry
# attempt, anything) from restarting kiosk.service independently during
# that window, racing straight past the hold. The hold itself now lives
# in kiosk-wrapper.sh (see that file's own comment) - the one place
# every kiosk.service start funnels through regardless of who triggered
# it, so it can't be bypassed by a race. This script's only remaining
# job for the hold is stamping WHEN CONNECTING first began, so
# kiosk-wrapper.sh can measure elapsed time against it - restarts
# happen immediately again, same as before any of this.
case "$STATE" in
  CONNECTING)
    [ -f "$CONNECTING_STARTED_FILE" ] || date +%s > "$CONNECTING_STARTED_FILE"
    ;;
  HOTSPOT)
    rm -f "$CONNECTING_STARTED_FILE"
    ;;
esac

new_bucket="$(bucket "$STATE")"
old_bucket="$(cat "$PREV_BUCKET_FILE" 2>/dev/null || echo "")"

if [ "$new_bucket" != "$old_bucket" ]; then
  echo "$new_bucket" > "$PREV_BUCKET_FILE"
  # runuser, not sudo -u - this script already runs as root (comitup's
  # own user), and runuser is the more direct "root switches to another
  # user" tool, with no dependency on sudoers policy at all.
  runuser -u "$KIOSK_USER" -- env XDG_RUNTIME_DIR="/run/user/$KIOSK_UID" systemctl --user restart kiosk.service
fi
