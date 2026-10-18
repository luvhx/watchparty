// Optional browser smoke test. Uses the Chromium that Playwright already cached
// in this workspace; skip cleanly when it is not present.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { startApp } from './helpers.mjs';

const candidates = [
  process.env.CHROME,
  join(homedir(), '.cache/ms-playwright/chromium-1248/chrome-linux64/chrome'),
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].filter(Boolean);
const executablePath = candidates.find(p => existsSync(p));
if (!executablePath) {
  console.log('SKIP: no Chromium found');
  process.exit(0);
}

const app = await startApp();
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p1 = await ctx.newPage();
  p1.on('pageerror', e => errors.push(`p1: ${e.message}`));
  p1.on('console', m => { if (m.type() === 'error') errors.push(`p1 console: ${m.text()}`); });
  await p1.goto(app.base + '/', { waitUntil: 'networkidle' });
  assert.match(await p1.textContent('#nowTitle'), /尚未载入/);
  assert.equal(await p1.locator('#tab-url').isVisible(), true);

  await p1.fill('#roomName', 'Alice');
  await p1.fill('#roomCode', 'PWROOM');
  await p1.fill('#relay', app.ws);
  await p1.click('#roomGo');
  await p1.waitForFunction(() => document.querySelector('#conn')?.textContent.includes('已连接'));
  assert.equal(await p1.locator('#roomInfo').isVisible(), true);

  const p2 = await ctx.newPage();
  p2.on('pageerror', e => errors.push(`p2: ${e.message}`));
  await p2.goto(app.base + '/', { waitUntil: 'networkidle' });
  await p2.fill('#roomName', 'Bob');
  await p2.fill('#roomCode', 'PWROOM');
  await p2.fill('#relay', app.ws);
  await p2.click('#roomGo');
  await p2.waitForFunction(() => document.querySelector('#conn')?.textContent.includes('已连接'));
  await p1.waitForFunction(() => document.querySelectorAll('#members span').length === 2);

  await p1.fill('#chatText', 'hello from Alice');
  await p1.click('#chatSend');
  await p2.waitForFunction(() => document.querySelector('#chatList')?.textContent.includes('hello from Alice'));
  await p1.waitForTimeout(180);
  const painted = await p1.evaluate(() => {
    const c = document.querySelector('#danmaku');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
    return n;
  });
  assert.ok(painted > 0, 'danmaku canvas should have painted pixels');

  await p1.setInputFiles('#subFile', 'test/fixtures/sample.srt');
  await p1.waitForFunction(() => document.querySelectorAll('video track').length > 0);
  const tracks = await p1.evaluate(() => [...document.querySelectorAll('video track')].map(t => ({ label: t.label, mode: t.track?.mode })));
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].mode, 'showing');
  assert.match(await p1.textContent('#subStatus'), /sample\.srt/);

  assert.deepEqual(errors, []);
  console.log('browser smoke test OK');
} finally {
  await browser.close();
  await app.stop();
}
