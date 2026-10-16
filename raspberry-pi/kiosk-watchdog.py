#!/usr/bin/env python3
"""Kiosk blank-render watchdog - installed at
~/.config/systemd/user/kiosk-watchdog.py on the Pi, run by its own
kiosk-watchdog.service (separate unit from kiosk.service - see that
file's own comment for why they must be independent).

WHY THIS EXISTS: kiosk.service's Restart=always only recovers a Chromium
that actually exits. It cannot see the failure this watchdog targets -
confirmed on real hardware: Chromium launches, the process stays alive
and stable (no crash, no restart counter increment), CPU/GPU load stays
near-idle, case temperature stays cool (video is NOT playing) - yet the
page renders blank white and never recovers on its own. The existing
double-launch in kiosk-wrapper.sh is a DIFFERENT, already-diagnosed
boot-time race (Wayland socket/GPU-context timing) and does not reliably
catch this one.

HOW: polls Chrome DevTools Protocol (kiosk-wrapper.sh's own
--remote-debugging-port=9222, loopback-only) and asks the page itself,
via Runtime.evaluate, whether KioskRenderMarker.tsx's DOM marker
(document.documentElement.dataset.kioskRenderOk) is set. That marker is
set once, unconditionally, the instant React has mounted ANYTHING (see
that component's own comment for why it's app-shell-level, not gated on
any specific page's data) - so "marker absent, well past every plausible
load time" means Chromium's own first paint never completed, exactly the
diagnosed failure. A process-aliveness check can never see this; asking
the page itself can.

Requires N CONSECUTIVE failed checks (not one) before acting, and a
startup/post-restart grace period, so a slow-but-healthy load is never
mistaken for the stuck state - see the constants below for the exact
numbers and why.

Runs forever (systemd Restart=always on kiosk-watchdog.service itself
handles the case where this script dies), independent of kiosk.service's
own lifecycle - restarting the kiosk must never take this watchdog down
with it, or a second stuck-render episode right after the first restart
would go undetected.

FALSE-POSITIVE ROUND (2026-08-28): a real incident on the Meg's Cafe Pi -
confirmed root cause was CDP target ambiguity, not a logic bug in the
render check itself. Meg's Cafe's media carousel includes a "website"
slot embedding another tenant's live dashboard as a cross-origin
<iframe> (MediaSlotRenderer.tsx's 'website' case) - that embedded page is
itself a full instance of THIS SAME app, with its own copy of
KioskRenderMarker's DOM marker on ITS OWN document, and Chromium's site
isolation can surface it as its own CDP target indistinguishable from the
real kiosk page by `type` alone. _get_page_target() now cross-checks
candidate targets' origin against the kiosk's own DASHBOARD_URL (read
from the same tenant-config.txt kiosk-wrapper.sh uses) instead of blindly
taking the first "page"-typed target, and every check now logs which URL
it actually ran against - see that function's own comment for the full
story.

BOOT-PHASE ROUND (2026-08-29): a real cold-boot incident took ~2 minutes
of customer-visible blank/broken screen to detect and recover from, using
one flat conservative cadence from startup - the wrong tradeoff for the
one window where the diagnosed stuck-first-paint race is actually likely
to occur. Two changes, plus one in kiosk-wrapper.sh:
1. This script now uses a much faster check interval/failure threshold
   for a "boot phase" that starts on launch and after every restart it
   performs, falling back to the original conservative numbers the
   instant any check succeeds - see BOOT_PHASE_* constants below.
2. _get_page_target() now retries once, a couple of seconds later,
   before concluding the kiosk's own page target is genuinely missing -
   CDP's own target list is independently documented as briefly
   incomplete right after a fresh launch, and a real incident's logs
   showed exactly that transient miss, not a persistent one.
3. kiosk-wrapper.sh itself now waits for the tenant's own dashboard URL
   to be network-reachable before launching Chromium at all, since a
   real incident's "page target origin mismatch" symptom is also fully
   consistent with Chromium navigating before WiFi/DNS was ready and
   landing on its own internal error page - a separate, more mundane,
   more fixable cause than the GPU/first-paint race, addressed at the
   source rather than papered over by faster detection alone.
Root-cause elimination of the underlying Chromium/labwc/Wayland stuck-
first-paint race itself remains an open, unsolved problem community-wide
(see kiosk-wrapper.sh's own comment) - these changes shrink the window
and fix one of two suspected contributing causes, not eliminate the race.
"""

