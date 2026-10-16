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
  - GET /state -> {"state": "<HOTSPOT|CONNECTING|CONNECTED>"} - reads
    STATE_FILE, the same file comitup-callback.sh writes on every
    comitup state transition. index.html's own small polling script
    reads this to flip its one "waiting.../connected" status line - see
    that file's own comment. Missing/unreadable state file reads as
    "HOTSPOT" (the safe, most-likely-truthful default while comitup is
    still starting up for the first time ever).
"""
import http.server
import json
import os

PORT = 8089
WEB_ROOT = "/home/admin/.config/wifi-setup-page"
STATE_FILE = "/run/airfieldcentral-network-state"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_ROOT, **kwargs)

    def do_GET(self):
        if self.path == "/state":
            try:
                with open(STATE_FILE, "r") as f:
                    state = f.read().strip() or "HOTSPOT"
            except OSError:
                state = "HOTSPOT"
            body = json.dumps({"state": state}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
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
