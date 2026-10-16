#!/bin/bash
# Run this ONCE over SSH on a kiosk Pi, from the same directory as the
# rest of this repo's raspberry-pi/ files (it copies several of them
# into place), to add the WiFi setup hotspot feature: comitup (a
# maintained NetworkManager-based WiFi onboarding tool, chosen over
# hand-rolled hostapd/dnsmasq - see this round's own investigation
# report), a local TV-facing setup page with a QR code, and the minimal
# kiosk-wrapper.sh/kiosk-watchdog.py changes that make the kiosk show
# that page instead of the real dashboard while there's no known WiFi.
#
# What it does, in order:
#   1. Generates a random, unique hotspot password for THIS box (8+
#      characters, no ambiguous 0/O/1/l/I) - stored at
#      /etc/airfieldcentral-hotspot-password, root-only-readable, NEVER
#      written to this repo or the app's own database. Printed once at
#      the end so you can copy it onto a sticker.
#   2. Generates the WiFi-join QR code (qrencode) and the templated TV
#      setup page (wifi-setup-page/index.html's own __SSID__/__PASSWORD__
#      placeholders, filled in once here, not at serve time).
#   3. Installs comitup (apt, Debian's own repo - no third-party source
#      needed, confirmed) and writes /etc/comitup.conf: ap_name (this
#      box's own AirfieldCentral-Setup-<serial> hotspot name),
#      ap_password, and external_callback pointing at comitup-callback.sh
#      (installed to /usr/local/bin) - see that script's own comment for
#      what it does on every comitup state change.
#   4. Installs wifi-setup-server.py/.service (the tiny local web server
#      serving the TV setup page) as a new systemd --user unit, alongside
#      kiosk.service/kiosk-watchdog.service - independent of both, same
#      "a restart of one must never take the others down" reasoning
#      kiosk-watchdog.service's own comment already established.
#   5. Copies the UPDATED kiosk-wrapper.sh and kiosk-watchdog.py (the
#      minimal changes - see each file's own comment) into place and
#      restarts kiosk.service/kiosk-watchdog.service so they pick up the
#      change immediately, without needing a reboot right now (comitup's
#      own new hotspot config still needs one - see step 6).
#   6. Enables comitup.service. A reboot is needed for comitup's own
#      config to take full effect (same as any config.txt-style change
#      on this Pi) - this script does NOT reboot automatically; you
#      choose when.
#
# Safe to re-run - re-running regenerates a NEW password (the old one
# stops working) and re-copies every file; nothing here accumulates
# state across runs. Does NOT touch tenant-config.txt, the hostname, or
# anything personalize-tenant.sh itself is responsible for.
#
# Usage:
#   ./install-wifi-setup.sh --serial AA0001
#       Hotspot name becomes AirfieldCentral-Setup-AA0001.
#
#   ./install-wifi-setup.sh --serial AA0001 --dry-run
#       Shows what would happen without installing/writing/restarting
#       anything.
#
# Run this ON the Pi itself (over SSH), same as every other script here.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERIAL=""
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --serial)
      SERIAL="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      grep '^#' "$0" | sed '1d;s/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [ -z "$SERIAL" ]; then
  echo "Usage: $0 --serial AA0001 [--dry-run]" >&2
  exit 1
fi

AP_NAME="AirfieldCentral-Setup-${SERIAL}"
PASSWORD_FILE="/etc/airfieldcentral-hotspot-password"
WEB_ROOT="/home/admin/.config/wifi-setup-page"
SYSTEMD_USER_DIR="/home/admin/.config/systemd/user"

# --- Generate the per-box password --------------------------------------

# 10 chars from a charset with 0/O/1/l/I removed (the exact ambiguous set
# named in the go-ahead) - plenty of entropy for an 8-63-char WPA-PSK
# password while staying realistically easy to read off a sticker and
# type on a phone keyboard.
CHARSET="ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
generate_password() {
  # pipefail toggled off here deliberately: head closing the pipe after
  # its 10 bytes sends tr a SIGPIPE (exit 141) even though this is the
  # expected, successful case - under pipefail that would otherwise
  # propagate as a real failure and kill the whole script via set -e.
  set +o pipefail
  LC_ALL=C tr -dc "$CHARSET" < /dev/urandom | head -c 10
  set -o pipefail
}
PASSWORD="$(generate_password)"

echo "Generated hotspot name: $AP_NAME"
echo "(password generated - not shown until the end, same as every other step below)"

