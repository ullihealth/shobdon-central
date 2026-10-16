#!/usr/bin/env python3
"""WiFi reconnect watcher - installed at /usr/local/bin/wifi-reconnect-
watcher.py, run by its own SYSTEM (root) systemd unit,
wifi-reconnect-watcher.service, alongside comitup.service.

WHY THIS EXISTS: comitup's own retry cadence while sitting in HOTSPOT is
a fixed 180s - and worse, FIXED AT 360s (comitup/states.py's own
FAIL_TIMEOUT) after any failed connection attempt, not reduced even if
the real network comes back sooner. Confirmed by reading comitup's own
source (no config option controls this - /etc/comitup.conf's full set of
keys was read directly, see install-wifi-setup.sh's own comment) and by
reproducing a real "router missing at boot" scenario on AA0001
(2026-10-16): the box sat in HOTSPOT for ~7.5 minutes after the router
actually came back, entirely because its one earlier failed attempt had
already set the 360s backoff running before the router returned. The
task this script fulfils: check far more often than that for the first
10 minutes (every 60s), then settle to every 5 minutes indefinitely -
comitup's own ~180s native cycle keeps running underneath this the whole
time regardless, so the two together are strictly faster than either
alone, never slower.

HOW: does NOT call `nmcli connection up` itself - an earlier version of
this script did, and real-hardware testing (2026-10-16) showed that was
actively harmful: this script's own direct connection attempts raced
comitup's own management of the same single WiFi radio, and the two
kept interrupting each other's in-flight attempts - a simulated outage
that took ~7.5 minutes to recover WITHOUT this script took ~13 minutes
WITH the direct-nmcli version running, confirmed from the logs (the
hotspot visibly kept flickering down and back up every retry, never
given enough uninterrupted time to complete a connection). Comitup
exposes no supported "retry now" command via its own CLI/D-Bus client
(checked: ciu_connect() takes an explicit ssid+password, there's no
bare "recheck known networks now") - but a plain `systemctl restart
comitup.service` makes comitup re-initialise from scratch, and its own
hotspot_start()/hotspot_pass() logic (states.py) immediately attempts
every known candidate connection the instant it (re)starts, exactly
like a fresh boot would. That keeps comitup as the radio's one and only
owner throughout - this script only ever decides WHEN to ask for a
fresh attempt, never performs one itself.

SINGLE RADIO, SAME GUARD COMITUP ITSELF USES: this Pi has one WiFi
radio, so any connection attempt necessarily interrupts the hotspot
broadcast, even briefly - confirmed via comitup's own hotspot_timeout()
(states.py), which skips its OWN periodic retry whenever
iwscan.ap_conn_count() > 0 (a device is connected to the AP). This
script mirrors that exact check (same `iw dev <dev> station dump`
technique) before ever touching the radio, and adds the 2-minute
resume-after-last-client grace period the task specifically asked for,
which comitup's own instant-per-cycle check doesn't provide.
"""

from __future__ import annotations

import logging
import subprocess
import sys
import time

NETWORK_STATE_FILE = "/run/airfieldcentral-network-state"
WIFI_DEVICE = "wlan0"

# First 10 minutes of an outage: check every 60s. After that: every 5
# minutes, indefinitely, so a long outage still recovers on its own.
FAST_INTERVAL_SECONDS = 60
SLOW_INTERVAL_SECONDS = 300
FAST_PERIOD_SECONDS = 600

# While a phone is connected to the setup hotspot, pause - resume only
# once no device has been connected for this long, so a borderline
# mid-setup moment (phone briefly idle between steps) is never cut off.
CLIENT_GRACE_SECONDS = 120

# comitup names its own AP-mode connection profiles with these prefixes
# (confirmed on AA0001: "AirfieldCentral-Setup-AA0001-0000",
# "comitup-542-0000") - excluded from the "try to join" candidate list,
# since those are the Pi's own hotspot identity, not a real network.
_COMITUP_OWN_PREFIXES = ("AirfieldCentral-Setup-", "comitup-")

POLL_SECONDS = 5
COMMAND_TIMEOUT_SECONDS = 20

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s wifi-reconnect-watcher %(levelname)s: %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("wifi-reconnect-watcher")