# PEP 563 - defers every type annotation in this file to a lazy string,
# never evaluated at runtime. Needed for `str | None`/`socket.socket |
# None` style annotations below to be safe on Python 3.9 (Raspberry Pi OS
# Bookworm ships 3.11, where this wouldn't matter, but this was caught by
# actually running this file on an older Python during testing - a
# function's RETURN annotation, unlike a local variable's, is evaluated
# eagerly at def-time regardless of Python version, so `-> str | None`
# without this import hard-crashes on import under 3.9/3.8).
from __future__ import annotations

import json
import logging
import os
import re
import socket
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse

# ── Tuning ───────────────────────────────────────────────────────────────
CDP_HOST = "127.0.0.1"
CDP_PORT = 9222
# Same file kiosk-wrapper.sh itself reads DASHBOARD_URL from - read here
# too (false-positive round, 2026-08-28) so this watchdog can tell the
# kiosk's own top-level page apart from a cross-origin <iframe> a café
# carousel "website" slot embeds INSIDE that page (MediaSlotRenderer.tsx's
# 'website' case, sandbox="allow-scripts allow-same-origin" - scripts DO
# run in there). Confirmed root cause of a real false-positive incident:
# Meg's Cafe embeds https://shobdon.airfieldcentral.com/ as a carousel
# slot - itself a full instance of this same app, with its own copy of
# KioskRenderMarker's DOM marker on ITS OWN document. Site-isolation can
# surface that iframe as its OWN CDP target, indistinguishable from the
# real kiosk page by type alone - picking pages[0] blindly (the original
# version of this script) could non-deterministically land on the
# embedded page instead of the real one, correctly-but-misleadingly
# reading ITS transient reload/absence as "the kiosk is blank" while the
# real page was fine the whole time.
TENANT_CONFIG_FILE = "/home/admin/tenant-config.txt"
# How often to ask the page whether it's actually rendered, once STEADY
# STATE has been reached (see BOOT_PHASE_* below for the faster cadence
# used right after a startup/restart) - conservative on purpose, since a
# false-positive restart during ordinary long-running operation is worse
# than a slightly slower recovery from a genuine steady-state failure.
CHECK_INTERVAL_SECONDS = 20
# Consecutive failed checks required before restarting, in steady state -
# 3 * 20s = 60s of sustained bad state. Deliberately not 1: a single
# missed/slow check (Chromium mid-navigation, a brief CDP hiccup) must
# never trigger a restart on its own - only a genuinely stuck state,
# sustained across several checks, should.
FAILURE_THRESHOLD = 3