if [ "$DRY_RUN" -eq 1 ]; then
  echo ""
  echo "--- Would write $PASSWORD_FILE (root:root, 600) ---"
  echo "--- Would write $WEB_ROOT/index.html and $WEB_ROOT/wifi-qr.png ---"
  echo "--- Would write /etc/comitup.conf (ap_name=$AP_NAME, ap_password=<generated>, external_callback=/usr/local/bin/comitup-callback.sh) ---"
  echo "--- Would install/enable comitup, qrencode (apt) ---"
  echo "--- Would install $SYSTEMD_USER_DIR/wifi-setup-server.py + .service, enable + start it ---"
  echo "--- Would copy kiosk-wrapper.sh and kiosk-watchdog.py into $SYSTEMD_USER_DIR, restart kiosk.service + kiosk-watchdog.service ---"
  echo "--- Would copy /usr/local/bin/comitup-callback.sh (root:root, 755) ---"
  echo "--- Would enable comitup.service (needs a reboot to fully take effect - not run automatically) ---"
  echo "Dry run complete - nothing was actually changed."
  exit 0
fi

sudo install -m 600 -o root -g root /dev/null "$PASSWORD_FILE"
echo -n "$PASSWORD" | sudo tee "$PASSWORD_FILE" >/dev/null
echo "Wrote $PASSWORD_FILE (root-only readable)"

# --- apt installs ---------------------------------------------------------

sudo apt-get update
sudo apt-get install -y comitup qrencode

# --- QR code + templated TV setup page ------------------------------------

mkdir -p "$WEB_ROOT"
qrencode -o "$WEB_ROOT/wifi-qr.png" -s 10 "WIFI:T:WPA;S:${AP_NAME};P:${PASSWORD};;"
echo "Wrote $WEB_ROOT/wifi-qr.png"

sed -e "s/__SSID__/${AP_NAME}/g" -e "s/__PASSWORD__/${PASSWORD}/g" \
  "$SCRIPT_DIR/wifi-setup-page/index.html" > "$WEB_ROOT/index.html"
echo "Wrote $WEB_ROOT/index.html"

# --- comitup-callback.sh (runs as root, comitup's own user) --------------

sudo install -m 755 -o root -g root "$SCRIPT_DIR/comitup-callback.sh" /usr/local/bin/comitup-callback.sh
echo "Installed /usr/local/bin/comitup-callback.sh"

# --- /etc/comitup.conf -----------------------------------------------------

# Overwrites the file comitup's own postinst ships (all-commented-out
# defaults, confirmed by inspection before writing this) - safe, nothing
# in it was ever user-edited on a fresh install.
sudo tee /etc/comitup.conf >/dev/null <<EOF
# Written by install-wifi-setup.sh on $(date -u '+%Y-%m-%dT%H:%M:%SZ')
ap_name: ${AP_NAME}
ap_password: ${PASSWORD}
external_callback: /usr/local/bin/comitup-callback.sh
EOF
echo "Wrote /etc/comitup.conf"

# --- wifi-setup-server.py/.service (systemd --user, same pattern as
#     kiosk-watchdog.py/.service) -------------------------------------------

cp "$SCRIPT_DIR/wifi-setup-server.py" "$SYSTEMD_USER_DIR/wifi-setup-server.py"
chmod +x "$SYSTEMD_USER_DIR/wifi-setup-server.py"
cp "$SCRIPT_DIR/wifi-setup-server.service" "$SYSTEMD_USER_DIR/wifi-setup-server.service"
systemctl --user daemon-reload
systemctl --user enable --now wifi-setup-server.service
echo "Installed and started wifi-setup-server.service"

# --- Updated kiosk-wrapper.sh / kiosk-watchdog.py --------------------------

cp "$SCRIPT_DIR/kiosk-wrapper.sh" "$SYSTEMD_USER_DIR/kiosk-wrapper.sh"
chmod +x "$SYSTEMD_USER_DIR/kiosk-wrapper.sh"
cp "$SCRIPT_DIR/kiosk-watchdog.py" "$SYSTEMD_USER_DIR/kiosk-watchdog.py"
chmod +x "$SYSTEMD_USER_DIR/kiosk-watchdog.py"
systemctl --user restart kiosk.service
systemctl --user restart kiosk-watchdog.service
echo "Updated kiosk-wrapper.sh and kiosk-watchdog.py in place, restarted both services"

# --- comitup itself ---------------------------------------------------------

sudo systemctl enable comitup.service
echo ""
echo "comitup.service is enabled but needs a reboot for the new /etc/comitup.conf"
echo "to fully take effect (same as any first-time config change) - reboot when ready."
echo ""
echo "================================================================"
echo "Hotspot name:     $AP_NAME"
echo "Hotspot password: $PASSWORD"
echo "(stored at $PASSWORD_FILE, root-only readable - this is the only"
echo " place this script prints it; copy it now if you need it for a sticker)"
echo "================================================================"
