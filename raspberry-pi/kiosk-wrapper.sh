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
#
# Defined up here, not just before its first use lower down, because
# the confirmation-hold block further down (see its own comment) also
# needs to launch Chromium, before DASHBOARD_URL is even decided.
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

# WiFi setup round (2026-10-16) - comitup-callback.sh (see that file's
# own comment) writes the Pi's current network state to this one shared
# file on every comitup state transition, and restarts kiosk.service on
# an actual connected/not-connected change - which is what gets THIS
# script re-run with the now-current value. HOTSPOT and CONNECTING both
# mean "not connected yet" here (same coarse bucket comitup-callback.sh
# itself uses to decide whether to restart at all) - the brief
# HOTSPOT->CONNECTING distinction only matters to wifi-setup-server.py's
# own status-line poll, not to which URL Chromium gets handed. Missing
# state file (comitup not installed on this box, or a box that's never
# gone through a WiFi transition since boot) reads as CONNECTED - the
# existing, unmodified behaviour for every box that doesn't have this
# feature installed at all.
NETWORK_STATE_FILE="/run/airfieldcentral-network-state"
NETWORK_STATE="CONNECTED"
if [ -f "$NETWORK_STATE_FILE" ]; then
  NETWORK_STATE="$(cat "$NETWORK_STATE_FILE" 2>/dev/null || echo "CONNECTED")"
fi
SETUP_SERVER_URL="http://127.0.0.1:8089/"
SETUP_CONNECTING_FALLBACK="file:///home/admin/.config/wifi-setup-page/connecting.html"

# Confirmation-hold round (2026-10-16): real-hardware testing showed
# the "Thanks - connecting to your WiFi" confirmation page flashing for
# under a second before the dashboard appeared, THREE times, despite
# two earlier attempts to delay it elsewhere (once in comitup-
# callback.sh with a flat hold after CONNECTED, once with the hold
# measured from when CONNECTING first started) - both put the delay in
# comitup-callback.sh, which only owns WHEN kiosk.service gets told to
# restart, not what actually gets shown once it does. Nothing stops
# some OTHER trigger (kiosk-watchdog.py, a retry, anything) from
# restarting kiosk.service independently during that window, racing
# past the hold entirely - which is almost certainly what kept
# happening. Moved here instead: this script is the one place EVERY
# kiosk.service start funnels through, no matter who or what triggered
# it, so enforcing the hold here - actually showing the confirmation
# page for the remaining time before ever considering DASHBOARD_URL -
# cannot be bypassed by a restart racing in from elsewhere. Comitup-
# callback.sh still stamps CONNECTING_STARTED_FILE the moment
# CONNECTING first begins (see that file's own comment) - this just
# reads it instead of using it to compute someone else's delay.
#
# OUTAGE ROUND (2026-10-16): the first version of this block left the
# TV on the bare desktop with no browser at all - worse than the
# original problem. Root cause: it ended with `rm -f
# "$CONNECTING_STARTED_FILE"` to consume the stamp once used, but that
# file is created by comitup-callback.sh running as ROOT (comitup's own
# user - see that file's own comment), while this script runs as the
# admin user - admin cannot delete a root-owned file in /run, `rm`
# failed with Permission Denied, and under this script's own `set -e`
# that failure exited the ENTIRE script immediately, before it ever
# reached the real launch logic below. Confirmed directly: `bash -x`
# on this script reproduced the exact "Permission denied" and the
# script dying right there.
#
# Fixed two ways, not just the one bug: (1) dropped the rm entirely -
# it was never actually necessary for correctness, only tidiness; a
# stale timestamp just makes `remaining` compute as zero or negative
# below, which already skips the hold - comitup-callback.sh's own
# cleanup on the next HOTSPOT entry is enough. (2) the whole block now
# runs with `set +e` restored to `set -e` only once it's fully done, so
# ANY future failure in here - this one or one not yet discovered -
# can never again prevent the real launch logic after it from running.
# This directly satisfies the one rule that actually matters here: the
# kiosk must always relaunch, no matter what this block does.
CONNECTING_STARTED_FILE="/run/airfieldcentral-connecting-started"
MIN_VISIBLE_SECONDS=10

