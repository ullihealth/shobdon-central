#!/usr/bin/env python3
"""TV wake/sleep schedule check - HDMI-CEC round (migration 0114).

Run once per minute by tv-schedule-check.timer (a plain oneshot
.service calls this script and exits - there is no long-running daemon
here, unlike kiosk-watchdog.py/wifi-reconnect-watcher.py). Polls the
shared, authenticated-by-fleet-key schedule endpoint, decides what the
TV should be doing RIGHT NOW, and sends exactly one HDMI-CEC command
when (and only when) that decision differs from what was last actually
commanded - never on every tick, and never by re-querying the TV's own
current power state. A human using the TV's own remote between
scheduled transitions is deliberately left alone - this script only
ever commands the TV at a scheduled transition, right after a boot, or
on an admin override. Same "only act on a real state change, never
spam" posture raspberry-pi/comitup-callback.sh already established for
a different piece of hardware in this project.

Config (root-only, chmod 600 - never committed, never logged):
    /etc/airfieldcentral/tv-schedule.conf
        SERIAL=AA0003
        PI_FLEET_KEY=<the shared fleet key Jeff sets via
                       `wrangler pages secret put PI_FLEET_KEY`>

State:
    /run/airfieldcentral-tv-schedule-last-commanded.json
        tmpfs - CLEARED ON EVERY BOOT. This is the entire mechanism
        behind "always re-assert the correct state once after a boot or
        HDMI hotplug" - with no last-commanded state surviving a reboot,
        the very first check after boot always treats the current
        desired state as a change worth commanding, even if by
        coincidence it's the same as whatever the TV happens to be
        doing right now (woken by HDMI hotplug during the reboot, or
        left on from before).
    /var/cache/airfieldcentral-tv-schedule.json
        Persistent cache of the last successfully fetched schedule -
        used only when a poll request fails (no internet), so the box
        keeps following the last known schedule rather than doing
        nothing until connectivity returns.

Usage:
    tv-schedule-check.py                  # normal run (needs cec-ctl, root)
    tv-schedule-check.py --simulate SCHEDULE.json [--now ISO8601]
                                           # no network, no cec-ctl, no
                                           # state files touched - just
                                           # prints the decision it
                                           # would make, for local
                                           # verification before ever
                                           # touching real hardware.
"""
import argparse
import json
import logging
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

CONFIG_FILE = Path("/etc/airfieldcentral/tv-schedule.conf")
LAST_COMMANDED_FILE = Path("/run/airfieldcentral-tv-schedule-last-commanded.json")
CACHE_FILE = Path("/var/cache/airfieldcentral-tv-schedule.json")
# shobdon.airfieldcentral.com, not the bare apex - verified directly:
# both currently return 401 to an unauthenticated POST (PI_FLEET_KEY is
# set on both the shobdon-central Pages project AND the separate
# airfield-central Worker that owns the apex route), but this route
# itself is served by the Pages project (it isn't tenant-scoped - it
# looks a box up by serial_number globally, the Host header is never
# read), so a tenant subdomain is the more direct, unambiguous target -
# the apex going through a different service (the Worker) first is one
# more hop that isn't needed here and isn't guaranteed to stay wired to
# the same PI_FLEET_KEY in future the way the Pages project's own
# binding is.
API_URL = "https://shobdon.airfieldcentral.com/api/public/pi-units/tv-schedule"
CEC_DEVICE = Path("/dev/cec0")
# cec-ctl needs -d0 (the device index) passed EXPLICITLY on every
# invocation on this hardware - confirmed via real-hardware testing on
# the Tiger box (AA0003, a Samsung UE22F5410): omitting it was part of
# why the original, unverified command guesses below didn't work.
CEC_ADAPTER = "-d0"
# Used only if cec-ctl -d0's own "Physical Address" line can't be parsed
# (get_physical_address() below) - 1.0.0.0 is what the Pi reports as a
# playback device connected directly to the TV's HDMI1 in the real test
# that confirmed these commands, so it's a reasonable single-box-setup
# fallback, not a guess pulled from documentation.
FALLBACK_PHYS_ADDR = "1.0.0.0"
PHYSICAL_ADDRESS_RE = re.compile(r"Physical Address\s*:\s*([0-9a-fA-F]\.[0-9a-fA-F]\.[0-9a-fA-F]\.[0-9a-fA-F])")

