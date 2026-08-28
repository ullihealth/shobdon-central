#!/usr/bin/env python3
"""ONE-OFF diagnostic - run this directly on the Pi over SSH:

    python3 trace-refresh-requests.py

Attaches to the kiosk's ALREADY-RUNNING Chromium tab via Chrome DevTools
Protocol (the same --remote-debugging-port=9222 kiosk-watchdog.py already
uses) and prints a live, timestamped log of every network request the
page makes matching /api/public/config or /refresh-check - the two
requests RemoteRefreshWatcher.tsx's poll loop makes every ~12 seconds.

WHY THIS EXISTS: four independent, evidence-backed fixes today (a secret
mismatch, a competing-consumer race, and others) each looked like the
root cause and each turned out not to fully explain a real tenant save
still not refreshing Meg's Cafe's display. Server-side logging alone
cannot show whether the KIOSK'S OWN poll loop is actually running,
finding the right target, or making requests at all - only watching the
real, already-running browser tab from the inside can. This is exactly
that: no simulation, no local dev server, no synthetic Chrome instance -
the actual kiosk tab, live.

Runs for TRACE_DURATION_SECONDS (default 5 minutes) and exits on its
own, or Ctrl+C to stop early. Prints one line per matching request and
one line per matching response (with status), plus a period heartbeat
line if NOTHING relevant happens for a while, so "silence" is
distinguishable from "script died" at a glance.

Does not modify anything - purely observes. Safe to run repeatedly.
"""

from __future__ import annotations

import json
import os
import socket
import struct
import sys
import time
import urllib.request
from urllib.parse import urlparse

CDP_HOST = "127.0.0.1"
CDP_PORT = 9222
TRACE_DURATION_SECONDS = 5 * 60
NETWORK_TIMEOUT_SECONDS = 5
HEARTBEAT_INTERVAL_SECONDS = 30
WATCH_URL_SUBSTRINGS = ("/api/public/config", "/refresh-check")

try:
    import websocket as _websocket_client  # type: ignore

    def _connect(ws_url: str):
        return _websocket_client.create_connection(ws_url, timeout=NETWORK_TIMEOUT_SECONDS)

    _WS_BACKEND = "websocket-client"

except ImportError:

    class _MinimalWebSocket:
        def __init__(self, url: str, timeout: float):
            parsed = urlparse(url)
            self.host = parsed.hostname
            self.port = parsed.port or 80
            self.path = parsed.path + (f"?{parsed.query}" if parsed.query else "")
            self.timeout = timeout
            self.sock = socket.create_connection((self.host, self.port), timeout=timeout)
            self.sock.settimeout(timeout)
            self._handshake()

        def _handshake(self) -> None:
            import base64

            key = base64.b64encode(os.urandom(16)).decode()
            request = (
                f"GET {self.path} HTTP/1.1\r\n"
                f"Host: {self.host}:{self.port}\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Key: {key}\r\n"
                "Sec-WebSocket-Version: 13\r\n"
                "\r\n"
            )
            self.sock.sendall(request.encode())
            data = b""
            while b"\r\n\r\n" not in data:
                chunk = self.sock.recv(4096)
                if not chunk:
                    raise ConnectionError("Connection closed during WebSocket handshake")
                data += chunk
            if b"101" not in data.split(b"\r\n", 1)[0]:
                raise ConnectionError(f"WebSocket handshake failed: {data[:200]!r}")

        def send(self, message: str) -> None:
            payload = message.encode("utf-8")
            length = len(payload)
            mask_key = os.urandom(4)
            masked = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
            header = bytearray([0x81])
            if length <= 125:
                header.append(0x80 | length)
            elif length <= 0xFFFF:
                header.append(0x80 | 126)
                header += struct.pack(">H", length)
            else:
                header.append(0x80 | 127)
                header += struct.pack(">Q", length)
            header += mask_key
            self.sock.sendall(bytes(header) + masked)

        def recv(self) -> str:
            payload = b""
            while True:
                first2 = self._recv_exact(2)
                fin = first2[0] & 0x80
                opcode = first2[0] & 0x0F
                masked = first2[1] & 0x80
                length = first2[1] & 0x7F
                if length == 126:
                    length = struct.unpack(">H", self._recv_exact(2))[0]
                elif length == 127:
                    length = struct.unpack(">Q", self._recv_exact(8))[0]
                mask_key = self._recv_exact(4) if masked else None
                frame_payload = self._recv_exact(length)
                if mask_key:
                    frame_payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(frame_payload))
                if opcode == 0x8:
                    raise ConnectionError("WebSocket closed by peer")
                payload += frame_payload
                if fin:
                    break
            return payload.decode("utf-8")

        def _recv_exact(self, n: int) -> bytes:
            data = b""
            while len(data) < n:
                chunk = self.sock.recv(n - len(data))
                if not chunk:
                    raise ConnectionError("Connection closed unexpectedly")
                data += chunk
            return data

        def close(self) -> None:
            try:
                self.sock.close()
            except OSError:
                pass

    def _connect(ws_url: str):
        return _MinimalWebSocket(ws_url, NETWORK_TIMEOUT_SECONDS)

    _WS_BACKEND = "hand-rolled fallback (websocket-client not installed)"