if [ "$NETWORK_STATE" = "CONNECTED" ] && [ -f "$CONNECTING_STARTED_FILE" ]; then
  set +e
  started="$(cat "$CONNECTING_STARTED_FILE" 2>/dev/null)"
  case "$started" in
    ''|*[!0-9]*) started=0 ;;
  esac
  elapsed=$(( $(date +%s) - started ))
  remaining=$(( MIN_VISIBLE_SECONDS - elapsed ))
  if [ "$remaining" -gt 0 ] 2>/dev/null; then
    echo "kiosk-wrapper: holding on the setup page's confirmation screen for ${remaining}s before the dashboard" >&2
    "$CHROMIUM_BIN" "${CHROMIUM_FLAGS[@]}" "$SETUP_SERVER_URL" &
    HOLD_PID=$!
    sleep "$remaining"
    kill -9 "$HOLD_PID" 2>/dev/null
    wait "$HOLD_PID" 2>/dev/null
  fi
  set -e
fi

if [ "$NETWORK_STATE" = "CONNECTED" ]; then
  EFFECTIVE_URL="$DASHBOARD_URL"
else
  # Blank-screen round (2026-10-16): a real incident showed the TV stuck
  # on a bare blank/white screen during a setup-mode boot - root cause
  # was kiosk-watchdog.py skipping its render check entirely while not
  # CONNECTED (fixed separately, see that file's own comment), but belt-
  # and-braces here too: wifi-setup-server.py is a separate --user unit
  # with no explicit startup ordering against this one, so briefly wait
  # for it to actually answer before pointing Chromium at it, same
  # "poll for the actual precondition" idiom as the DASHBOARD_URL wait
  # below - just much shorter, since this is loopback-only and normally
  # answers in milliseconds. If it still isn't up by SETUP_SERVER_WAIT_
  # TIMEOUT_SECONDS, fall back to a static file:// page (connecting.html)
  # that needs no server, no network, nothing - it can never fail to
  # load, so Chromium always has SOMETHING to paint rather than a
  # connection-refused error page while the real setup page catches up.
  SETUP_SERVER_WAIT_TIMEOUT_SECONDS=5
  setup_wait_start=$(date +%s)
  until curl --silent --output /dev/null --max-time 2 "$SETUP_SERVER_URL"; do
    elapsed=$(( $(date +%s) - setup_wait_start ))
    if [ "$elapsed" -ge "$SETUP_SERVER_WAIT_TIMEOUT_SECONDS" ]; then
      break
    fi
    sleep 1
  done
  if curl --silent --output /dev/null --max-time 2 "$SETUP_SERVER_URL"; then
    EFFECTIVE_URL="$SETUP_SERVER_URL"
  else
    EFFECTIVE_URL="$SETUP_CONNECTING_FALLBACK"
    echo "kiosk-wrapper: local WiFi setup server not responding after ${SETUP_SERVER_WAIT_TIMEOUT_SECONDS}s - showing the static connecting.html fallback instead" >&2
  fi
  echo "kiosk-wrapper: network state is $NETWORK_STATE - showing $EFFECTIVE_URL instead of $DASHBOARD_URL" >&2
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
#
# WiFi setup round - this specific 30s wait only applies when actually
# about to show the real dashboard (the setup page/fallback has its own
# much shorter wait above, resolved by this point) - waiting up to 30s
# for DASHBOARD_URL first would just be dead time in front of a visitor
# staring at a blank screen during the one moment (no known WiFi at all)
# the setup page exists to help with.
if [ "$EFFECTIVE_URL" = "$DASHBOARD_URL" ]; then
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
fi

"$CHROMIUM_BIN" "${CHROMIUM_FLAGS[@]}" "$EFFECTIVE_URL" &
FIRST_LAUNCH_PID=$!
sleep 15
kill -9 "$FIRST_LAUNCH_PID" 2>/dev/null || true
wait "$FIRST_LAUNCH_PID" 2>/dev/null || true

# exec, not another backgrounded launch + wait - replaces this wrapper
# process with Chromium itself, so systemd tracks Chromium's own PID
# directly as the service's main process from here on.
exec "$CHROMIUM_BIN" "${CHROMIUM_FLAGS[@]}" "$EFFECTIVE_URL"
