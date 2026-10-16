#!/bin/bash
# Simulates "router/WiFi missing at boot" WITHOUT needing anyone to
# physically turn off the real router: makes the Pi's saved WiFi
# connection temporarily unreachable (does NOT delete it, does NOT
# touch its saved password), reboots, waits a set number of seconds,
# then restores it automatically - letting you watch the TV and the
# logs through a full disconnect/reconnect cycle on demand.
#
# HOW "disable" IS DONE: comitup activates every saved WiFi profile
# itself (see comitup/nm.py's get_candidate_connections - it lists ALL
# saved 802-11-wireless/infrastructure profiles, with no check of each
# profile's own "autoconnect" setting at all). Confirmed live on
# AA0001, 2026-10-16: setting autoconnect=no and bringing the
# connection down did NOT stop comitup reconnecting within seconds -
# comitup's own activation calls bypass that flag entirely, since
# autoconnect only governs NetworkManager's OWN background reconnect
# logic, not an explicit activation request from any client. So instead
# this temporarily points the connection's SSID at a name that doesn't
# exist (appending "-test-disabled"), which comitup will still list as
# a candidate and still try - and that attempt will then genuinely fail,
# the same as a real "network not in range" case, without ever touching
# the saved password.
#
# How the "wait, then restore" part survives the reboot: a plain
# `sleep N && nmcli ...` or `systemd-run --on-active=...` would NOT
# survive the reboot this script triggers (both only exist in the
# current boot's memory). Instead this installs two small, real unit
# files - a oneshot service that restores the real SSID, and a timer
# that fires it OnBootSec=<N> after whichever boot is currently
# running. The service disables its own timer as its last step, so this
# is strictly a one-off: run the script again for another cycle.
#
# Usage:
#   ./simulate-no-wifi-at-boot.sh <connection-name> [disabled-seconds]
#   e.g. ./simulate-no-wifi-at-boot.sh TP-Link_5C6E 240
#
# Run this ON the Pi itself (over SSH). Reboots the Pi immediately.

set -euo pipefail

CONN_NAME="${1:?Usage: $0 <connection-name> [disabled-seconds]}"
DISABLED_SECONDS="${2:-240}"

UNIT_NAME="simulate-wifi-reenable"
SERVICE_FILE="/etc/systemd/system/${UNIT_NAME}.service"
TIMER_FILE="/etc/systemd/system/${UNIT_NAME}.timer"

REAL_SSID="$(sudo nmcli -g 802-11-wireless.ssid connection show "$CONN_NAME")"
if [ -z "$REAL_SSID" ]; then
  echo "Could not read the current SSID for connection '$CONN_NAME' - aborting, nothing changed." >&2
  exit 1
fi
BOGUS_SSID="${REAL_SSID}-test-disabled"

echo "Installing one-shot restore timer (fires ${DISABLED_SECONDS}s after the next boot)..."

sudo tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=Restore real SSID disabled by simulate-no-wifi-at-boot.sh (one-off test helper)

[Service]
Type=oneshot
ExecStart=/usr/bin/nmcli connection modify "${CONN_NAME}" 802-11-wireless.ssid "${REAL_SSID}"
ExecStartPost=/usr/bin/systemctl disable ${UNIT_NAME}.timer
EOF

sudo tee "$TIMER_FILE" >/dev/null <<EOF
[Unit]
Description=Fires ${UNIT_NAME}.service ${DISABLED_SECONDS}s after boot (one-off test helper)

[Timer]
OnBootSec=${DISABLED_SECONDS}s
AccuracySec=1s

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now "${UNIT_NAME}.timer"

echo "Pointing ${CONN_NAME} at a nonexistent network name (password untouched) and bringing it down..."
sudo nmcli connection modify "$CONN_NAME" 802-11-wireless.ssid "$BOGUS_SSID"
sudo nmcli connection down "$CONN_NAME" || true

echo "Rebooting now. ${CONN_NAME}'s real network name will be restored automatically ${DISABLED_SECONDS}s after this boot."
sudo reboot