def _run(cmd: list[str], timeout: float = COMMAND_TIMEOUT_SECONDS) -> str:
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except (subprocess.TimeoutExpired, OSError) as error:
        log.warning("command %s failed to run (%s: %s)", cmd, type(error).__name__, error)
        return ""
    if result.returncode != 0:
        log.debug("command %s exited %d: %s", cmd, result.returncode, result.stderr.strip())
        return ""
    return result.stdout


def network_state() -> str:
    try:
        with open(NETWORK_STATE_FILE, encoding="utf-8") as f:
            return f.read().strip() or "CONNECTED"
    except OSError:
        return "CONNECTED"


def ap_client_count() -> int:
    # Mirrors comitup's own iwscan.ap_conn_count() exactly (iw dev
    # <dev> station dump, count "Station" lines) - see this file's own
    # top comment for why matching comitup's own technique matters here.
    out = _run(["iw", "dev", WIFI_DEVICE, "station", "dump"])
    return out.count("Station ")


def saved_wifi_connections() -> list[str]:
    out = _run(["nmcli", "-t", "-f", "NAME,TYPE", "connection", "show"])
    names = []
    for line in out.splitlines():
        parts = line.split(":")
        if len(parts) < 2:
            continue
        name, conn_type = parts[0], parts[1]
        if conn_type != "802-11-wireless":
            continue
        if name.startswith(_COMITUP_OWN_PREFIXES):
            continue
        names.append(name)
    return names


def visible_ssids() -> set[str]:
    out = _run(["nmcli", "-t", "-f", "SSID", "dev", "wifi", "list", "--rescan", "yes"])
    return {line.strip() for line in out.splitlines() if line.strip()}


def try_reconnect() -> None:
    visible = visible_ssids()
    if not visible:
        log.info("no networks visible in scan")
        return

    known_ssids = set()
    for name in saved_wifi_connections():
        ssid = _run(["nmcli", "-g", "802-11-wireless.ssid", "connection", "show", name]).strip()
        if ssid:
            known_ssids.add(ssid)

    matched = known_ssids & visible
    if not matched:
        log.info("none of the saved networks are currently visible")
        return

    # Restart comitup.service rather than activating anything ourselves
    # - see this file's own top comment for why a direct nmcli attempt
    # from this script is unsafe (it raced comitup's own attempts on
    # real hardware and made reconnection slower, not faster). This
    # keeps comitup as the radio's sole owner; it does its own candidate
    # selection and connection attempt immediately on restart.
    log.info("known network(s) now visible (%s) - restarting comitup.service to let it try", sorted(matched))
    _run(["systemctl", "restart", "comitup.service"], timeout=30)


def main() -> None:
    log.info("wifi-reconnect-watcher starting")
    disconnected_since: float | None = None
    last_check: float = 0.0
    last_client_seen: float = 0.0

    while True:
        state = network_state()

        if state == "CONNECTED":
            disconnected_since = None
            time.sleep(POLL_SECONDS)
            continue

        now = time.monotonic()
        if disconnected_since is None:
            disconnected_since = now
            log.info("disconnected (state=%s) - starting fast-retry window", state)

        if state == "CONNECTING":
            # comitup is already actively trying a connection itself -
            # leave it alone rather than racing a second attempt against
            # its own in-flight one.
            time.sleep(POLL_SECONDS)
            continue

        elapsed = now - disconnected_since
        interval = FAST_INTERVAL_SECONDS if elapsed < FAST_PERIOD_SECONDS else SLOW_INTERVAL_SECONDS
        if now - last_check < interval:
            time.sleep(POLL_SECONDS)
            continue
        last_check = now

        clients = ap_client_count()
        if clients > 0:
            last_client_seen = now
            log.info("setup hotspot has %d connected device(s) - skipping this check", clients)
            continue
        if last_client_seen and (now - last_client_seen) < CLIENT_GRACE_SECONDS:
            remaining = CLIENT_GRACE_SECONDS - (now - last_client_seen)
            log.info("a device left the setup hotspot recently - waiting %ds before checking again", int(remaining))
            continue

        log.info("checking for a known network (disconnected %ds, retry every %ds)", int(elapsed), interval)
        try_reconnect()


if __name__ == "__main__":
    main()