# Boot-phase round (2026-08-29): a real cold-boot incident took ~2 minutes
# of customer-visible blank/broken screen to detect and recover from,
# using the steady-state numbers above applied uniformly from startup.
# That's the wrong tradeoff for the FIRST couple of minutes after a
# startup or restart specifically - this is exactly the window where the
# diagnosed stuck-first-paint race (kiosk-wrapper.sh's own double-launch
# target) is most likely to actually occur, so detection should be FAST
# here, at the cost of being less conservative about false positives -
# unlike mid-shift steady-state operation, where a brief flaky check
# should almost never mean anything's really wrong and a restart would
# just be disruptive. Confirmed via community research that ~20-30s after
# launch is roughly what labwc+Chromium typically need on this hardware
# class (a Raspberry Pi Forums thread on the same white-screen-on-labwc-
# autostart symptom found a fixed 30s wait sufficient) - this doesn't
# eliminate the underlying race (no known fix does - see kiosk-wrapper.sh's
# own comment), it just detects and recovers from it far faster than the
# steady-state numbers would.
#
# Boot phase ends (falls back to steady-state cadence above) the moment
# ANY check succeeds - the earliest legitimate signal the kiosk is
# actually healthy - and re-engages from scratch after every restart this
# script performs, since a restart re-runs the exact same risky launch
# sequence again.
BOOT_PHASE_INITIAL_SILENCE_SECONDS = 20
BOOT_PHASE_CHECK_INTERVAL_SECONDS = 5
# 4 * 5s = 20s of sustained bad state - much shorter than steady state's
# 60s, deliberately: this is the window where fast recovery matters most,
# and kiosk-wrapper.sh's own double-launch has already used its one
# internal retry by the time boot phase's initial silence elapses, so a
# sustained failure here has already survived that mitigation.
BOOT_PHASE_FAILURE_THRESHOLD = 4
# Grace period after a restart THIS SCRIPT triggers, before boot-phase
# checking resumes - shorter than the old blanket 60s (evidence above),
# long enough to cover kiosk-wrapper.sh's own double-launch (kill at 15s,
# relaunch immediately after).
POST_RESTART_SILENCE_SECONDS = 20

# Bounds every individual HTTP/WebSocket operation - a hung Chromium must
# never hang THIS script indefinitely (which would silently stop the one
# thing meant to recover from exactly that).
NETWORK_TIMEOUT_SECONDS = 5

RENDER_CHECK_EXPRESSION = "document.documentElement.dataset.kioskRenderOk === 'true'"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s kiosk-watchdog %(levelname)s: %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("kiosk-watchdog")

# ── WebSocket client ─────────────────────────────────────────────────────
# Chrome DevTools Protocol's plain-HTTP endpoints (used below for /json)
# only list targets - actually running Runtime.evaluate against a page
# requires a real WebSocket connection. Prefer the `websocket-client`
# package (Debian/Raspberry Pi OS package: python3-websocket-client) if
# it's installed; fall back to a minimal hand-rolled RFC6455 client
# otherwise, so this watchdog has zero hard dependency beyond Python's own
# standard library. The fallback deliberately supports only what a single
# synchronous request/response text round-trip against a local, trusted
# DevTools endpoint needs - no fragmentation, no ping/pong, no compression.
try:
    import websocket as _websocket_client  # type: ignore

    def _ws_request(ws_url: str, message: str) -> str:
        ws = _websocket_client.create_connection(ws_url, timeout=NETWORK_TIMEOUT_SECONDS)
        try:
            ws.send(message)
            return ws.recv()
        finally:
            ws.close()

    _WS_BACKEND = "websocket-client"
    # Boot-chaos round (2026-08-28): a real reboot produced a genuine
    # WebSocketTimeoutException out of ws.recv() (confirmed against this
    # library's own source - every websocket._exceptions class, including
    # WebSocketTimeoutException/WebSocketConnectionClosedException/
    # WebSocketBadStatusException etc., inherits from this one common
    # WebSocketException base) that the main loop's except tuple didn't
    # catch, crashing this script outright instead of logging one normal
    # failed check. systemd's own Restart=always on kiosk-watchdog.service
    # caught the crash and relaunched it - the incident self-recovered -
    # but that's a worse, slower recovery path than intended: a CDP
    # connection timing out during real boot chaos is an ENTIRELY expected
    # transient condition here, not an exceptional one, and should count
    # toward FAILURE_THRESHOLD like any other failed check, never crash
    # the process. Spliced into the main loop's except tuple below -
    # empty in the hand-rolled fallback branch (nothing to add there; its
    # own timeouts/closures already surface as OSError/ConnectionError,
    # both already caught).
    _WS_EXCEPTIONS = (_websocket_client.WebSocketException,)

