#!/usr/bin/env python3
"""Tiny local web server for the WiFi setup page - installed at
~/.config/systemd/user/wifi-setup-server.py, run by its own
wifi-setup-server.service (same --user pattern as kiosk-watchdog.py/
.service - see that file's own comment for why a long-running helper
lives as its own unit rather than folded into the kiosk).

WHY THIS EXISTS: comitup's own captive-portal page (the one a PHONE sees
after joining the hotspot) is for picking a network and typing its
password - it is NOT shown on the kiosk's own TV. The TV needs its own,
separate, always-reachable-with-no-internet page (instructions + QR code
+ large-text SSID/password), which is this server's only job. Pure
stdlib http.server, no Flask/requests - same "avoid apt/pip dependency
drift on a Pi" posture kiosk-watchdog.py's own README section already
established, even though comitup itself happens to pull in python3-flask
as ITS OWN dependency - relying on that staying installed forever would
be fragile.

Serves two things, both read-only, both local-only (binds 127.0.0.1 -
the LAN-facing side comitup itself already handles, this process never
needs to be reachable from anywhere but this same Pi's own Chromium):
  - Static files from WEB_ROOT (index.html, wifi-qr.png) - index.html is
    already fully templated with the real SSID/password at install time
    (see install-wifi-setup.sh's own comment) - this server does no
    template substitution itself, it just serves bytes.
  - GET /state -> {"state": "<HOTSPOT|CONNECTING|CONNECTED>", "recentFailure": bool}
    - reads STATE_FILE, the same file comitup-callback.sh writes on
    every comitup state transition. index.html's own small polling
    script reads this to flip its one "waiting.../connected" status
    line - see that file's own comment. Missing/unreadable state file
    reads as "HOTSPOT" (the safe, most-likely-truthful default while
    comitup is still starting up for the first time ever).

    recentFailure round (2026-10-16): comitup's own phone-side captive
    portal gives no feedback at all if a submitted password was wrong
    (or any other connection attempt just failed) - confirmed on real
    hardware: the person is left looking at an unresponsive page with
    no idea anything went wrong. This server can't fix the phone-side
    portal (vendor code, not this project's to patch - see
    wifi-reconnect-watcher.py's own comment on the same tradeoff), but
    it CAN tell the TV: a CONNECTING -> HOTSPOT transition (tried,
    didn't reach CONNECTED) is a failed attempt, tracked here as module
    state across requests (this server is single-threaded - see main()
    - so no locking needed) and surfaced for a short window afterwards.

    "Getting ready" round (2026-10-16): the /state response also now
    carries "hotspotReady": bool. STATE_FILE alone isn't enough to know
    the hotspot is actually broadcasting - comitup writes "HOTSPOT" to
    it the moment it DECIDES to enter that state and kicks off
    activation, not once activation has actually finished (confirmed by
    reading comitup/states.py's own hotspot_start() - it calls
    activate_connection(), an async NetworkManager call, THEN triggers
    the callback that writes this file). A phone scanning the QR before
    the radio has actually finished coming up would fail to join even
    though the page already looks ready. hotspot_ready() instead asks
    NetworkManager directly whether wlan0 is genuinely fully activated
    (GENERAL.STATE 100) while comitup's own state is HOTSPOT - the only
    connection that would ever be active on wlan0 in that state is
    comitup's own AP, so this doesn't need to separately match its name.
"""
import http.server
import json
import os
import subprocess
import time

PORT = 8089
WEB_ROOT = "/home/admin/.config/wifi-setup-page"
STATE_FILE = "/run/airfieldcentral-network-state"
RECENT_FAILURE_WINDOW_SECONDS = 20
WIFI_DEVICE = "wlan0"

_last_state = None
_failed_until = 0.0


def hotspot_ready(state: str) -> bool:
    if state != "HOTSPOT":
        return False
    try:
        result = subprocess.run(
            ["nmcli", "-t", "-f", "GENERAL.STATE", "device", "show", WIFI_DEVICE],
            capture_output=True, text=True, timeout=2,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    if result.returncode != 0:
        return False
    device_state = result.stdout.strip()
    return device_state.startswith("GENERAL.STATE:100")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_ROOT, **kwargs)

    # Caching round (2026-10-16): confirmed live - a newly deployed
    # index.html sat correctly updated on disk (verified by timestamp
    # and content) while Chromium kept showing the OLD page, with none
    # of that session's changes visible at all. SimpleHTTPRequestHandler
    # sets no Cache-Control of its own for static files (only /state's
    # own handler, above, did) - Chromium's own on-disk HTTP cache
    # persists across kiosk.service restarts (it's the same browser
    # profile directory each time, not wiped), so it kept serving a
    # cached copy of index.html indefinitely, through any number of
    # file updates on disk, with nothing here ever telling it not to.
    # Applied to EVERY response via end_headers(), not just /state's own
    # explicit header, so connected-confirmation.html, connecting.html
    # and the QR image never go stale on screen again either.
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_GET(self):
        if self.path == "/state":
            global _last_state, _failed_until
            try:
                with open(STATE_FILE, "r") as f:
                    state = f.read().strip() or "HOTSPOT"
            except OSError:
                state = "HOTSPOT"

            now = time.monotonic()
            if _last_state == "CONNECTING" and state == "HOTSPOT":
                _failed_until = now + RECENT_FAILURE_WINDOW_SECONDS
            _last_state = state

            body = json.dumps({
                "state": state,
                "recentFailure": now < _failed_until,
                "hotspotReady": hotspot_ready(state),
            }).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    # Quiet by default (systemd journal already timestamps every line) -
    # same posture as not wanting kiosk-watchdog.py's own log flooded
    # with routine per-poll noise, just applied to HTTP access logging
    # instead of render checks.
    def log_message(self, format, *args):
        pass


def main():
    os.chdir(WEB_ROOT)
    server = http.server.HTTPServer(("127.0.0.1", PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
