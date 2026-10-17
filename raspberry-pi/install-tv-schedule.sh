#!/bin/bash
# TV wake/sleep schedule round (HDMI-CEC, migration 0114) - one-shot
# installer, same shape as install-wifi-setup.sh (SCRIPT_DIR sibling-file
# copying, --serial/--dry-run, safe to re-run, plain `sudo` for
# root-level operations rather than a whole-script sudo). Installed as a
# root SYSTEM unit (not a --user unit like kiosk.service/kiosk-watchdog.
# service) since cec-ctl needs /dev/cec0, which this script has no way to
# confirm is reachable from the admin user's own session without testing
# on real hardware first - a root unit keeps the TV schedule working
# independently of whether the kiosk's own Wayland session is up at all.
#
# Never touches kiosk.service, kiosk-watchdog.service, comitup,
# wifi-reconnect-watcher, the nightly reboot, WiFi, or tenant-config.txt
# - same guarantee setup-remote-access.sh/install-wifi-setup.sh already
# give for themselves.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERIAL=""
DRY_RUN=false

usage() {
  echo "Usage: $0 --serial AA0003 [--dry-run]"
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --serial) SERIAL="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) usage ;;
  esac
done

[ -n "$SERIAL" ] || usage

run() {
  if $DRY_RUN; then
    echo "[dry-run] $*"
  else
    "$@"
  fi
}

echo "Installing TV schedule check for serial $SERIAL"
echo

# Hidden input (read -s) - the fleet key must never appear in shell
# history, a log, or on screen. Set via `wrangler pages secret put
# PI_FLEET_KEY` on the admin's own machine, then pasted here once per
# box - never generated or stored by this script itself.
if ! $DRY_RUN; then
  read -rsp "Paste the PI_FLEET_KEY value (hidden): " FLEET_KEY
  echo
  [ -n "$FLEET_KEY" ] || { echo "No key entered - aborting." >&2; exit 1; }
else
  FLEET_KEY="(dry-run - not prompted)"
fi

echo "1. Config file (root-only, chmod 600)"
if $DRY_RUN; then
  echo "[dry-run] would write SERIAL=$SERIAL + PI_FLEET_KEY=(hidden) to /etc/airfieldcentral/tv-schedule.conf, chmod 600, owned root:root"
else
  sudo mkdir -p /etc/airfieldcentral
  sudo tee /etc/airfieldcentral/tv-schedule.conf >/dev/null <<EOF
SERIAL=$SERIAL
PI_FLEET_KEY=$FLEET_KEY
EOF
  sudo chmod 600 /etc/airfieldcentral/tv-schedule.conf
  sudo chown root:root /etc/airfieldcentral/tv-schedule.conf
fi
unset FLEET_KEY

echo "2. Script"
run sudo install -m 755 -o root -g root "$SCRIPT_DIR/tv-schedule-check.py" /usr/local/bin/tv-schedule-check.py

echo "3. Systemd units"
run sudo install -m 644 -o root -g root "$SCRIPT_DIR/tv-schedule-check.service" /etc/systemd/system/tv-schedule-check.service
run sudo install -m 644 -o root -g root "$SCRIPT_DIR/tv-schedule-check.timer" /etc/systemd/system/tv-schedule-check.timer
run sudo systemctl daemon-reload
run sudo systemctl enable --now tv-schedule-check.timer

echo
echo "Done. Check it's running with:"
echo "  systemctl list-timers tv-schedule-check.timer"
echo "  sudo journalctl -u tv-schedule-check.service -n 20 --no-pager"