except ImportError:

    class _MinimalWebSocket:
        def __init__(self, url: str, timeout: float):
            parsed = urlparse(url)
            self.host = parsed.hostname
            self.port = parsed.port or 80
            self.path = parsed.path + (f"?{parsed.query}" if parsed.query else "")
            self.timeout = timeout
            self.sock: socket.socket | None = None

        def connect(self) -> None:
            self.sock = socket.create_connection((self.host, self.port), timeout=self.timeout)
            self.sock.settimeout(self.timeout)
            key = os.urandom(16)
            import base64

            request = (
                f"GET {self.path} HTTP/1.1\r\n"
                f"Host: {self.host}:{self.port}\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Key: {base64.b64encode(key).decode()}\r\n"
                "Sec-WebSocket-Version: 13\r\n"
                "\r\n"
            )
            self.sock.sendall(request.encode())
            response = self._recv_until_headers_end()
            status_line = response.split(b"\r\n", 1)[0]
            if b"101" not in status_line:
                raise ConnectionError(f"WebSocket handshake failed: {status_line!r}")

        def _recv_until_headers_end(self) -> bytes:
            data = b""
            while b"\r\n\r\n" not in data:
                chunk = self.sock.recv(4096)
                if not chunk:
                    raise ConnectionError("Connection closed during WebSocket handshake")
                data += chunk
            return data

        def send(self, message: str) -> None:
            payload = message.encode("utf-8")
            length = len(payload)
            mask_key = os.urandom(4)
            masked = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
            header = bytearray([0x81])  # FIN + text frame opcode
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

    def _ws_request(ws_url: str, message: str) -> str:
        ws = _MinimalWebSocket(ws_url, NETWORK_TIMEOUT_SECONDS)
        ws.connect()
        try:
            ws.send(message)
            return ws.recv()
        finally:
            ws.close()

    _WS_BACKEND = "hand-rolled fallback (websocket-client not installed)"
    # Nothing library-specific to add here - this backend's own timeouts/
    # closures already raise plain socket.timeout (an OSError subclass) or
    # ConnectionError, both already in the main loop's except tuple. Kept
    # as an empty tuple (not omitted) so the main loop can unconditionally
    # splice `*_WS_EXCEPTIONS` in regardless of which backend loaded,
    # without an `if` - one code path, always correct.
    _WS_EXCEPTIONS = ()


# ── Render check ─────────────────────────────────────────────────────────
# Matches kiosk-wrapper.sh's own `source "$CONFIG_FILE"` just closely
# enough for this one variable - a real `source` isn't available from
# Python, and a plain KEY=VALUE line (optionally quoted) is the entire
# shape personalize-tenant.sh ever writes for DASHBOARD_URL, so a targeted
# regex is simpler and safer than pulling in a shell-parsing dependency.
_DASHBOARD_URL_RE = re.compile(r'^\s*DASHBOARD_URL\s*=\s*["\']?([^"\'\s]+)["\']?\s*$', re.MULTILINE)


def _read_dashboard_url() -> str | None:
    try:
        with open(TENANT_CONFIG_FILE, encoding="utf-8") as f:
            contents = f.read()
    except OSError as error:
        log.warning("could not read %s to resolve the kiosk's own origin (%s) - falling back to picking any page target", TENANT_CONFIG_FILE, error)
        return None
    match = _DASHBOARD_URL_RE.search(contents)
    if not match:
        log.warning("DASHBOARD_URL not found in %s - falling back to picking any page target", TENANT_CONFIG_FILE)
        return None
    return match.group(1)


def _origin(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}"


