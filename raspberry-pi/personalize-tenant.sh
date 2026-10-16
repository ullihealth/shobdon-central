#!/bin/bash
# Run this ONCE over SSH on a freshly-flashed Pi, right after flashing the
# master SD card image for a new tenant (Tiger Helicopters, Gyroplane
# Train, Swift Light Flight, Herefordshire Gliding Club, etc.).
#
# What it does, in order:
#   1. Asks for (or takes as flags) the tenant's dashboard URL and the
#      hostname you want this Pi to have on the network.
#   2. Shows you a summary and asks you to confirm.
#   3. Writes /home/admin/tenant-config.txt - kiosk-wrapper.sh reads this
#      on every boot to know which dashboard to show.
#   4. Sets the Pi's hostname via raspi-config.
#   5. Clears Chromium's SingletonLock/SingletonSocket/SingletonCookie
#      files, if present, from the kiosk's Chromium profile (2026-10-14 -
#      a real incident on the Tiger Helicopters onboarding: that lock is
#      stamped with the hostname that was active when it was written, and
#      kiosk-wrapper.sh's double-launch pattern SIGKILLs the first
#      Chromium launch, which skips the clean shutdown that would
#      otherwise remove it. A lock stamped with the OLD hostname makes
#      every later Chromium launch refuse to start - "The profile appears
#      to be in use by another Chromium process ... on another computer"
#      - because it can't tell the stale local lock apart from a real
#      remote one. Harmless to delete unconditionally; Chromium just
#      recreates them on its next successful launch.
#   6. Identity round (2026-10-16) - fixes a real gap this same script
#      left open: steps 3/4 above were never the ONLY thing that made one
#      Pi different from another, they were just the only thing this
#      script touched. AA0001 and AA0003 were both made by `dd`-cloning
#      Meg's Cafe's live card directly, then running (only) this script -
#      which changes the hostname and tenant-config.txt, but leaves
#      /etc/machine-id, the SSH host keys, and any already-registered
#      Tailscale/Raspberry Pi Connect identity exactly as they were on
#      the source card. Two Pis can pass as hostname-different but still
#      be indistinguishable underneath - a real risk once more than one
#      box exists. This step now also:
#        - Regenerates /etc/machine-id (systemd-machine-id-setup) and the
#          SSH host keys (ssh-keygen -A) - cheap, unconditional, every run
#          from now on, not just when a clone is suspected.
#        - Logs this box out of Tailscale and Raspberry Pi Connect if
#          either is currently signed in (clearing whatever identity the
#          source card's disk carried), then calls setup-remote-access.sh
#          (same directory, left completely unchanged - see that file's
#          own comment) so the box re-registers as a brand-new device
#          under its NEW hostname. That script's own interactive sign-in
#          links are printed here exactly as it already prints them -
#          THIS script makes no attempt to complete them; only a human
#          can click a sign-in link.
#   7. Reboots. The kiosk starts showing the new tenant's dashboard
#      automatically from here on - nothing else to do.
#
# Usage:
#   ./personalize-tenant.sh
#       Interactive - prompts for everything, asks to confirm, reboots.
#
#   ./personalize-tenant.sh --url https://tiger-helicopters-media.airfieldcentral.com --hostname tiger-helicopters
#       Same thing, non-interactive (still asks to confirm unless --yes
#       is also given).
#
#   ./personalize-tenant.sh --url ... --hostname ... --yes
#       Fully non-interactive - no confirmation prompt, reboots
#       immediately at the end. Use this if you're scripting several
#       Pis in a row and you're already confident in the values.
#
#   ./personalize-tenant.sh --dry-run --url ... --hostname ...
#       Shows exactly what would happen (validates, prints the config
#       file contents, prints the hostname/reboot commands it WOULD run)
#       without touching anything real. Useful for checking your inputs
#       are valid before committing, or for testing this script itself
#       off a real Pi.
#
#   ./personalize-tenant.sh --url ... --hostname ... --skip-remote-access
#       Same as the normal run, but skips the Tailscale/Raspberry Pi
#       Connect logout+re-registration step entirely (identity still
#       gets regenerated - machine-id, SSH host keys). Use this if you
#       want to do the hostname/identity work now and the remote-access
#       sign-in dance later, rather than being asked to click links right
#       away.
#
# Safe to re-run if you make a mistake - it just overwrites
# tenant-config.txt and re-sets the hostname; there's no state from a
# previous run that needs cleaning up first.

set -euo pipefail

# TENANT_CONFIG_FILE_OVERRIDE exists purely so this script can be tested
# off a real Pi (e.g. on a Mac, where /home/admin doesn't exist) - it's
# never set in production, where CONFIG_FILE is always the real path.
CONFIG_FILE="${TENANT_CONFIG_FILE_OVERRIDE:-/home/admin/tenant-config.txt}"
CHROMIUM_PROFILE_DIR="${CHROMIUM_PROFILE_DIR_OVERRIDE:-$HOME/.config/chromium}"
# Identity round - same off-Pi-testing escape hatch as CONFIG_FILE/
# CHROMIUM_PROFILE_DIR above, never set in production.
SETUP_REMOTE_ACCESS_SCRIPT="${SETUP_REMOTE_ACCESS_SCRIPT_OVERRIDE:-$(dirname "$0")/setup-remote-access.sh}"
DASHBOARD_URL=""
TENANT_HOSTNAME=""
DRY_RUN=0
ASSUME_YES=0
SKIP_REBOOT=0
SKIP_REMOTE_ACCESS=0

