// Optional sound for carousel videos (per-slot "Play sound", default off).
//
// Every carousel <video> starts muted (the `muted` attribute in
// MediaSlotRenderer.tsx is untouched) and stays muted unless its slot has
// sound switched on AND it is on a real, live screen. Normal desktop/mobile
// browsers block unmuted autoplay, so a sound-on slot first tries to play
// with sound and, if the browser refuses, immediately plays muted instead -
// a slot is never left blank or stalled. The Pi kiosk runs Chromium with
// --autoplay-policy=no-user-gesture-required, where the unmuted attempt works.
//
// Only one video may hold the sound at a time (the café layout can have a
// left and a right pane active together): whichever slot most recently
// starts with sound takes it, and the previous holder is muted but keeps
// playing. Taking over rather than "first come, first served" also means
// the ordering of React effects between the outgoing and incoming slide
// can never leave the incoming slide silent.

// The bits of HTMLVideoElement this needs - lets the tests drive it with a
// plain fake instead of a browser.
export interface SoundCapableVideo {
  muted: boolean
  play: () => Promise<void> | void
}

export type PlaybackOutcome = 'sound' | 'muted' | 'failed'

let soundOwner: SoundCapableVideo | null = null

// Starts playback. wantsSound false = exactly the old behaviour (muted,
// play once, errors swallowed) - nothing else about it changes.
export async function playWithOptionalSound(video: SoundCapableVideo, wantsSound: boolean): Promise<PlaybackOutcome> {
  if (wantsSound) {
    const previousOwner = soundOwner
    if (previousOwner && previousOwner !== video) previousOwner.muted = true
    soundOwner = video
    video.muted = false
    try {
      await video.play()
      return 'sound'
    } catch {
      // Autoplay with sound was refused (normal browsers, the Pilot's App,
      // admin previews) - give the sound back and play muted below.
      if (soundOwner === video) soundOwner = null
    }
  }
  video.muted = true
  try {
    await video.play()
    return 'muted'
  } catch {
    return 'failed'
  }
}

// Called when a slide stops being the active one (or unmounts): puts the
// video back to muted and gives up the sound, so audio never carries over
// to the next slide.
export function stopVideoSound(video: SoundCapableVideo): void {
  video.muted = true
  if (soundOwner === video) soundOwner = null
}

// Test hook only.
export function resetVideoSoundForTests(): void {
  soundOwner = null
}
