#!/usr/bin/env node
// Checks an image's embedded ICC colour profile and fails if it's a
// device/vendor-specific profile rather than a portable one - see
// IMAGE_ASSETS.md for the full standard and the incident that prompted
// this. public/images/pilot-app-phone-mockup.png shipped with a
// generic macOS "Display" profile (literally copyrighted "Apple Inc.,
// 2025" - the exact calibration of whatever Mac/monitor exported it),
// which rendered correctly only on that Mac and showed a visible green
// tint on the clubhouse TV. Detection here is the same method used to
// diagnose that bug by hand: read the embedded profile's own
// description text and check whether it identifies as sRGB.
//
// Pass cases (deliberately permissive, not just "must contain sRGB"):
// - No embedded profile at all - browsers already default to treating
//   untagged image data as sRGB, so an absent profile is NOT the bug
//   class this guards against; only a WRONG non-portable profile is.
// - An explicit PNG sRGB chunk (a simple rendering-intent marker, not a
//   full profile - already unambiguous).
// - An iCCP/JPEG ICC profile whose own bytes contain the string "sRGB"
//   (every genuine sRGB profile's description tag reads something like
//   "sRGB IEC61966-2.1" - confirmed against this project's own known-
//   good asset, davis-vantage-pro2.png's Display P3 profile, and the
//   known-bad original mockup export, during this check's own build).
//
// Fail case: an embedded profile present without "sRGB" in its bytes -
// exactly the shape of the profile that caused the original incident.
//
// Deliberately zero new dependencies - PNG's iCCP chunk is inflate-
// compressed (Node's built-in zlib handles that); JPEG's ICC_PROFILE
// APP2 segment is stored raw. No image library needed for either.
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { pathToFileURL } from "node:url";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Substrings that show up in real-world non-portable profile
// descriptions - purely to make a FAIL message more useful (name the
// suspected profile), never used to decide pass/fail on their own.
const KNOWN_NON_PORTABLE_HINTS = ["Display P3", "Adobe RGB", "ProPhoto", "Apple", "Display", "Generic RGB"];

function parsePngChunks(buf) {
  const chunks = [];
  let offset = 8;
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length; // 4 (length) + 4 (type) + data + 4 (crc)
    if (type === "IEND") break;
  }
  return chunks;
}

// iCCP chunk layout: null-terminated Latin-1 profile name, then a
// 1-byte compression method (0 = deflate, the only method PNG defines),
// then the compressed profile bytes.
function decodeIccpChunk(iccpData) {
  const nullIdx = iccpData.indexOf(0);
  if (nullIdx === -1) return null;
  const profileName = iccpData.toString("latin1", 0, nullIdx);
  const compressionMethod = iccpData[nullIdx + 1];
  const compressed = iccpData.subarray(nullIdx + 2);
  try {
    const raw = compressionMethod === 0 ? inflateSync(compressed) : compressed;
    return { profileName, raw };
  } catch {
    return { profileName, raw: null };
  }
}

// declaredName: PNG's iCCP chunk carries its own short human-readable
// profile name field (separate from, and simpler than, the profile's
// internal binary tag table) - e.g. "sRGB IEC61966-2.1" or "Display
// P3" verbatim, already plain Latin-1 text. That's checked first since
// it's authoritative and trivial to read. rawProfileBytes is the full
// decompressed/raw profile as a fallback for formats with no such
// field (JPEG) or a generic declared name - ICC v4 profiles often
// store their real description as UTF-16BE text (a 'mluc' tag), which
// a plain Latin-1 substring search misses entirely (confirmed the hard
// way: an unmistakably-sRGB-named profile still failed a raw-bytes-only
// search during this check's own build) - stripping null bytes before
// searching turns "s\0R\0G\0B\0" back into a matchable "sRGB" without
// needing a full UTF-16 decoder.
function judgeProfileBytes(rawProfileBytes, declaredName) {
  if (declaredName && declaredName.includes("sRGB")) {
    return { ok: true, reason: `embedded sRGB profile ("${declaredName}")` };
  }
  const rawText = rawProfileBytes.toString("latin1");
  const nullStrippedText = rawText.replace(/\x00/g, "");
  if (rawText.includes("sRGB") || nullStrippedText.includes("sRGB")) {
    return { ok: true, reason: `embedded sRGB profile${declaredName ? ` ("${declaredName}")` : ""}` };
  }
  const hint = KNOWN_NON_PORTABLE_HINTS.find((s) => rawText.includes(s) || nullStrippedText.includes(s));
  return {
    ok: false,
    reason:
      `embedded ICC profile is NOT sRGB${declaredName ? ` (profile name: "${declaredName}")` : ""}` +
      `${hint ? ` - looks like a "${hint}" profile` : ""}. This is a device/vendor-specific colour profile, the same ` +
      `class of bug that caused the pilot-app-phone-mockup.png green-tint incident (see IMAGE_ASSETS.md). Re-export ` +
      `this image with its colour profile explicitly converted to sRGB IEC61966-2.1, not "keep current display/device profile".`,
  };
}

