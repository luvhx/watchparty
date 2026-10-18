import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, sleep } from './helpers.mjs';
import { Room } from '../public/src/together/room.js';
import { PlaybackSync } from '../public/src/together/sync.js';

class FakeVideo {
  constructor() {
    this.currentTime = 0;
    this.paused = true;
    this.playbackRate = 1;
    this.readyState = 2;
    this.listeners = {};
  }
  addEventListener(t, f) { (this.listeners[t] ??= []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter(x => x !== f); }
  emit(t) { for (const f of this.listeners[t] || []) f({ type: t }); }
  play() { this.paused = false; this.emit('play'); return Promise.resolve(); }
  pause() { this.paused = true; this.emit('pause'); }
}

test('PlaybackSync makes a second member follow play, seek and pause', async t => {
  const app = await startApp();
  t.after(() => app.stop());

  const v1 = new FakeVideo();
  const v2 = new FakeVideo();
  let s1, s2;
  const r1 = new Room({ log: () => {}, onEvent: m => s1?.onMessage(m) });
  const r2 = new Room({ log: () => {}, onEvent: m => s2?.onMessage(m) });
  s1 = new PlaybackSync(v1, r1, { log: () => {} });
  s2 = new PlaybackSync(v2, r2, { log: () => {} });
  t.after(() => { s1.stop(); s2.stop(); r1.disconnect(); r2.disconnect(); });

  r1.connect(app.ws, 'SYNC01', 'Host');
  r2.connect(app.ws, 'SYNC01', 'Guest');
  await sleep(250);
  s1.start();
  s2.start();

  v1.currentTime = 10;
  v1.play();
  await sleep(700);
  assert.equal(v2.paused, false, 'guest should play');
  assert.ok(Math.abs(v2.currentTime - 10) < 1.5, `guest at ${v2.currentTime}`);

  v1.currentTime = 40;
  v1.emit('seeking');
  await sleep(700);
  assert.ok(Math.abs(v2.currentTime - 40) < 1.5, `guest should seek to 40, at ${v2.currentTime}`);

  v1.pause();
  await sleep(300);
  assert.equal(v2.paused, true, 'guest should pause');
});