# Boot-phase round: CDP's own target list is independently documented as
# briefly incomplete right after a fresh launch (the HTTP /json endpoint
# can answer before the real navigation's target has fully registered) -
# a real incident's logs showed this exact symptom (origin-match falling
# back to "no match found") recurring across two consecutive checks
# shortly after a restart. One short in-cycle retry, distinct from the
# main loop's own consecutive-failure counting, absorbs a transient
# listing gap without spending one of the (now much shorter, boot-phase)
# failure-threshold slots on a race that resolves within a couple of
# seconds - the outer counting still applies if the target is genuinely,
# persistently missing.
_TARGET_LOOKUP_RETRY_DELAY_SECONDS = 2


def _find_matching_page(pages: list[dict], expected_origin: str) -> dict | None:
    matches = [t for t in pages if _origin(t.get("url", "")) == expected_origin]
    if not matches:
        return None
    if len(matches) > 1:
        log.warning("multiple page targets matched the kiosk's own origin (%s) - using the first: %s", expected_origin, [t.get("url") for t in matches])
    return matches[0]


def _list_page_targets() -> list[dict]:
    url = f"http://{CDP_HOST}:{CDP_PORT}/json"
    with urllib.request.urlopen(url, timeout=NETWORK_TIMEOUT_SECONDS) as response:
        targets = json.loads(response.read().decode("utf-8"))
    return [t for t in targets if t.get("type") == "page"]


def _get_page_target() -> dict:
    pages = _list_page_targets()
    if not pages:
        raise RuntimeError("no CDP 'page' target found")

    dashboard_url = _read_dashboard_url()
    if dashboard_url:
        expected_origin = _origin(dashboard_url)
        match = _find_matching_page(pages, expected_origin)
        if match:
            return match

        # No match on the first attempt - retry once after a short delay
        # before concluding anything's actually wrong (see this function's
        # own comment above). Re-fetches the target list fresh, since the
        # whole point is that it may have settled by now.
        time.sleep(_TARGET_LOOKUP_RETRY_DELAY_SECONDS)
        pages = _list_page_targets()
        if not pages:
            raise RuntimeError("no CDP 'page' target found (after retry)")
        match = _find_matching_page(pages, expected_origin)
        if match:
            log.info("page target matched the kiosk's own origin (%s) on retry, after an initial miss", expected_origin)
            return match

        # Still no match after the retry - most likely mid-navigation (a
        # moment where the real page briefly isn't the current top-level
        # document yet), or a genuine problem (e.g. a network error page
        # with a different origin). Logged with full detail specifically
        # because this is the exact ambiguity that caused a real false-
        # positive incident (an embedded cross-origin <iframe> - a café
        # carousel "website" slot - being indistinguishable from the real
        # kiosk page by type alone); a plain "not ok" with no detail was
        # not enough to diagnose that from the logs alone.
        log.warning(
            "no page target matched the kiosk's own origin (%s) after retry - falling back to the first of %d page target(s): %s",
            expected_origin,
            len(pages),
            [(t.get("type"), t.get("url")) for t in pages],
        )

    # Kiosk mode is a single window/tab - if more than one page target
    # exists and none could be matched to the kiosk's own configured
    # origin above (missing/unreadable tenant-config.txt), the first is
    # as good a guess as any, logged rather than silently assumed correct.
    if len(pages) > 1:
        log.warning("expected exactly one CDP page target, found %d - using the first: %s", len(pages), [(t.get("type"), t.get("url")) for t in pages])
    return pages[0]


def is_render_ok() -> bool:
    target = _get_page_target()
    ws_url = target["webSocketDebuggerUrl"]
    request = json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {"expression": RENDER_CHECK_EXPRESSION, "returnByValue": True}})
    raw_response = _ws_request(ws_url, request)
    response = json.loads(raw_response)
    if response.get("id") != 1:
        raise RuntimeError(f"unexpected CDP response from {target.get('url')!r}: {raw_response[:200]!r}")
    if "error" in response:
        raise RuntimeError(f"CDP Runtime.evaluate error against {target.get('url')!r}: {response['error']}")
    result = bool(response["result"]["result"]["value"])
    # Logged on every check (not just failures) - deliberately verbose:
    # this exact "which URL did the check actually run against" detail is
    # what a real false-positive incident (2026-08-28) was missing from
    # the logs, and log volume at one line/20s is negligible.
    log.info("render check against %s: %s", target.get("url"), result)
    return result


