# Image asset colour profile standard

All image assets committed to `public/images/` (or any other static image
location in this project - `public/favicon/`, `public/media/`, etc.) must use
the **sRGB IEC61966-2.1** colour profile, or carry no embedded colour profile
at all. They must **not** use a device-specific or vendor calibration profile
(e.g. a Mac "Display" profile, or a specific monitor's own ICC profile).

## Why

A device-specific colour profile only renders correctly on the exact device
that produced it - the operating system that exported it knows how to
correctly interpret its own calibration data. Every other rendering pipeline
(a different OS, a browser on a different machine, and especially embedded/
smart-TV browsers) either ignores that profile or applies it incorrectly,
producing a visible colour shift.

sRGB is the portable standard virtually every rendering pipeline - Chrome,
Safari, embedded browsers, TVs - already assumes and handles consistently. An
image with **no** embedded profile at all is also fine: browsers already
default to treating untagged image data as sRGB, so absence of a profile is
not the problem this standard guards against - only a *wrong*, non-portable
profile is.

### The incident that prompted this

`public/images/pilot-app-phone-mockup.png` (the QR rotation slide's phone
mockup image) shipped with a green colour tint visible on the actual
clubhouse TV, while looking correct in a Mac browser. Investigation traced
this to the image's embedded ICC profile: it was a generic macOS "Display"
profile, literally copyrighted "Apple Inc., 2025" - the exact calibration
profile of whatever Mac/monitor was used to export it from Affinity Photo,
not a portable colour space. It rendered correctly only there.

Re-exporting the same image with the colour profile explicitly converted to
sRGB (rather than "keep current display/device profile") fixed the tint -
see commit `3a8350b`.

### sRGB only - Display P3 is intentionally not accepted

Decided explicitly, not by default: **Display P3 does not satisfy this
standard**, even though it's a legitimate, well-defined portable colour
space (unlike a device-calibration profile such as the "Display" profile
above). sRGB has broader and more consistent support specifically across
embedded/smart-TV browsers - the exact rendering environment this standard
exists to protect - so sRGB-only is the simpler, safer bar to hold every
image asset to, rather than maintaining a list of "acceptable wide-gamut
profiles" and trusting every embedded browser to handle each of them
correctly.

## How to avoid this when exporting a new/replaced image

When exporting from Affinity Photo, Photoshop, or similar - explicitly
convert to sRGB (or "Assign Profile: sRGB") before export, rather than
leaving the export set to embed the document's/display's current profile.

## Automated enforcement

`scripts/check-image-color-profile.mjs` inspects a PNG or JPEG file's
embedded ICC profile (PNG `iCCP`/`sRGB` chunks, JPEG `ICC_PROFILE` APP2
segments) and reports whether it's sRGB, absent (also fine), or something
else. Run it directly against any file:

```sh
node scripts/check-image-color-profile.mjs public/images/some-image.png
```

It also runs automatically as a pre-commit hook (husky + lint-staged) against
any staged file under `public/**/*.{png,jpg,jpeg}` - a commit is blocked with
a clear error if a non-sRGB profile is detected. See `.husky/pre-commit` and
the `lint-staged` block in `package.json`.

## Known non-compliant asset, not yet in use

`public/images/davis-vantage-pro2.png` (currently untracked, not wired up
anywhere in the app) carries a **Display P3** profile - it will fail the
pre-commit check and must be re-exported to sRGB before it's ever staged or
used in the project. Flagged here so this isn't rediscovered from scratch
later.
