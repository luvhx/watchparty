import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { srtToVtt } from '../public/src/subs/srt.js';
import { parseAssPacket } from '../public/src/subs/ass.js';

test('SRT becomes WebVTT without losing cues', () => {
  const srt = readFileSync('test/fixtures/sample.srt', 'utf8');
  const vtt = srtToVtt(srt);
  assert.match(vtt, /^WEBVTT/);
  assert.match(vtt, /00:00:01\.000 --> 00:00:04\.000/);
  assert.match(vtt, /Hello from the test subtitle\./);
  assert.match(vtt, /Second line\./);
  assert.equal((vtt.match(/-->/g) || []).length, 2);
});

test('SRT metadata is stripped but timing is kept', () => {
  const vtt = srtToVtt('1\r\n00:00:02,500 --> 00:00:03,750\r\n{\\an8}top\r\n');
  assert.match(vtt, /00:00:02\.500 --> 00:00:03\.750/);
  assert.doesNotMatch(vtt, /\{\\an8\}/);
  assert.match(vtt, /top/);
});

test('ASS packet parser keeps commas in the text', () => {
  const p = parseAssPacket('1,0,Default,,0,0,0,,Hello, world');
  assert.equal(p.readOrder, 1);
  assert.equal(p.style, 'Default');
  assert.equal(p.text, 'Hello, world');
});

test('ASS packet parser rejects an incomplete packet', () => {
  assert.equal(parseAssPacket('1,0,Default'), null);
});