# ── Recovery ─────────────────────────────────────────────────────────────
def restart_kiosk() -> None:
    log.critical("blank-render detected (%d consecutive failed checks) - restarting kiosk.service", FAILURE_THRESHOLD)
    try:
        result = subprocess.run(
            ["systemctl", "--user", "restart", "kiosk.service"],
            capture_output=True,
            text=True,
        )
    except OSError as error:
        # Covers a missing/misconfigured systemctl binary (e.g. a broken
        # PATH under this unit's own environment) - must not crash this
        # loop over it. kiosk-watchdog.service's own Restart=always would
        # eventually relaunch a crashed script anyway, but logging a clear
        # reason here beats a bare traceback, and staying alive means the
        # very next check can still try again rather than losing an
        # entire restart cycle to the crash-and-relaunch delay.
        log.error("could not invoke systemctl (%s: %s) - is it on PATH for this --user service?", type(error).__name__, error)
        return
    if result.returncode != 0:
        log.error("systemctl restart kiosk.service failed (exit %d): %s", result.returncode, result.stderr.strip())
    else:
        log.info("kiosk.service restart issued successfully")


# ── Main loop ────────────────────────────────────────────────────────────
def main() -> None:
    log.info("kiosk-watchdog starting (WebSocket backend: %s)", _WS_BACKEND)
    log.info("boot-phase initial silence: %ds", BOOT_PHASE_INITIAL_SILENCE_SECONDS)
    time.sleep(BOOT_PHASE_INITIAL_SILENCE_SECONDS)

    # True from startup, and again after every restart this script
    # performs, until the first successful check - see BOOT_PHASE_* above
    # for why this window uses a faster, less conservative cadence than
    # steady state.
    boot_phase = True
    consecutive_failures = 0
    while True:
        check_interval = BOOT_PHASE_CHECK_INTERVAL_SECONDS if boot_phase else CHECK_INTERVAL_SECONDS
        failure_threshold = BOOT_PHASE_FAILURE_THRESHOLD if boot_phase else FAILURE_THRESHOLD

        try:
            ok = is_render_ok()
        except (urllib.error.URLError, OSError, ConnectionError, RuntimeError, ValueError, KeyError, *_WS_EXCEPTIONS) as error:
            ok = False
            log.warning("render check failed (%s: %s)", type(error).__name__, error)

        if ok:
            if consecutive_failures > 0:
                log.info("render check recovered after %d failed check(s)", consecutive_failures)
            if boot_phase:
                log.info("boot phase complete - first successful check, switching to steady-state cadence")
                boot_phase = False
            consecutive_failures = 0
        else:
            consecutive_failures += 1
            log.warning(
                "render check: not ok (%d/%d consecutive, %s)",
                consecutive_failures,
                failure_threshold,
                "boot phase" if boot_phase else "steady state",
            )

        if consecutive_failures >= failure_threshold:
            restart_kiosk()
            consecutive_failures = 0
            # A restart re-runs kiosk-wrapper.sh's own risky double-launch
            # sequence from scratch, so this re-enters boot phase rather
            # than trusting whatever cadence was active before - if we
            # were already in boot phase, this is a second consecutive
            # failed recovery and staying on the fast cadence is still
            # correct; if we were in steady state, a restart there is
            # itself a fresh launch that deserves the same fast scrutiny
            # a cold boot would get.
            boot_phase = True
            log.info("post-restart silence: %ds", POST_RESTART_SILENCE_SECONDS)
            time.sleep(POST_RESTART_SILENCE_SECONDS)
            continue

        time.sleep(check_interval)


if __name__ == "__main__":
    main()