# Explicit, not the Pi's own system timezone - requirement #5. The Pi's
# system clock/timezone could be anything (UTC is actually the more
# common default on a fresh Raspberry Pi OS image), so trusting it would
# silently run the schedule in the wrong timezone on any box where it
# was never explicitly set to Europe/London.
LONDON = ZoneInfo("Europe/London")

WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

logging.basicConfig(level=logging.INFO, format="%(asctime)s tv-schedule-check: %(message)s")
log = logging.getLogger("tv-schedule-check")


def read_config():
    if not CONFIG_FILE.exists():
        return None
    values = {}
    for line in CONFIG_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip()
    serial = values.get("SERIAL")
    key = values.get("PI_FLEET_KEY")
    if not serial or not key:
        return None
    return {"serial": serial, "key": key}


def read_json_file(path):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def write_json_file(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data))


# Mirrors functions/api/_utils/tvSchedule.mjs's own validateSchedule -
# same same-day-only rule (overnight schedules rejected, not supported -
# see that file's own comment for why). Kept intentionally minimal here
# since the server is the real validation boundary (the admin can never
# save an invalid schedule in the first place) - this is just a
# defensive check against a corrupted local cache.
def is_schedule_well_formed(schedule):
    if not isinstance(schedule, dict):
        return False
    for day_key in WEEKDAY_KEYS:
        day = schedule.get(day_key)
        if not isinstance(day, dict) or not isinstance(day.get("off"), bool):
            return False
        if not day["off"]:
            wake, sleep = day.get("wake"), day.get("sleep")
            if not isinstance(wake, str) or not isinstance(sleep, str) or sleep <= wake:
                return False
    return True


