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

# Confirmation round, attempt 3 (2026-10-16): the first two attempts
# both tried to hold the "connecting" message up DURING the hotspot-to-
# WiFi switch itself (once delaying comitup-callback.sh's own restart
# call, once delaying the launch here before deciding DASHBOARD_URL) -
# confirmed live, BOTH lost the race against the browser restart that
# switch itself requires: the restart wipes whatever's on screen no
# matter when it's told to happen, and the second attempt's own cleanup
# step then caused a real outage (see git history on this file for that
# one - a root-owned file this script, running as admin, couldn't
# delete, crashing the whole script under `set -e`).
#
# Different approach entirely now: show nothing special during the
# switch - just let the EXISTING logic below handle it exactly as it
# always has. Instead, detect a FRESH connected transition (compared
# against LAST_SEEN_STATE_FILE, which this script - and only this
# script, always as admin - reads and writes, so there is no cross-user
# file ownership to get wrong this time) and, if this restart is the
# first one since that transition, point Chromium at a local
# "Connected" confirmation page INSTEAD of DASHBOARD_URL for this one
# launch. That page holds itself up for 10 seconds with a plain client-
# side timer, then navigates itself to DASHBOARD_URL IN THE SAME
# browser window - a normal in-page navigation, not a process restart,
# so nothing can race it away this time. The double-launch launch logic
# right after this block is completely unchanged either way - it just
# launches whatever EFFECTIVE_URL ends up being.
#
# Every step below is wrapped so that if ANYTHING here goes wrong - the
# state file, the template, the write - EFFECTIVE_URL simply stays
# DASHBOARD_URL and the kiosk launches normally. The confirmation
# message is a nice-to-have; the dashboard loading is not optional.
LAST_SEEN_STATE_FILE="/home/admin/.cache/airfieldcentral-last-seen-network-state"
CONFIRMATION_TEMPLATE="/home/admin/.config/wifi-setup-page/connected-confirmation.html"
CONFIRMATION_PAGE="/home/admin/.cache/airfieldcentral-connected-confirmation.html"
CONFIRMATION_URL="file://${CONFIRMATION_PAGE}"

SHOW_CONFIRMATION=0
if [ "$NETWORK_STATE" = "CONNECTED" ]; then
  set +e
  mkdir -p "$(dirname "$LAST_SEEN_STATE_FILE")" 2>/dev/null
  LAST_SEEN_STATE="$(cat "$LAST_SEEN_STATE_FILE" 2>/dev/null)"
  if [ -n "$LAST_SEEN_STATE" ] && [ "$LAST_SEEN_STATE" != "CONNECTED" ]; then
    SHOW_CONFIRMATION=1
  fi
  set -e
fi
# Always records the state THIS run saw, regardless of whether a
# confirmation was shown - admin owns this file end to end, so this
# plain write can't hit the kind of cross-user permission failure the
# previous attempt did.
mkdir -p "$(dirname "$LAST_SEEN_STATE_FILE")" 2>/dev/null || true
echo "$NETWORK_STATE" > "$LAST_SEEN_STATE_FILE" 2>/dev/null || true

if [ "$NETWORK_STATE" = "CONNECTED" ]; then
  EFFECTIVE_URL="$DASHBOARD_URL"
  if [ "$SHOW_CONFIRMATION" -eq 1 ]; then
    set +e
    sed "s|__DASHBOARD_URL__|${DASHBOARD_URL}|g" "$CONFIRMATION_TEMPLATE" > "$CONFIRMATION_PAGE" 2>/dev/null
    template_ok=$?
    set -e
    if [ "$template_ok" -eq 0 ] && [ -s "$CONFIRMATION_PAGE" ]; then
      EFFECTIVE_URL="$CONFIRMATION_URL"
      echo "kiosk-wrapper: fresh connection - showing the Connected confirmation page first" >&2
    else
      echo "kiosk-wrapper: could not prepare the confirmation page - launching the dashboard directly" >&2
    fi
  fi
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

# White-flash round (2026-10-16): Chromium paints its own default
# (white) background before any page's own CSS has loaded - confirmed
# live, a brief white flash was visible on every launch. There's no
# public command-line flag for this; set-dark-background.py (see its
# own comment) applies it via Chrome DevTools Protocol instead, polling
# for a page target to appear. Launched here, backgrounded and
# disowned, deliberately BEFORE the launches below rather than after -
# `exec` further down replaces this script's own process entirely, so
# anything meant to outlive it has to already be an independent
# background process before that point, not started after it (nothing
# runs after exec). Purely cosmetic - never allowed to affect whether
# or what Chromium launches, which is why it's fire-and-forget with no
# status checked here at all.
nohup python3 /home/admin/.config/systemd/user/set-dark-background.py >/dev/null 2>&1 < /dev/null &
disown

"$CHROMIUM_BIN" "${CHROMIUM_FLAGS[@]}" "$EFFECTIVE_URL" &
FIRST_LAUNCH_PID=$!
sleep 15
kill -9 "$FIRST_LAUNCH_PID" 2>/dev/null || true
wait "$FIRST_LAUNCH_PID" 2>/dev/null || true

# exec, not another backgrounded launch + wait - replaces this wrapper
# process with Chromium itself, so systemd tracks Chromium's own PID
# directly as the service's main process from here on.
exec "$CHROMIUM_BIN" "${CHROMIUM_FLAGS[@]}" "$EFFECTIVE_URL"