def _ts() -> str:
    return time.strftime("%H:%M:%S", time.localtime())


def get_page_target() -> dict:
    url = f"http://{CDP_HOST}:{CDP_PORT}/json"
    with urllib.request.urlopen(url, timeout=NETWORK_TIMEOUT_SECONDS) as response:
        targets = json.loads(response.read().decode("utf-8"))
    pages = [t for t in targets if t.get("type") == "page"]
    if not pages:
        raise RuntimeError("no CDP 'page' target found - is Chromium actually running?")
    if len(pages) > 1:
        print(f"[{_ts()}] WARNING: found {len(pages)} page targets, using the first: {[p.get('url') for p in pages]}")
    return pages[0]


def main() -> None:
    print(f"kiosk network trace starting (WebSocket backend: {_WS_BACKEND})")
    target = get_page_target()
    print(f"[{_ts()}] attached to page: {target.get('url')}")
    print(f"[{_ts()}] watching for requests containing: {WATCH_URL_SUBSTRINGS}")
    print(f"[{_ts()}] running for {TRACE_DURATION_SECONDS}s (Ctrl+C to stop early)\n")

    ws = _connect(target["webSocketDebuggerUrl"])
    ws.send(json.dumps({"id": 1, "method": "Network.enable"}))
    # Drain the Network.enable ack before entering the event loop.
    ws.recv()

    start = time.time()
    last_activity = start
    request_id_to_url: dict[str, str] = {}

    try:
        while time.time() - start < TRACE_DURATION_SECONDS:
            try:
                raw = ws.recv()
            except Exception as error:  # noqa: BLE001 - deliberately broad, this is a diagnostic loop
                print(f"[{_ts()}] WebSocket read failed: {type(error).__name__}: {error} - reconnecting...")
                ws.close()
                time.sleep(2)
                target = get_page_target()
                ws = _connect(target["webSocketDebuggerUrl"])
                ws.send(json.dumps({"id": 1, "method": "Network.enable"}))
                ws.recv()
                continue

            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                continue

            method = message.get("method")
            params = message.get("params", {})

            if method == "Network.requestWillBeSent":
                req_url = params.get("request", {}).get("url", "")
                if any(sub in req_url for sub in WATCH_URL_SUBSTRINGS):
                    last_activity = time.time()
                    request_id_to_url[params.get("requestId")] = req_url
                    print(f"[{_ts()}] -> REQUEST  {req_url}")

            elif method == "Network.responseReceived":
                req_id = params.get("requestId")
                if req_id in request_id_to_url:
                    last_activity = time.time()
                    status = params.get("response", {}).get("status")
                    print(f"[{_ts()}] <- RESPONSE {status} {request_id_to_url[req_id]}")

            elif method == "Network.loadingFailed":
                req_id = params.get("requestId")
                if req_id in request_id_to_url:
                    last_activity = time.time()
                    print(f"[{_ts()}] <- FAILED  {params.get('errorText')} {request_id_to_url[req_id]}")

            if time.time() - last_activity > HEARTBEAT_INTERVAL_SECONDS:
                print(f"[{_ts()}] ...no matching requests in the last {HEARTBEAT_INTERVAL_SECONDS}s (still watching, connection alive)")
                last_activity = time.time()

    except KeyboardInterrupt:
        print(f"\n[{_ts()}] stopped by user")
    finally:
        ws.close()
        print(f"[{_ts()}] trace ended")


if __name__ == "__main__":
    main()