print_usage() {
  grep '^#' "$0" | sed '1d;s/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --url)
      DASHBOARD_URL="$2"
      shift 2
      ;;
    --hostname)
      TENANT_HOSTNAME="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --yes|-y)
      ASSUME_YES=1
      shift
      ;;
    --no-reboot)
      SKIP_REBOOT=1
      shift
      ;;
    --skip-remote-access)
      SKIP_REMOTE_ACCESS=1
      shift
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Run with --help for usage." >&2
      exit 1
      ;;
  esac
done

# --- Validation helpers -----------------------------------------------

validate_url() {
  local url="$1"
  if [[ ! "$url" =~ ^https?://[a-zA-Z0-9.-]+(:[0-9]+)?(/.*)?$ ]]; then
    echo "That doesn't look like a valid http:// or https:// URL: $url" >&2
    return 1
  fi
  return 0
}

# Standard hostname rules (RFC 1123 label): lowercase letters, digits,
# hyphens only; can't start/end with a hyphen; max 63 characters. This is
# deliberately strict (rejects spaces, apostrophes, capital letters) even
# though a tenant's real name often has none of those constraints ("Meg's
# Cafe") - the operator is expected to pick a clean slug (e.g.
# "megs-cafe"), same as this project's own tenant slugs already do.
validate_hostname() {
  local name="$1"
  if [ ${#name} -gt 63 ] || [ ${#name} -lt 1 ]; then
    echo "Hostname must be 1-63 characters: $name" >&2
    return 1
  fi
  if [[ ! "$name" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]]; then
    echo "Hostname must be lowercase letters, digits, and hyphens only, and can't start/end with a hyphen: $name" >&2
    return 1
  fi
  return 0
}

# --- Gather input (prompt for anything not passed as a flag) ----------

if [ -z "$DASHBOARD_URL" ]; then
  read -r -p "Dashboard URL (e.g. https://tiger-helicopters-media.airfieldcentral.com): " DASHBOARD_URL
fi
until validate_url "$DASHBOARD_URL"; do
  read -r -p "Dashboard URL: " DASHBOARD_URL
done

if [ -z "$TENANT_HOSTNAME" ]; then
  read -r -p "Hostname for this Pi (e.g. tiger-helicopters): " TENANT_HOSTNAME
fi
until validate_hostname "$TENANT_HOSTNAME"; do
  read -r -p "Hostname: " TENANT_HOSTNAME
done

# --- Confirm ------------------------------------------------------------

echo ""
echo "About to configure this Pi as:"
echo "  Dashboard URL : $DASHBOARD_URL"
echo "  Hostname      : $TENANT_HOSTNAME"
echo "  Config file   : $CONFIG_FILE"
if [ "$DRY_RUN" -eq 1 ]; then
  echo "  (--dry-run: nothing below will actually be written/changed/rebooted)"
fi
echo ""

if [ "$ASSUME_YES" -ne 1 ] && [ "$DRY_RUN" -ne 1 ]; then
  read -r -p "Proceed? [y/N] " CONFIRM
  case "$CONFIRM" in
    [yY]|[yY][eE][sS]) ;;
    *)
      echo "Cancelled - nothing was changed."
      exit 0
      ;;
  esac
fi

# --- Write tenant-config.txt --------------------------------------------

CONFIG_CONTENTS="# Written by personalize-tenant.sh on $(date -u '+%Y-%m-%dT%H:%M:%SZ')
DASHBOARD_URL=${DASHBOARD_URL}
TENANT_HOSTNAME=${TENANT_HOSTNAME}
"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "--- Would write $CONFIG_FILE: ---"
  echo "$CONFIG_CONTENTS"
  echo "--- Would run: sudo raspi-config nonint do_hostname $TENANT_HOSTNAME ---"
  echo "--- Would remove (if present): $CHROMIUM_PROFILE_DIR/SingletonLock, SingletonSocket, SingletonCookie ---"
  echo "--- Would run: sudo rm -f /etc/machine-id && sudo systemd-machine-id-setup ---"
  echo "--- Would run: sudo rm -f /etc/ssh/ssh_host_* && sudo ssh-keygen -A ---"
  if [ "$SKIP_REMOTE_ACCESS" -ne 1 ]; then
    echo "--- Would log out of Tailscale/Raspberry Pi Connect if currently signed in, then run: $SETUP_REMOTE_ACCESS_SCRIPT --tailscale-hostname $TENANT_HOSTNAME ---"
  fi
  if [ "$SKIP_REBOOT" -ne 1 ]; then
    echo "--- Would run: sudo reboot ---"
  fi
  echo "Dry run complete - nothing was actually changed."
  exit 0
fi

echo "$CONFIG_CONTENTS" > "$CONFIG_FILE"
echo "Wrote $CONFIG_FILE"

# --- Set hostname ---------------------------------------------------------

# raspi-config's nonint do_hostname updates both /etc/hostname and the
# matching /etc/hosts entry - no separate /etc/hosts edit needed here.
if command -v raspi-config >/dev/null 2>&1; then
  sudo raspi-config nonint do_hostname "$TENANT_HOSTNAME"
  echo "Hostname set to $TENANT_HOSTNAME"
else
  echo "raspi-config not found - this doesn't look like a Raspberry Pi. Skipping hostname change." >&2
  echo "(This is expected if you're testing this script somewhere other than the Pi itself.)" >&2
fi

# --- Clear Chromium's hostname-stamped profile lock ------------------------

# See the comment at the top of this file for why: a lock stamped with
# the hostname we just changed away from makes Chromium refuse to start
# on every later boot. Only these three files - never anything else in
# the profile (history, cookies, cache, etc).
rm -f "$CHROMIUM_PROFILE_DIR/SingletonLock" "$CHROMIUM_PROFILE_DIR/SingletonSocket" "$CHROMIUM_PROFILE_DIR/SingletonCookie"
echo "Cleared any stale Chromium SingletonLock/SingletonSocket/SingletonCookie in $CHROMIUM_PROFILE_DIR"

# --- Fresh machine-id and SSH host keys (identity round, 2026-10-16) ------

# See this file's own top comment for the full "why" - a dd-cloned card
# carries the source Pi's machine-id and SSH host keys unless something
# explicitly regenerates them; hostname alone doesn't touch either.
# command -v guards (same posture as the raspi-config check above) so
# this script still runs cleanly when tested off a real Pi.
if command -v systemd-machine-id-setup >/dev/null 2>&1; then
  sudo rm -f /etc/machine-id
  sudo systemd-machine-id-setup
  echo "Regenerated /etc/machine-id"
else
  echo "systemd-machine-id-setup not found - skipping machine-id regeneration." >&2
  echo "(This is expected if you're testing this script somewhere other than the Pi itself.)" >&2
fi

if command -v ssh-keygen >/dev/null 2>&1 && [ -d /etc/ssh ]; then
  sudo rm -f /etc/ssh/ssh_host_*
  sudo ssh-keygen -A >/dev/null
  echo "Regenerated SSH host keys"
else
  echo "ssh-keygen or /etc/ssh not found - skipping SSH host key regeneration." >&2
  echo "(This is expected if you're testing this script somewhere other than the Pi itself.)" >&2
fi

# --- Re-register remote access under the new identity ----------------------

# A box whose disk came from an already-signed-in Pi (dd-clone) may
# already be logged in under the SOURCE Pi's own Tailscale/Raspberry Pi
# Connect identity - logging out first (only if actually signed in, so a
# genuinely fresh box is a silent no-op here) is what makes the
# subsequent setup-remote-access.sh call register a truly NEW device
# under this box's own new hostname, not resume the old one's session.
if [ "$SKIP_REMOTE_ACCESS" -eq 1 ]; then
  echo "Skipping remote-access re-registration (--skip-remote-access) - run setup-remote-access.sh yourself when ready."
elif [ ! -x "$SETUP_REMOTE_ACCESS_SCRIPT" ]; then
  echo "setup-remote-access.sh not found at $SETUP_REMOTE_ACCESS_SCRIPT - skipping remote-access re-registration." >&2
  echo "(This is expected if you're testing this script somewhere other than the Pi itself.)" >&2
else
  if command -v tailscale >/dev/null 2>&1 && sudo tailscale status >/dev/null 2>&1 && ! sudo tailscale status 2>&1 | grep -q 'Logged out'; then
    echo "Logging out of Tailscale (currently signed in, possibly under the source card's own identity)..."
    sudo tailscale logout
  fi
  if command -v rpi-connect >/dev/null 2>&1 && rpi-connect status 2>/dev/null | grep -q '^Signed in: yes'; then
    echo "Signing out of Raspberry Pi Connect (currently signed in, possibly under the source card's own identity)..."
    rpi-connect signout
  fi
  echo ""
  echo "Re-registering remote access as a new device ($TENANT_HOSTNAME) - this needs you to click two sign-in links, see below."
  echo ""
  "$SETUP_REMOTE_ACCESS_SCRIPT" --tailscale-hostname "$TENANT_HOSTNAME"
fi

# --- Reboot ---------------------------------------------------------------

if [ "$SKIP_REBOOT" -eq 1 ]; then
  echo "Done. --no-reboot was set - reboot manually (sudo reboot) when ready for the new dashboard to take effect."
  exit 0
fi

echo "Rebooting in 5 seconds to apply the new hostname and start the kiosk on the new dashboard..."
echo "(Ctrl+C now to cancel the reboot - tenant-config.txt and the hostname are already set either way.)"
sleep 5
sudo reboot
