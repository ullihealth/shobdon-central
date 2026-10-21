// Optional carousel-video sound (src/utils/videoSound.ts): the unmuted ->
// muted fallback when a browser refuses autoplay with sound, one video at a
// time holding the sound, and sound being handed back when a slide stops.
// Pure logic, driven with fake video elements - no browser or server needed.
// (The TypeScript is transpiled in memory with the repo's own `typescript`.)
// Plus source-level guards that previews/thumbnails/unchanged slots stay muted.
//
// Run with: node --test scripts/video-sound.test.mjs (or npm test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function load() {
  const source = fs.readFileSync(path.join(root, 'src/utils/videoSound.ts'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}#${Math.random()}`);
}

// A fake <video>: starts muted like the real one (the muted attribute), and
// records every play() call with the muted state at that moment.
function fakeVideo(behaviour = 'allow') {
  const video = {
    muted: true,
    calls: [],
    play() {
      video.calls.push({ mutedAtCall: video.muted });
      const refuse = behaviour === 'block-unmuted' ? !video.muted : behaviour === 'block-all';
      if (refuse) return Promise.reject(Object.assign(new Error('play() failed: user didn\'t interact'), { name: 'NotAllowedError' }));
      return Promise.resolve();
    },
  };
  return video;
}

test('unchanged slots (sound off): behave exactly as before', async () => {
  const { playWithOptionalSound, resetVideoSoundForTests } = await load();
  resetVideoSoundForTests();
  const video = fakeVideo();
  const outcome = await playWithOptionalSound(video, false);
  assert.equal(outcome, 'muted');
  assert.equal(video.muted, true);
  assert.deepEqual(video.calls, [{ mutedAtCall: true }], 'one muted play() call, never unmuted');
});

test('sound on + browser allows it: plays with sound, in one call', async () => {
  const { playWithOptionalSound, resetVideoSoundForTests } = await load();
  resetVideoSoundForTests();
  const video = fakeVideo('allow');
  assert.equal(await playWithOptionalSound(video, true), 'sound');
  assert.equal(video.muted, false);
  assert.deepEqual(video.calls, [{ mutedAtCall: false }]);
});

test('sound on + autoplay blocked: immediately retries MUTED and still plays', async () => {
  const { playWithOptionalSound, resetVideoSoundForTests } = await load();
  resetVideoSoundForTests();
  const video = fakeVideo('block-unmuted');
  const outcome = await playWithOptionalSound(video, true);
  assert.equal(outcome, 'muted', 'falls back to muted playback');
  assert.equal(video.muted, true);
  assert.deepEqual(video.calls, [{ mutedAtCall: false }, { mutedAtCall: true }], 'unmuted attempt, then a muted retry');
});

test('never throws or leaves the slot stalled: even if the muted retry also fails it resolves', async () => {
  const { playWithOptionalSound, resetVideoSoundForTests } = await load();
  resetVideoSoundForTests();
  const video = fakeVideo('block-all');
  assert.equal(await playWithOptionalSound(video, true), 'failed');
  assert.equal(video.muted, true);
  assert.equal(video.calls.length, 2);
});

test('a refused sound attempt gives the sound back, so the next video can have it', async () => {
  const { playWithOptionalSound, resetVideoSoundForTests } = await load();
  resetVideoSoundForTests();
  const blocked = fakeVideo('block-unmuted');
  await playWithOptionalSound(blocked, true);
  const next = fakeVideo('allow');
  assert.equal(await playWithOptionalSound(next, true), 'sound');
  assert.equal(blocked.muted, true, 'the refused video stays muted');
});

test('only one video has sound at a time: a newly started sound slot takes it and mutes the previous one', async () => {
  const { playWithOptionalSound, resetVideoSoundForTests } = await load();
  resetVideoSoundForTests();
  const left = fakeVideo();
  const right = fakeVideo();
  await playWithOptionalSound(left, true);
  assert.equal(left.muted, false);
  await playWithOptionalSound(right, true);
  assert.equal(right.muted, false, 'the newest sound slot has the sound');
  assert.equal(left.muted, true, 'the previous one is muted (and keeps playing)');
});

test('a muted slot never steals the sound from a sound slot', async () => {
  const { playWithOptionalSound, resetVideoSoundForTests } = await load();
  resetVideoSoundForTests();
  const loud = fakeVideo();
  const quiet = fakeVideo();
  await playWithOptionalSound(loud, true);
  await playWithOptionalSound(quiet, false);
  assert.equal(loud.muted, false);
  assert.equal(quiet.muted, true);
});

test('sound stops when the slide changes: stopVideoSound mutes and releases', async () => {
  const { playWithOptionalSound, stopVideoSound, resetVideoSoundForTests } = await load();
  resetVideoSoundForTests();
  const a = fakeVideo();
  const b = fakeVideo();
  await playWithOptionalSound(a, true);
  stopVideoSound(a);
  assert.equal(a.muted, true);
  await playWithOptionalSound(b, true);
  assert.equal(b.muted, false, 'the next slide can take the sound after the first stopped');
  // a late stop of a video that is no longer the owner must not touch the owner's sound
  stopVideoSound(a);
  assert.equal(b.muted, false);
});

test('source guards: previews, thumbnails and unchanged slots stay muted', () => {
  const renderer = fs.readFileSync(path.join(root, 'src/components/media/MediaSlotRenderer.tsx'), 'utf8');
  const panel = fs.readFileSync(path.join(root, 'src/components/media/MediaPanel.tsx'), 'utf8');
  const editor = fs.readFileSync(path.join(root, 'src/components/media/CarouselSlotEditor.tsx'), 'utf8');
  const library = fs.readFileSync(path.join(root, 'src/pages/MediaLibraryPage.tsx'), 'utf8');
  const videoTag = renderer.match(/<video\s[\s\S]*?\/>/)?.[0] ?? '';
  assert.match(videoTag, /\n\s+muted\n/, 'the carousel <video> keeps its muted attribute');
  assert.match(renderer, /allowSound = false/, 'sound is off by default in the renderer');
  assert.equal((panel.match(/allowSound=\{!isPreview\}/g) || []).length, 2, 'MediaPanel enables sound only when not a preview, in both render paths');
  assert.ok(!/allowSound\s*=/.test(editor), 'the admin slot preview never passes allowSound (so it is always muted)');
  assert.ok(/<video src=\{file\.url\}[^>]*\bmuted\b/.test(library), 'Media Library thumbnails stay muted');
});