def fetch_schedule(serial, key, last_command, last_error, now):
    request = urllib.request.Request(
        API_URL,
        method="POST",
        headers={
            "X-Pi-Serial": serial,
            "X-Pi-Fleet-Key": key,
            "Content-Type": "application/json",
            # Confirmed on real hardware (AA0003): Cloudflare's own bot
            # protection 403s urllib's default "Python-urllib/3.x" User-
            # Agent before the request ever reaches our route - it never
            # even gets a chance to check X-Pi-Fleet-Key. A plain,
            # identifiable UA (not spoofing a browser) is enough to pass.
            "User-Agent": f"AirfieldCentral-PiFleet/1.0 ({serial})",
        },
        data=json.dumps({"lastCommand": last_command, "lastError": last_error}).encode(),
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        data = json.loads(response.read())
    write_json_file(CACHE_FILE, data)
    return data


# Same decision logic as functions/api/_utils/tvSchedule.mjs's own
# computeDesiredState - an active override always wins over the
# recurring weekly schedule, and applies even when the weekly schedule
# itself is disabled/unset. Returns 'wake' | 'sleep' | None (None = no
# schedule applies right now at all - caller must send no CEC command).
def compute_desired_state(data, now_utc):
    override_state = data.get("overrideState")
    override_until = data.get("overrideUntil")
    if override_state and override_until:
        until = datetime.fromisoformat(override_until.replace("Z", "+00:00"))
        if now_utc < until:
            return override_state

    if not data.get("enabled") or not data.get("schedule"):
        return None

    now_london = now_utc.astimezone(LONDON)
    weekday_key = WEEKDAY_KEYS[now_london.weekday()]  # Monday=0 already matches our mon-first list
    day = data["schedule"].get(weekday_key)
    if not day:
        return None
    if day.get("off"):
        return "sleep"

    now_minutes = now_london.hour * 60 + now_london.minute
    wake_h, wake_m = (int(x) for x in day["wake"].split(":"))
    sleep_h, sleep_m = (int(x) for x in day["sleep"].split(":"))
    wake_minutes, sleep_minutes = wake_h * 60 + wake_m, sleep_h * 60 + sleep_m
    return "wake" if wake_minutes <= now_minutes < sleep_minutes else "sleep"


# The two CEC actions this round needs - CONFIRMED on real hardware
# (Tiger box AA0003, Samsung UE22F5410, Anynet+ on, Auto Turn Off = Yes -
# see the install checklist/README for why both of those TV-side
# settings matter). IMPORTANT, learned from that same test: cec-ctl
# returning exit code 0 does NOT prove the TV actually obeyed - before
# "Auto Turn Off" was enabled, --standby reported success every time
# while the TV stayed on. Exit code is still the only signal this script
# can act on (there is no generic "did the TV actually turn off" query
# over CEC), so a wrong TV-side setting shows up as a silently-ignored
# command, not a logged error - that's exactly what the install
# checklist/README note exists to head off at setup time, not something
# this script can detect for itself.
#
# ON:  claim the playback role, tell the TV to wake (image-view-on),
#      then claim active source (so it also switches to the Pi's input,
#      not just wakes showing whatever input it last had).
# OFF: claim the playback role, claim active source FIRST (some TVs only
#      honour an unsolicited standby from the device they consider the
#      active source), pause briefly to let that land on the bus, then
#      send standby.
def cec_command_sequence_for(desired, phys_addr):
    playback = ["cec-ctl", CEC_ADAPTER, "--playback"]
    active_source = ["cec-ctl", CEC_ADAPTER, "--active-source", f"phys-addr={phys_addr}"]
    if desired == "wake":
        return [
            ("cmd", playback),
            ("cmd", ["cec-ctl", CEC_ADAPTER, "--to", "0", "--image-view-on"]),
            ("cmd", active_source),
        ]
    return [
        ("cmd", playback),
        ("cmd", active_source),
        ("sleep", 2),
        ("cmd", ["cec-ctl", CEC_ADAPTER, "--to", "0", "--standby"]),
    ]


# Reads the Pi's own CEC physical address from `cec-ctl -d0`'s own
# output at run time, rather than hardcoding it - a box moved to a
# different HDMI input, or a different TV/AV receiver's own HDMI
# topology, can give the Pi a different physical address than
# 1.0.0.0 (confirmed on AA0003's own direct-to-TV HDMI1 setup) - falls
# back to that known-good value only when parsing fails, not as the
# primary source of truth.
def get_physical_address():
    try:
        result = subprocess.run(["cec-ctl", CEC_ADAPTER], capture_output=True, text=True, timeout=10)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return FALLBACK_PHYS_ADDR
    match = PHYSICAL_ADDRESS_RE.search(result.stdout)
    return match.group(1) if match else FALLBACK_PHYS_ADDR


def send_cec(desired, simulate):
    phys_addr = FALLBACK_PHYS_ADDR if simulate else get_physical_address()
    sequence = cec_command_sequence_for(desired, phys_addr)

    if simulate:
        for kind, value in sequence:
            if kind == "sleep":
                log.info("[simulate] would wait %ss", value)
            else:
                log.info("[simulate] would run: %s", " ".join(value))
        return None  # no error

    if not CEC_DEVICE.exists():
        return "no CEC hardware - /dev/cec0 not found (check dtoverlay=vc4-kms-v3d is enabled and the TV is on HDMI0)"

    for kind, value in sequence:
        if kind == "sleep":
            time.sleep(value)
            continue
        try:
            result = subprocess.run(value, capture_output=True, text=True, timeout=10)
        except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
            return f"cec-ctl failed: {exc}"
        if result.returncode != 0:
            return f"TV not responding - enable HDMI-CEC in the TV's own menu (cec-ctl exit {result.returncode}: {result.stderr.strip()[:200]})"
    return None  # success


def run(simulate_schedule_path, now_override):
    now_utc = now_override or datetime.now(timezone.utc)

    if simulate_schedule_path:
        schedule = json.loads(Path(simulate_schedule_path).read_text())
        if not is_schedule_well_formed(schedule.get("schedule") or {}):
            log.warning("simulated schedule file does not look well-formed - decisions below may not be meaningful")
        desired = compute_desired_state(schedule, now_utc)
        log.info("[simulate] now (UTC)=%s now (Europe/London)=%s", now_utc.isoformat(), now_utc.astimezone(LONDON).isoformat())
        log.info("[simulate] enabled=%s overrideState=%s overrideUntil=%s", schedule.get("enabled"), schedule.get("overrideState"), schedule.get("overrideUntil"))
        log.info("[simulate] desired state = %s", desired)
        if desired is not None:
            send_cec(desired, simulate=True)
        else:
            log.info("[simulate] no schedule applies right now - no command would be sent")
        return 0

    config = read_config()
    if not config:
        log.warning("not configured (%s missing or incomplete) - doing nothing", CONFIG_FILE)
        return 0

    last_commanded = read_json_file(LAST_COMMANDED_FILE) or {}

    try:
        data = fetch_schedule(config["serial"], config["key"], last_commanded.get("command"), last_commanded.get("error"), now_utc)
    except urllib.error.HTTPError as exc:
        # Our own route (functions/api/public/pi-units/tv-schedule.ts)
        # never returns 403 itself - only 401 (bad/missing key), 400
        # (missing serial), 404 (unknown serial), or 503 (key not
        # configured). A 403 here means something in FRONT of the app
        # blocked the request before it ever reached that code -
        # confirmed on real hardware (AA0003): Cloudflare's own bot
        # protection, triggered by urllib's default User-Agent (see
        # fetch_schedule's own comment - the fix is already applied
        # there, this is just so a FUTURE edge/WAF block of some other
        # kind is obvious from the log instead of looking identical to
        # our own server saying no).
        if exc.code == 403:
            log.warning("blocked before reaching the server (403) - check User-Agent/WAF, not X-Pi-Fleet-Key - falling back to last cached schedule, if any")
        else:
            log.warning("poll rejected (HTTP %s) - falling back to last cached schedule, if any", exc.code)
        data = read_json_file(CACHE_FILE)
        if not data:
            log.warning("no cached schedule available either - doing nothing")
            return 0
    except (urllib.error.URLError, TimeoutError) as exc:
        log.warning("poll failed (%s) - falling back to last cached schedule, if any", exc)
        data = read_json_file(CACHE_FILE)
        if not data:
            log.warning("no cached schedule available either - doing nothing")
            return 0

    desired = compute_desired_state(data, now_utc)
    if desired is None:
        log.info("no schedule applies right now - doing nothing")
        return 0

    if last_commanded.get("command") == desired:
        return 0  # steady state - the whole point of this file: no command, no spam

    log.info("state change: %s -> %s - sending CEC command", last_commanded.get("command") or "(unknown, e.g. just booted)", desired)
    error = send_cec(desired, simulate=False)
    if error:
        log.error(error)
    write_json_file(LAST_COMMANDED_FILE, {"command": desired, "error": error, "commandedAtUtc": now_utc.isoformat()})
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--simulate", metavar="SCHEDULE.json", help="local schedule fixture - no network, no cec-ctl, no state files touched")
    parser.add_argument("--now", metavar="ISO8601", help="override 'now' for deterministic testing, e.g. 2026-12-25T07:30:00Z")
    args = parser.parse_args()
    now_override = datetime.fromisoformat(args.now.replace("Z", "+00:00")) if args.now else None
    sys.exit(run(args.simulate, now_override))


if __name__ == "__main__":
    main()
