#!/bin/bash
# Run this ONCE over SSH on any kiosk Pi to add remote support access:
# Raspberry Pi Connect (remote screen + shell in a browser) and Tailscale
# (private network so you/Claude Code can SSH in from anywhere). Neither
# of these touches the kiosk itself - kiosk-wrapper.sh, kiosk.service,
# kiosk-watchdog.service, tenant-config.txt, the nightly reboot, the
# cursor fix (hide-cursor.sh), and WiFi are all untouched by this script.
#
# What it does, in order:
#   1. Installs `rpi-connect` (the full package - NOT `rpi-connect-lite`,
#      which only supports remote shell, not screen sharing) via apt, if
#      not already installed. Raspberry Pi OS Bookworm/Trixie desktop
#      images often ship this pre-installed but not signed in, which is
#      the normal starting state - this script handles both "not
#      installed yet" and "installed, not signed in" the same way.
#   2. Enables user lingering for the current user (`loginctl
#      enable-linger`) if not already on - needed so rpi-connect's
#      systemd --user service (and kiosk.service, which already relies
#      on the same mechanism) keeps running even with no one logged in
#      at the console, e.g. after a power cycle with no physical login.
#   3. Installs Tailscale via its official install script
#      (https://tailscale.com/install.sh) if not already installed, and
#      enables `tailscaled` at boot.
#   4. For whichever of the two isn't signed in yet: starts the sign-in
#      flow in the background, prints the link to visit, and waits up to
#      2 minutes for you to complete it in a browser - checking every 5
#      seconds. If you don't make it in time, re-run this script once
#      you have; everything it already did is safe to repeat.
#   5. Once signed in, explicitly turns on Raspberry Pi Connect's screen
#      sharing and remote shell (`rpi-connect vnc on` / `shell on`) -
#      both are required separately; sign-in alone doesn't enable them.
#   6. Brings Tailscale up with `tailscale up --hostname=<hostname>`
#      (defaults to this Pi's own current hostname - e.g. the tenant
#      slug `personalize-tenant.sh` already set). Never passes
#      --advertise-exit-node or --advertise-routes - this Pi is a normal
#      tailnet member only, never an exit node or subnet router.
#
# Safe to re-run - every step checks what's already in place first.
#
# Usage:
#   ./setup-remote-access.sh
#       Installs/enables both, using this Pi's current hostname for
#       Tailscale.
#
#   ./setup-remote-access.sh --tailscale-hostname some-other-name
#       Same, but registers under a different Tailscale device name than
#       this Pi's OS hostname.
#
# Run this ON the Pi itself (over SSH), same as personalize-tenant.sh and
# hide-cursor.sh - it is not meant to run on a Mac.
#
# To remove a Pi from your accounts later (e.g. a box is being returned):
#   - Raspberry Pi Connect: on the Pi, run `rpi-connect signout` (or from
#     https://connect.raspberrypi.com, sign in, find the device under
#     "Devices" and remove it there - works even if the Pi itself is
#     already gone/wiped).
#   - Tailscale: on the Pi, run `sudo tailscale logout` (or from
#     https://login.tailscale.com/admin/machines, find the device and
#     click "Remove" - also works with the Pi offline/gone).

set -euo pipefail

TAILSCALE_HOSTNAME=""

while [ $# -gt 0 ]; do
  case "$1" in
    --tailscale-hostname)
      TAILSCALE_HOSTNAME="$2"
      shift 2
      ;;
    -h|--help)
      grep '^#' "$0" | sed '1d;s/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Run with --help for usage." >&2
      exit 1
      ;;
  esac
done

if [ -z "$TAILSCALE_HOSTNAME" ]; then
  TAILSCALE_HOSTNAME="$(hostname)"
fi

wait_for() {
  # wait_for <description> <check-command...> - polls every 5s for up to
  # 2 minutes, returns 0 the moment the check command succeeds.
  local description="$1"
  shift
  local i
  for i in $(seq 1 24); do
    if "$@" >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
  done
  echo "Timed out waiting for: $description" >&2
  return 1
}

# --- 1. Raspberry Pi Connect: install -----------------------------------

if ! command -v rpi-connect >/dev/null 2>&1; then
  echo "Installing rpi-connect..."
  sudo apt-get update
  sudo apt-get install -y rpi-connect
else
  echo "rpi-connect already installed ($(rpi-connect version 2>/dev/null || echo 'version unknown'))."
fi

# --- 2. User lingering ---------------------------------------------------

if [ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null)" = "yes" ]; then
  echo "Lingering already enabled for $(id -un)."
else
  sudo loginctl enable-linger "$(id -un)"
  echo "Enabled lingering for $(id -un) - rpi-connect (and the kiosk) now keep running with no one logged in."
fi

# --- 3. Tailscale: install ------------------------------------------------

if ! command -v tailscale >/dev/null 2>&1; then
  echo "Installing Tailscale..."
  curl -fsSL https://tailscale.com/install.sh | sudo sh
else
  echo "Tailscale already installed ($(tailscale version | head -1))."
fi

sudo systemctl enable --now tailscaled >/dev/null 2>&1 || true

# --- 4/5. Raspberry Pi Connect: sign in + enable screen/shell -----------

if [ "$(rpi-connect status 2>/dev/null | grep -c '^Signed in: yes')" -eq 0 ]; then
  echo ""
  echo "Starting Raspberry Pi Connect sign-in..."
  rm -f /tmp/rpi-connect-signin.log
  nohup rpi-connect signin > /tmp/rpi-connect-signin.log 2>&1 < /dev/null &
  disown
  sleep 3
  echo "--------------------------------------------------------------"
  cat /tmp/rpi-connect-signin.log
  echo "--------------------------------------------------------------"
  echo "Visit the link above and sign in with your Raspberry Pi ID."
  echo "Waiting up to 2 minutes..."
  if wait_for "Raspberry Pi Connect sign-in" bash -c "rpi-connect status 2>/dev/null | grep -q '^Signed in: yes'"; then
    echo "Signed in to Raspberry Pi Connect."
  else
    echo "Not signed in yet - re-run this script once you've completed the link above." >&2
  fi
else
  echo "Already signed in to Raspberry Pi Connect."
fi

if rpi-connect status 2>/dev/null | grep -q '^Signed in: yes'; then
  rpi-connect vnc on
  rpi-connect shell on
  echo "Screen sharing and remote shell are allowed."
fi

# --- 6. Tailscale: bring up -----------------------------------------------

if sudo tailscale status >/dev/null 2>&1 && ! sudo tailscale status 2>&1 | grep -q 'Logged out'; then
  echo "Tailscale already up: $(sudo tailscale ip -4 2>/dev/null) ($TAILSCALE_HOSTNAME)"
else
  echo ""
  echo "Starting Tailscale sign-in..."
  rm -f /tmp/tailscale-up.log
  nohup sudo tailscale up --hostname="$TAILSCALE_HOSTNAME" > /tmp/tailscale-up.log 2>&1 < /dev/null &
  disown
  sleep 3
  echo "--------------------------------------------------------------"
  cat /tmp/tailscale-up.log
  echo "--------------------------------------------------------------"
  echo "Visit the link above and log in with your Tailscale account."
  echo "Waiting up to 2 minutes..."
  if wait_for "Tailscale login" sudo tailscale status; then
    echo "Tailscale is up: $(sudo tailscale ip -4 2>/dev/null) ($TAILSCALE_HOSTNAME)"
  else
    echo "Not logged in yet - re-run this script once you've completed the link above." >&2
  fi
fi

echo ""
echo "Done."