function checkPng(buf) {
  const chunks = parsePngChunks(buf);
  if (chunks.some((c) => c.type === "sRGB")) {
    return { ok: true, reason: "explicit PNG sRGB chunk" };
  }
  const iccpChunk = chunks.find((c) => c.type === "iCCP");
  if (!iccpChunk) {
    return { ok: true, reason: "no embedded colour profile (browsers default to sRGB)" };
  }
  const decoded = decodeIccpChunk(iccpChunk.data);
  if (!decoded || !decoded.raw) {
    return {
      ok: false,
      reason: `embedded ICC profile "${decoded?.profileName ?? "unknown"}" could not be decompressed for inspection - treat as suspect and re-export with an explicit sRGB profile.`,
    };
  }
  return judgeProfileBytes(decoded.raw, decoded.profileName);
}

// JPEG ICC profiles live in one or more APP2 ("ICC_PROFILE\0") segments,
// which must be concatenated in sequence-number order before the bytes
// form a valid profile - no JPEG asset exists in this repo today, but
// covering it now avoids a silent gap the moment one is added.
function checkJpeg(buf) {
  let offset = 2;
  const segments = [];
  while (offset < buf.length - 4) {
    if (buf[offset] !== 0xff) break;
    const marker = buf[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda) break; // Start of Scan - no more markers worth scanning
    const segLength = buf.readUInt16BE(offset + 2);
    if (marker === 0xe2 && buf.toString("ascii", offset + 4, offset + 16) === "ICC_PROFILE\x00") {
      // Skip id(12) + this-segment-number(1) + total-segments(1).
      segments.push(buf.subarray(offset + 18, offset + 2 + segLength));
    }
    offset += 2 + segLength;
  }
  if (segments.length === 0) {
    return { ok: true, reason: "no embedded colour profile (browsers default to sRGB)" };
  }
  return judgeProfileBytes(Buffer.concat(segments), null);
}

export function checkImageColorProfile(filePath) {
  const buf = readFileSync(filePath);
  if (buf.subarray(0, 8).equals(PNG_SIGNATURE)) return checkPng(buf);
  if (buf[0] === 0xff && buf[1] === 0xd8) return checkJpeg(buf);
  return { ok: true, reason: "not a PNG/JPEG - skipped (only PNG/JPEG colour profiles are checked)" };
}

// CLI entry point, only when run directly (not when imported by the
// pre-commit hook script, which calls checkImageColorProfile itself).
// pathToFileURL, not a hand-built `file://${...}` string - process.argv[1]
// is a plain (often relative) path, not already a URL, so a naive
// string-concat comparison against import.meta.url (always absolute)
// never matches and silently skips the whole CLI block - confirmed the
// hard way (empty output, exit 0, no error) before switching to this.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("Usage: node scripts/check-image-color-profile.mjs <file.png|file.jpg> [more files...]");
    process.exit(2);
  }

  let failed = false;
  for (const file of files) {
    const result = checkImageColorProfile(file);
    if (result.ok) {
      console.log(`OK   ${file} - ${result.reason}`);
    } else {
      failed = true;
      console.error(`FAIL ${file} - ${result.reason}`);
    }
  }
  process.exit(failed ? 1 : 0);
}
