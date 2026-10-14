# Raspberry Pi kiosk provisioning

Files for the Pi 4 kiosk displays (Chromium in kiosk mode, showing a
tenant's dashboard). One master SD card image now works for every
tenant - only `tenant-config.txt` differs between Pis.

## Files

- **`kiosk.service`** - systemd `--user` unit. Goes at
  `~/.config/systemd/user/kiosk.service` on the Pi. Deliberately a
  `--user` service, not labwc autostart - see the comment inside for why.
- **`kiosk-wrapper.sh`** - the actual launch script `kiosk.service` runs.
  Reads the dashboard URL from `/home/admin/tenant-config.txt`, waits for
  that URL to actually be network-reachable (2026-08-29 - a real incident
  showed Chromium can navigate before WiFi/DNS is ready and land on its
  own internal error page instead, which is a separate, fixable cause
  from the GPU/first-paint race below; capped at 30s so a genuinely
  offline Pi still launches and lets the double-launch/watchdog take
  over), then does the double-launch (launch, wait 15s, kill, relaunch)
  that real power-cycle boots need. **Do not simplify this file** - the
  comments inside explain why each piece exists; it was arrived at
  through extensive live debugging on real hardware, not written
  speculatively.
- **`kiosk-watchdog.py`** - long-running blank-render watchdog. Goes at
  `~/.config/systemd/user/kiosk-watchdog.py`, run by its own
  `kiosk-watchdog.service` (separate unit - see that file's own comment
  for why). Polls Chrome DevTools Protocol (`kiosk-wrapper.sh`'s
  `--remote-debugging-port=9222`) asking the page itself, via
  `KioskRenderMarker.tsx`'s DOM marker, whether it actually rendered -
  catches the failure mode where Chromium stays alive and stable but the
  page is blank white and never recovers, which `kiosk.service`'s own
  `Restart=always` cannot see (the process never exits). Self-heals with
  `systemctl --user restart kiosk.service` after N consecutive failed
  checks. Uses a fast "boot phase" cadence (every 5s, 4 failures = 20s of
  sustained bad state, 20s initial/post-restart silence) from startup and
  after every restart, falling back to a conservative steady-state
  cadence (every 20s, 3 failures = 60s) the instant any check succeeds -
  added 2026-08-29 after a real incident took ~2 minutes to detect and
  recover from using one flat conservative cadence throughout. Zero human
  involvement required once running.
- **`kiosk-watchdog.service`** - its systemd `--user` unit. Independent
  of `kiosk.service` on purpose (see its own comment) - restarting the
  kiosk must never take the watchdog down with it.
- **`personalize-tenant.sh`** - run this once over SSH on a freshly
  flashed card to turn the generic master image into a specific tenant's
  Pi. See below.
- **`hide-cursor.sh`** - run this once over SSH on any kiosk Pi to
  permanently hide the mouse pointer on the kiosk display (OS/compositor
  level only - never touches the web app). See "Hiding the mouse cursor"
  below.

## One-time master image setup (already done on the current SD card)

```
mkdir -p ~/.config/systemd/user
cp kiosk.service ~/.config/systemd/user/kiosk.service
cp kiosk-wrapper.sh ~/.config/systemd/user/kiosk-wrapper.sh
chmod +x ~/.config/systemd/user/kiosk-wrapper.sh
cp kiosk-watchdog.service ~/.config/systemd/user/kiosk-watchdog.service
cp kiosk-watchdog.py ~/.config/systemd/user/kiosk-watchdog.py
chmod +x ~/.config/systemd/user/kiosk-watchdog.py
cp personalize-tenant.sh ~/personalize-tenant.sh
chmod +x ~/personalize-tenant.sh
systemctl --user enable kiosk.service
systemctl --user enable kiosk-watchdog.service
sudo apt install fonts-noto-color-emoji   # Met Office ticker glyphs

# Blank-render watchdog: prefer the apt package (avoids PEP 668's
# "externally managed environment" block on a bare pip3 install on
# Raspberry Pi OS Bookworm). kiosk-watchdog.py auto-detects and falls
# back to a hand-rolled WebSocket client if this isn't available - only
# the WebSocket backend changes, never the watchdog's actual behaviour.
sudo apt install python3-websocket-client
```

The master image should ship with **no** `tenant-config.txt` present
(kiosk-wrapper.sh detects this and fails with a clear message instead of
starting Chromium with no URL) - `personalize-tenant.sh` is what creates
it.

## Master image distribution

**v1 (current, in use now)**: manual shrink + compress + Dropbox. No
Cloudflare involvement at all - this exists so the actual onboarding
pipeline (generic image + `personalize-tenant.sh`) isn't blocked on
hosting infrastructure Jeff isn't ready to commit to yet.

1. Shrink the raw `.img` before compressing - PiShrink needs Linux
   tooling (`losetup`, `resize2fs`) that doesn't exist on macOS, so run
   it inside a privileged Docker container (Docker Desktop for Mac runs
   a real Linux VM under the hood, which is what makes loop devices work
   here at all):
   ```
   docker run --rm --privileged \
     -v "$(pwd)":/work -w /work \
     ubuntu:22.04 bash -c "
       apt-get update && apt-get install -y wget parted e2fsprogs util-linux &&
       wget -O /usr/local/bin/pishrink.sh https://raw.githubusercontent.com/Drewsif/PiShrink/master/pishrink.sh &&
       chmod +x /usr/local/bin/pishrink.sh &&
       pishrink.sh -v master.img master-shrunk.img
     "
   ```
   If Docker isn't installed/available, it's fine to skip this step and
   compress the raw `master.img` directly (next step) - `xz` already
   compresses large stretches of unused/zero-filled space very
   efficiently on its own, so skipping the shrink mainly costs some
   final file size and compression time, not correctness.

2. Compress to `.img.xz` - this part runs natively on macOS, no Docker
   needed (`brew install xz` once, if not already present):
   ```
   xz -9 -e -T0 -v master-shrunk.img
   ```
   (`-9 -e` = max/extreme compression, `-T0` = use all CPU cores,
   `-v` = show progress - this can take a while on a multi-GB file,
   that's expected). Produces `master-shrunk.img.xz` alongside the
   input. `.img.xz` specifically (not `.img.gz`) because Raspberry Pi
   Imager's "Use custom" flashes directly from `.xz` with no manual
   decompression step - it's the same format official Raspberry Pi OS
   downloads already ship in.

3. Upload `master-shrunk.img.xz` to Dropbox and generate a share link -
   manual, no automation, done directly in Dropbox.

4. To flash a new card: Raspberry Pi Imager -> "Choose OS" -> "Use
   custom" -> point it at the downloaded `.img.xz` (works on any Mac,
   not just Jeff's - that was the actual requirement, and Dropbox
   satisfies it just as well as R2 would for now).

**v2 (planned, not started)**: Cloudflare R2 (private bucket) + a custom
subdomain gated by Cloudflare Access (one-time-PIN, Jeff's email only).
Investigated but deliberately paused, not abandoned - see below.

### v2 blocker, for whoever picks this back up

A bucket (`airfieldcentral-pi-images`) and a custom domain
(`pi-images.airfieldcentral.com`) were briefly created and tested while
investigating this, then deleted/removed again once the approach was
paused - nothing Cloudflare-side exists from that attempt today.

**Real finding, worth keeping**: a subdomain of `airfieldcentral.com`
will NOT work for this without touching application code. The zone
already has a wildcard Worker route, `*.airfieldcentral.com/*` ->
`airfield-central` (the main app, resolving tenants by Host header) -
confirmed live that this route wins over an R2 custom domain binding
for the same hostname even once the R2 domain's own SSL cert is fully
active. Any subdomain of `airfieldcentral.com` gets swallowed by the
main app instead of reaching R2.

Options when this gets picked back up (Jeff was mid-decision on which
domains he's keeping at renewal, hence the pause):
- Bind the R2 custom domain + Access to a subdomain of a domain that
  does NOT have this wildcard route - either one of the other existing
  domains already on this Cloudflare account, or a new small dedicated
  domain (e.g. `airfieldcentral-ops.com`) if a clean, on-brand hostname
  is worth ~$10-15/yr.
- Or modify the `airfield-central` Worker itself to bypass/proxy this
  one hostname to R2 - keeps everything on `airfieldcentral.com`, but
  is new app code, which is exactly what the R2+Access approach was
  chosen over a plain authenticated download endpoint to avoid. Only
  worth it if avoiding a second domain matters more than that.

Cost is a non-factor either way once this resumes - R2 storage is
$0.015/GB-month with free egress (verified against Cloudflare's current
published pricing), and the account's first 10GB-month of storage is
free - a shrunk+compressed image will likely fall under that entirely.

## Onboarding a new tenant (every time, on a freshly flashed card)

1. Flash the master image onto a fresh SD card (v1: from the Dropbox
   link above).
2. Boot the Pi, find its IP (or use `raspberrypi.local` before the
   hostname is changed), SSH in as `admin`.
3. Run:
   ```
   ./personalize-tenant.sh
   ```
   and answer the two prompts (dashboard URL, hostname) - or pass them as
   flags, e.g.:
   ```
   ./personalize-tenant.sh --url https://tiger-helicopters-media.airfieldcentral.com --hostname tiger-helicopters
   ```
4. Confirm the summary it prints, and it reboots automatically. The
   kiosk comes up already showing the new tenant's dashboard - nothing
   else to do.

Run `./personalize-tenant.sh --help` for the full flag list (`--dry-run`,
`--yes`, `--no-reboot`).

**If the kiosk doesn't come back after renaming a tenant** (plain Pi
desktop/blank screen instead of the dashboard, and
`journalctl --user -u kiosk.service` or
`sudo journalctl _SYSTEMD_USER_UNIT=kiosk.service` shows "The profile
appears to be in use by another Chromium process ... on another
computer"): Chromium's `SingletonLock` is stamped with the hostname that
was active when it was written, and `kiosk-wrapper.sh`'s double-launch
pattern `SIGKILL`s the first Chromium launch, which skips the clean
shutdown that would otherwise remove it - so a lock left over under the
OLD hostname makes every later launch refuse to start, forever, once the
hostname changes. `personalize-tenant.sh` now clears
`~/.config/chromium/SingletonLock`, `SingletonSocket` and
`SingletonCookie` itself right before it reboots, so this shouldn't come
up again from a normal rename - but if you ever hit it anyway (e.g. after
a manual `raspi-config` hostname change outside this script), the fix is
just to delete those same three files and restart `kiosk.service`.

## Hiding the mouse cursor

The kiosk display should never show a mouse pointer. `hide-cursor.sh`
does this at the OS/compositor level - it never touches the
AirfieldCentral web app, so office and pilot users on normal browsers
keep their cursor as normal.

Why this approach: labwc 0.9.8 (the Wayland compositor this kiosk runs
under) has no native "hide the cursor" option - confirmed via a full
search of `man labwc-config`. The only supported knobs are the
`XCURSOR_*` environment variables. `unclutter` (already installed on the
master image, already referenced in `~/.config/labwc/autostart`) does
**not** work here - it's X11-only and this is a Wayland session.

`hide-cursor.sh` instead builds a fully-transparent Xcursor theme named
`invisible` (every standard cursor shape compiled from one 32x32
all-alpha-zero PNG, via `xcursorgen`) and sets it as `XCURSOR_THEME` in
labwc's own user environment file
(`~/.config/labwc/environment`), then disables the dead `unclutter`
autostart line. It does **not** touch `kiosk.service` - confirmed on the
Meg's Cafe Pi (2026-10-14) that `XCURSOR_THEME`/`XCURSOR_SIZE` set this
way reaches the systemd `--user` manager's own environment
(`systemctl --user show-environment`), which `kiosk.service`'s Chromium
process inherits from since that unit's own `Environment=` line only
overrides `XDG_RUNTIME_DIR`/`WAYLAND_DISPLAY`, not the cursor variables.

Usage (on the Pi, over SSH, same as `personalize-tenant.sh`):
```
./hide-cursor.sh          # apply - safe to re-run, every step is idempotent
./hide-cursor.sh --undo   # revert - restores the pre-fix config from backup
```
Reboot (`sudo reboot`) afterwards either way for the change to take
effect. See the comment block at the top of the script for exactly what
it changes.

## Tested

`personalize-tenant.sh`'s logic (URL/hostname validation and retry,
confirm-or-cancel, file writing, `--dry-run`/`--yes`/`--no-reboot`, and
graceful behavior when `raspi-config` isn't present) was tested directly
- this isn't a Pi, so the actual `raspi-config`/`reboot` calls were
exercised via their absence-handling path, not for real. **Recommend one
real dry-run against an actual Pi before using this for a live tenant
onboarding**, to confirm `raspi-config nonint do_hostname` behaves as
expected on this specific Pi OS version.

`kiosk.service` and `kiosk-wrapper.sh` were both diffed against the
verbatim working files on the live Meg's Cafe Pi (scp'd across on
2026-08-26) and now match exactly - the first reconstruction (from a
prose description, no direct Pi access) had gotten `kiosk.service`
wrong in three places that would have reintroduced the original
auto-start failure (`After=graphical-session.target` instead of
`default.target`, missing `XDG_RUNTIME_DIR`/`WAYLAND_DISPLAY`
environment vars, and an `-e` socket check instead of `-S`) - all three
are now fixed to match the real file. `kiosk-wrapper.sh` matched on
first diff, no changes needed.

A full verified disk image backup of the live, working Pi was also
taken directly (2026-08-26), separate from this repo - **that image,
not these repo files, is the true source of truth going forward** for
anything beyond what's captured here. If the two ever disagree, trust
the image.

**`kiosk-watchdog.py`/`kiosk-watchdog.service`** (2026-08-27) - verified
end-to-end against a real Chrome instance (headless, on a Mac, not a Pi -
see below for what that does and doesn't prove) with the exact
`--remote-debugging-port=9222 --remote-allow-origins=*` flags now in
`kiosk-wrapper.sh`, and the exact `KioskRenderMarker.tsx` marker built and
served from this repo's own `dist/`:
- `is_render_ok()` correctly returned `True` against the real running app
  and `False` against `about:blank` (a genuinely unrendered page) -
  confirms the CDP HTTP target lookup, the hand-rolled WebSocket
  handshake/frame encode-decode, and the `Runtime.evaluate` round-trip
  all work correctly against real Chromium, in both directions.
- The hand-rolled WebSocket fallback specifically was what got exercised
  (no `websocket-client` package was installed in this test environment,
  which happens to mirror a Pi that skipped/failed the apt step) - this
  is the higher-risk, hand-written path, and it's the one that got the
  real test.
- A full simulated loop (short-circuited timings, not the real
  60s/20s/3-failure values) confirmed the complete flow: healthy
  detection across several cycles, then correct accumulation of 3
  consecutive failures after killing Chrome outright, then a correct
  `restart_kiosk()` call.
- Found and fixed via this testing (not by inspection): `restart_kiosk()`
  crashed uncaught (`FileNotFoundError`) if the `systemctl` binary can't
  be invoked - now caught and logged cleanly. Found by literally running
  it on a machine with no `systemctl`, not by reading the code.

**What this does NOT prove, and needs real Pi hardware to confirm**:
whether `apt install python3-websocket-client` actually exists/installs
under that exact name on this Pi's OS version (the script works either
way, but which backend it actually uses in production is unconfirmed);
real double-launch timing interaction (does the first, force-killed
Chromium's port 9222 binding release cleanly before the second launch
binds it, or does the second launch need a brief retry/backoff); whether
`--remote-allow-origins=*` is accepted by whatever Chromium version ships
on the Pi (older versions may not recognise the flag at all - should be a
harmless no-op if so, but unconfirmed); and, most importantly, whether
this actually catches and recovers from the ORIGINAL diagnosed failure
(genuine blank-white stuck paint on a real cold power-cycle boot) rather
than only the failure modes reproducible off-Pi (process killed, page
never navigated). **Recommend leaving a Pi running unattended through
several real power cycles, plus deliberately reproducing tonight's stuck
state if possible, before trusting this unattended for weeks at a time.**

**Boot-phase round** (2026-08-29) - a real cold-boot incident's logs showed
the previous flat cadence taking ~2 minutes to detect and recover, and the
page-target lookup transiently failing entirely (not just reading
"not ok") shortly after a restart. Researched first (Raspberry Pi Forums,
GitHub issues - see the actual investigation for full citations): the
underlying Chromium/labwc/Wayland stuck-first-paint race has no known
community fix beyond "wait longer," so this round targets detection speed
and one separate, more mundane, fully-fixable contributing cause (network
not yet reachable when Chromium first navigates) rather than claiming to
have solved the race itself.

Verified for real (headless Chrome, the actual `kiosk-watchdog.py`, real
CDP), not just by inspection:
- The network-wait snippet in `kiosk-wrapper.sh`: returns immediately
  against a reachable URL, and correctly times out at the configured cap
  and falls through (not hangs) against an unreachable one.
- The boot-phase/steady-state state machine: ran the real, unmodified
  `main()` loop (short-circuited timings only) against a genuinely
  healthy Chrome instance - confirmed it starts in boot phase, correctly
  logs the transition to steady-state cadence on the first successful
  check, then correctly uses the steady-state interval/threshold for a
  real kill-Chrome failure, restarts, and correctly re-enters boot phase
  (not steady state) afterward.
- The target-lookup retry: a timing-controlled test opened a wrong-origin
  tab as the ONLY target, then opened the correct-origin tab mid-retry-
  window - confirmed the first lookup correctly missed, and the retry
  correctly found and returned the right target, logging that it was a
  retry recovery (not silently identical to a clean first-try match).
- One test-environment red herring worth recording: an early test run
  showed `is_render_ok()` returning `False` against what looked like a
  healthy page - root cause was the test's own local HTTP server running
  on port 5060, which Chrome hardcodes as an "unsafe port" (SIP) and
  refuses to navigate to at all, showing its own error page instead.
  Nothing wrong with the watchdog; confirmed by directly inspecting the
  page's own `document.body.innerText` via CDP before concluding anything
  about the code.

**What this does NOT prove, and needs real Pi hardware to confirm**: the
2s `curl` timeout / 30s overall cap in the network-wait snippet haven't
been tuned against this Pi's actual WiFi association time; whether the
20s boot-phase initial silence is enough margin over kiosk-wrapper.sh's
own 15s double-launch timing on real (slower, contended) hardware versus
this Mac; and, as before, whether any of this actually shortens a REAL
reproduction of the original stuck-blank-paint failure rather than only
the failure modes reproducible off-Pi. Recommend watching the logs
(`journalctl --user -u kiosk-watchdog.service -f`) across several real
power cycles rather than assuming these numbers are final.

**`hide-cursor.sh`** (2026-10-14) - run for real on the live Meg's Cafe
Pi (192.168.1.119, the "Tiger copy" SD card), not just inspected:
- Confirmed labwc 0.9.8 has no native cursor-hide option (`man
  labwc-config` searched in full) and that `unclutter` is installed but
  inert under this Wayland session, before building the fix.
- Built the 62-entry transparent Xcursor theme and verified the compiled
  `cursors/default` file is a genuine `Xcursor data version 1.0` binary
  (via `file`).
- The real propagation risk - whether `XCURSOR_THEME` set only in
  labwc's environment file would actually reach Chromium, given
  `kiosk.service` is a separate systemd `--user` unit that already
  needed `XDG_RUNTIME_DIR`/`WAYLAND_DISPLAY` hardcoded rather than
  relying on inheritance - was tested empirically, not assumed. Reading
  `/proc/<chromium-pid>/environ` directly came back all-zero bytes; this
  turned out to be Chromium's own sandbox hardening
  (`PR_SET_DUMPABLE=0`), which blocks ptrace-based environ reads by any
  process, even the owning user - not a bug in the read method, and not
  usable for this check. `systemctl --user show-environment` after a
  real `sudo reboot` was the method that actually worked: confirmed
  `XCURSOR_THEME=invisible`/`XCURSOR_SIZE=32` present in the systemd
  `--user` manager's own resolved environment, and that `kiosk.service`'s
  `Environment=` line doesn't override either variable - so Chromium
  inherits the fix with no change to `kiosk.service` needed.
- Confirmed `kiosk.service` and `kiosk-watchdog.service` both came back
  `active (running)` with their expected Main PIDs after the same real
  reboot - the cursor fix does not affect kiosk health.

**What this does NOT prove**: the cursor's actual on-screen invisibility
was not independently confirmed by looking at the physical TV (the
`/proc/environ` ptrace block means there's no in-band way to screenshot
or query Chromium's rendered cursor state over SSH either) - Jeff should
glance at the TV and confirm no pointer is visible over the dashboard to
close this out visually.
