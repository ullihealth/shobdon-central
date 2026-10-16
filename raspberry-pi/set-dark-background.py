#!/usr/bin/env python3
"""Overrides Chromium's default (white) first-paint background with the
project's own dark colour, via Chrome DevTools Protocol's
Page.setBackgroundColorOverride - confirmed 2026-10-16: a brief white
flash was visible before any page content painted, each time Chromium
launched. There's no public Chromium command-line flag for this (the
default compositor background before a page's own CSS loads is
hardcoded white); the CDP override is the standard technique for
kiosk/embedded Chromium setups.

Runs as a short-lived background helper (see kiosk-wrapper.sh's own
comment on where this is launched from and why it has to start before
exec replaces the wrapper process) - polls for a CDP page target to
appear, applies the override the moment one does, then exits. Does
nothing else, touches nothing else - purely cosmetic, never allowed to
affect whether or what Chromium launches (kiosk-wrapper.sh's own launch
logic is completely unchanged and this runs fully independently of it).
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request

CDP_HOST = "127.0.0.1"
CDP_PORT = 9222
BG_COLOR = {"r": 2, "g": 6, "b": 23, "a": 255}  # #020617 - same as wifi-setup-page/index.html
POLL_SECONDS = 0.3
TIMEOUT_SECONDS = 20
NETWORK_TIMEOUT_SECONDS = 2

try:
    import websocket as _websocket_client  # type: ignore

    def _ws_request(ws_url: str, message: str) -> None:
        ws = _websocket_client.create_connection(ws_url, timeout=NETWORK_TIMEOUT_SECONDS)
        try:
            ws.send(message)
            ws.recv()
        finally:
            ws.close()

except ImportError:
    import base64
    import os
    import socket
    import struct
    from urllib.parse import urlparse

    def _ws_request(ws_url: str, message: str) -> None:
        parsed = urlparse(ws_url)
        sock = socket.create_connection((parsed.hostname, parsed.port), timeout=NETWORK_TIMEOUT_SECONDS)
        sock.settimeout(NETWORK_TIMEOUT_SECONDS)
        key = os.urandom(16)
        path = parsed.path + (f"?{parsed.query}" if parsed.query else "")
        request = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {parsed.hostname}:{parsed.port}\r\n"
            "Upgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {base64.b64encode(key).decode()}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        sock.sendall(request.encode())
        data = b""
        while b"\r\n\r\n" not in data:
            data += sock.recv(4096)
        payload = message.encode("utf-8")
        mask_key = os.urandom(4)
        masked = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
        header = bytearray([0x81, 0x80 | len(payload)])
        header += mask_key
        sock.sendall(bytes(header) + masked)
        sock.close()


def try_apply_once() -> bool:
    try:
        url = f"http://{CDP_HOST}:{CDP_PORT}/json"
        with urllib.request.urlopen(url, timeout=NETWORK_TIMEOUT_SECONDS) as response:
            targets = json.loads(response.read().decode("utf-8"))
        pages = [t for t in targets if t.get("type") == "page"]
        if not pages:
            return False
        ws_url = pages[0]["webSocketDebuggerUrl"]
        request = json.dumps({
            "id": 1,
            "method": "Page.setBackgroundColorOverride",
            "params": {"color": BG_COLOR},
        })
        _ws_request(ws_url, request)
        return True
    except (urllib.error.URLError, OSError, ValueError, KeyError, IndexError):
        return False


def main() -> None:
    deadline = time.time() + TIMEOUT_SECONDS
    while time.time() < deadline:
        if try_apply_once():
            return
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
