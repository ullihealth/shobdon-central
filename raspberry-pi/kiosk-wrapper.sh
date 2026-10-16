#!/bin/bash
# Kiosk launch wrapper - installed at ~/.config/systemd/user/kiosk-wrapper.sh
# on the Pi, invoked by kiosk.service (see that file's own comment for why
# this runs as a systemd --user service rather than labwc autostart).
#
# Reads the tenant's dashboard URL from tenant-config.txt (see
# personalize-tenant.sh, which writes it) instead of a hardcoded URL, so
# one master SD card image works for every tenant - the only thing that
# differs between Meg's Cafe, Tiger Helicopters, etc. is this one file.
#
# THE DOUBLE-LAUNCH PATTERN BELOW IS LOAD-BEARING - DO NOT REMOVE.
# On a real (unattended) power-cycle boot, Chromium's first launch
# reliably stalls with a blank screen a few seconds in - confirmed
# repeatedly, and confirmed this NEVER happens on a manually-triggered
# SSH launch, only on genuine cold power-on. Root cause was never fully
# pinned down (suspected first-frame/GPU-context timing against labwc
# right after the Wayland socket appears). Launching once, waiting 15s,
# force-killing, and relaunching is the only fix found that reliably
# recovers from this - the second launch has never been observed to
# stall. If you're tempted to remove this because it "looks redundant":
# it isn't - it was arrived at through extensive live debugging on real
# hardware, re-test across several real power cycles (not SSH-triggered
# restarts of this script) before ever changing it.

set -euo pipefail

CONFIG_FILE="/home/admin/tenant-config.txt"
CHROMIUM_BIN="chromium"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "kiosk-wrapper: $CONFIG_FILE not found - this Pi hasn't been personalized yet." >&2
  echo "kiosk-wrapper: run ~/personalize-tenant.sh over SSH, then reboot." >&2
  exit 1
fi

# shellcheck source=/dev/null
source "$CONFIG_FILE"

if [ -z "${DASHBOARD_URL:-}" ]; then
  echo "kiosk-wrapper: DASHBOARD_URL is not set in $CONFIG_FILE" >&2
  exit 1
fi

# Boot-timing round (2026-08-29): kiosk.service's own ExecStartPre already
# waits for the Wayland SOCKET to exist, but nothing here previously
# waited for the NETWORK to actually be usable - on a real cold boot,
# WiFi/DNS coming up is independently variable timing, separate from
# labwc's own startup. If Chromium navigates to DASHBOARD_URL before that
# resolves, it lands on its own internal error page instead of the real
# dashboard - a genuinely different origin than DASHBOARD_URL, which is
# exactly what a real incident's logs showed (kiosk-watchdog.py's own
# origin-matching correctly reporting "no page target matches the kiosk's
# own origin" - not a bug in that logic, a true reflection of Chromium
# being on the wrong page because the network wasn't ready yet). A `curl`
# probe against the tenant's OWN real URL (not just "is there a network
# link", which can be up while DNS/internet still isn't) is the same
# "poll for the actual precondition, not a proxy for it" idiom
# kiosk.service's own Wayland-socket wait already uses.
#
# NETWORK_WAIT_TIMEOUT_SECONDS caps this - a Pi that's genuinely offline
# (WiFi misconfigured, router down) must still launch Chromium and let
# the existing double-launch/watchdog machinery take over, not hang here
# forever. --max-time bounds each individual attempt so one hung request
# can't itself consume the whole budget in one shot.
NETWORK_WAIT_TIMEOUT_SECONDS=30
network_wait_start=$(date +%s)
until curl --silent --output /dev/null --max-time 3 "$DASHBOARD_URL"; do
  elapsed=$(( $(date +%s) - network_wait_start ))
  if [ "$elapsed" -ge "$NETWORK_WAIT_TIMEOUT_SECONDS" ]; then
    echo "kiosk-wrapper: network not reachable after ${NETWORK_WAIT_TIMEOUT_SECONDS}s - launching anyway (double-launch/watchdog will retry)" >&2
    break
  fi
  sleep 1
done

# --disable-accelerated-video-decode is REQUIRED, not a tuning knob -
# hardware video decode causes video playback to freeze permanently a
# few seconds in on this Pi/Chromium combination (confirmed via CPU/GPU
# load testing); software decode fixed it completely, and the CPU
# headroom cost is a non-issue (~20% CPU, ~35-40C case temp under
# sustained playback - well within safe range for a Pi 4).
# --password-store=basic stops a GNOME Keyring password prompt from
# stealing focus and blanking the kiosk.
#
# Blank-render watchdog round - --remote-debugging-port=9222 exposes
# Chrome DevTools Protocol so kiosk-watchdog.py can ask the page "did you
# actually render" (via the KioskRenderMarker.tsx DOM marker) instead of
# only checking whether the Chromium process is alive, which can't see
# the diagnosed failure mode (process stable, CPU/GPU idle, blank white
# page that never recovers). --remote-allow-origins=* is required on
# current Chromium - without it, DevTools rejects the watchdog's own
# WebSocket connection outright, since Chromium now treats a bare
# 127.0.0.1 WebSocket client as an untrusted origin by default. NOT
# adding --remote-debugging-address - Chromium's default bind is loopback
# (127.0.0.1) only, and that's deliberate: DevTools grants full JS
# execution in this browser, so it must never be reachable from the LAN.
CHROMIUM_FLAGS=(
  --password-store=basic
  --kiosk
  --autoplay-policy=no-user-gesture-required
  --noerrdialogs
  --disable-infobars
  --disable-accelerated-video-decode
  --check-for-update-interval=31536000
  --remote-debugging-port=9222
  --remote-allow-origins=*
)

"$CHROMIUM_BIN" "${CHROMIUM_FLAGS[@]}" "$DASHBOARD_URL" &
FIRST_LAUNCH_PID=$!
sleep 15
kill -9 "$FIRST_LAUNCH_PID" 2>/dev/null || true
wait "$FIRST_LAUNCH_PID" 2>/dev/null || true

# exec, not another backgrounded launch + wait - replaces this wrapper
# process with Chromium itself, so systemd tracks Chromium's own PID
# directly as the service's main process from here on.
exec "$CHROMIUM_BIN" "${CHROMIUM_FLAGS[@]}" "$DASHBOARD_URL"
