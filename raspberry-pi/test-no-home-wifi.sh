#!/bin/bash
# test-no-home-wifi.sh start|stop
#
# Makes the Pi genuinely lose its saved home WiFi connection, for
# testing the first-time-setup QR flow, WITHOUT ever touching that
# connection's SSID, password or name (2026-10-16 safety rule, after
# an earlier version of this project's testing touched those fields).
#
# HOW: blocks the connection by BSSID (the specific access point's own
# hardware address) instead - pointed at a nonexistent address,
# NetworkManager can't find a matching AP to join, a genuine connection
# failure, while the connection's own identity (SSID/password/name)
# stays completely untouched throughout. Confirmed earlier that
# autoconnect=no does NOT work against comitup for this purpose -
# comitup activates every saved profile directly, bypassing that flag
# entirely (see wifi-reconnect-watcher.py's own comment for the full
# story) - and comitup never broadcasts its hotspot at all while home
# WiFi is genuinely reachable, so a real block, not just a flag, is
# needed to see the hotspot activate at all.
#
# CONNECTION NAME IS AUTO-DETECTED, NOT HARDCODED (2026-10-18, after a
# real test on AA0003 silently blocked nothing): the saved profile's own
# name differs between boxes - some boxes get a plain SSID name, others
# (e.g. AA0003, provisioned via Raspberry Pi Imager/netplan) get
# "netplan-wlan0-<SSID>" instead. `start` reads whatever NetworkManager
# currently has active on wlan0 and saves that exact name to a state
# file so `stop` operates on the SAME profile, even if the active
# connection's name has since changed (see the comitup note below for
# why it can).
#
# SAFETY NET: `start` always installs a 10-minute timer that
# automatically clears the BSSID block on its own if `stop` is never
# called - the Pi must never be left unreachable because a test didn't
# finish cleanly. Always run `stop` as soon as a test is done; don't
# rely on the safety net as the normal way to end a test.
#
# Usage:
#   ./test-no-home-wifi.sh start   # block home WiFi, arm the 10-min safety net
#   ./test-no-home-wifi.sh stop    # restore home WiFi, cancel the safety net
#
# Run this ON the Pi itself (over SSH).

set -uo pipefail

ACTION="${1:?Usage: $0 start|stop}"
STATE_FILE="/run/airfieldcentral-test-no-home-wifi-conn-name"
UNIT_NAME="airfieldcentral-wifi-safety-restore"
SERVICE_FILE="/etc/systemd/system/${UNIT_NAME}.service"
TIMER_FILE="/etc/systemd/system/${UNIT_NAME}.timer"
BOGUS_BSSID="00:11:22:33:44:55"

# The currently-active connection on wlan0 - same terse-nmcli-parsing
# convention wifi-reconnect-watcher.py's own code already uses elsewhere
# in this project (colon-separated fields; connection names in practice
# here never contain a literal colon, so no escaping is handled).
detect_conn_name() {
  nmcli -t -f NAME,DEVICE,TYPE connection show --active 2>/dev/null \
    | awk -F: '$2=="wlan0" && $3=="802-11-wireless" {print $1; exit}'
}

case "$ACTION" in
  start)
    CONN_NAME="$(detect_conn_name)"
    if [ -z "$CONN_NAME" ]; then
      echo "Could not detect an active wlan0 WiFi connection - is the Pi actually on home WiFi right now?" >&2
      exit 1
    fi
    echo "Detected active WiFi connection: ${CONN_NAME}"
    echo "$CONN_NAME" | sudo tee "$STATE_FILE" >/dev/null

    echo "Installing 10-minute safety-restore timer..."
    sudo tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=Safety net: restore home WiFi if a test is not cleanly finished within 10 minutes

[Service]
Type=oneshot
ExecStart=/bin/bash -c '/usr/bin/nmcli connection modify "\$(cat ${STATE_FILE} 2>/dev/null || echo ${CONN_NAME})" 802-11-wireless.bssid "" || true'
ExecStartPost=/usr/bin/systemctl disable ${UNIT_NAME}.timer
EOF
    sudo tee "$TIMER_FILE" >/dev/null <<EOF
[Unit]
Description=Fires ${UNIT_NAME}.service 10 minutes after being armed (safety net)

[Timer]
OnActiveSec=600s
AccuracySec=1s

[Install]
WantedBy=timers.target
EOF
    sudo systemctl daemon-reload
    sudo systemctl enable --now "${UNIT_NAME}.timer"
    echo "Safety timer armed - will auto-restore home WiFi in 10 minutes unless cancelled with: $0 stop"

    echo "Blocking ${CONN_NAME} by BSSID (SSID/password/name untouched)..."
    # Fails LOUDLY here, deliberately (unlike every fallible command in
    # the stop branch below) - a test that believes WiFi is blocked
    # when it silently isn't is the one outcome this script must never
    # produce.
    if ! sudo nmcli connection modify "$CONN_NAME" 802-11-wireless.bssid "$BOGUS_BSSID"; then
      echo "Failed to apply the BSSID block to ${CONN_NAME} - WiFi is NOT blocked. Aborting." >&2
      exit 1
    fi
    sudo nmcli connection down "$CONN_NAME" 2>/dev/null || true
    echo "Home WiFi blocked. The Pi should fall back to its own hotspot shortly."
    ;;
  stop)
    # Prefer the name saved by `start` (the profile that was actually
    # blocked) over re-detecting now - by the time `stop` runs, the
    # active connection may no longer be that one at all: using the
    # setup page's own captive portal during a test makes comitup
    # replace the original saved profile with a NEW one of its own
    # (e.g. a bare "TP-Link_5C6E" alongside the original "netplan-
    # wlan0-TP-Link_5C6E"), and "clear the BSSID block" has to target
    # the ORIGINAL profile regardless of whichever one is active right
    # now.
    if [ -f "$STATE_FILE" ]; then
      CONN_NAME="$(cat "$STATE_FILE")"
    else
      CONN_NAME="$(detect_conn_name)"
      echo "No saved connection name from 'start' found - falling back to whatever's active now: ${CONN_NAME:-(none detected)}" >&2
    fi

    if [ -n "$CONN_NAME" ]; then
      echo "Clearing BSSID block on ${CONN_NAME} (SSID/password/name untouched)..."
      # Must NOT abort the rest of this script - comitup can have
      # already replaced/removed this exact profile during the test
      # (see the comment above), in which case nmcli reports "unknown
      # connection" here. That's an expected, survivable outcome, not a
      # reason to skip cancelling the safety timer below.
      if ! sudo nmcli connection modify "$CONN_NAME" 802-11-wireless.bssid "" 2>&1; then
        echo "Could not clear the BSSID block on ${CONN_NAME} (likely replaced by comitup during the test, or already restored) - continuing to cancel the safety timer regardless." >&2
      fi
    else
      echo "No connection name to restore (none saved, none currently active) - continuing to cancel the safety timer regardless." >&2
    fi

    echo "Cancelling safety timer..."
    sudo systemctl disable --now "${UNIT_NAME}.timer" 2>/dev/null || true
    sudo rm -f "$SERVICE_FILE" "$TIMER_FILE" "$STATE_FILE"
    sudo systemctl daemon-reload
    echo "Safety timer cancelled and removed."
    ;;
  *)
    echo "Usage: $0 start|stop" >&2
    exit 1
    ;;
esac
