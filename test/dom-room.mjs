// DOM-level room/chat smoke test: real server + real WebSocket, jsdom for the
// page. It proves the UI wiring (join -> members -> chat -> danmaku list), not
// video decoding.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { startApp, sleep } from './helpers.mjs';

const app = await startApp();
const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), { url: app.base + '/', pretendToBeVisual: true });
const { window } = dom;
const nodeFetch = globalThis.fetch;
const nodeURL = globalThis.URL;

const ctx = { font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textBaseline: '',
  setTransform() {}, clearRect() {}, measureText: t => ({ width: String(t).length * 9 }), fillText() {}, strokeText() {} };
window.HTMLCanvasElement.prototype.getContext = () => ctx;
window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 1280, height: 720, top: 0, left: 0, right: 1280, bottom: 720, x: 0, y: 0 });
window.ResizeObserver = class { observe() {} disconnect() {} };
window.requestAnimationFrame = () => 1;
window.cancelAnimationFrame = () => {};
window.HTMLMediaElement.prototype.play = () => Promise.resolve();
window.HTMLMediaElement.prototype.pause = () => {};
window.HTMLMediaElement.prototype.load = () => {};
window.fetch = (url, init) => nodeFetch(new nodeURL(url, app.base), init);
for (const k of ['window', 'document', 'navigator', 'location', 'history', 'localStorage', 'HTMLElement',
  'HTMLCanvasElement', 'HTMLMediaElement', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame',
  'fetch', 'TextEncoder', 'TextDecoder', 'URL', 'URLSearchParams', 'Blob']) {
  if (window[k] === undefined) continue;
  try { globalThis[k] = window[k]; } catch {}
}

let code = 0;
try {
  await import('../public/app.js');
  await sleep(100);
  window.document.querySelector('#roomName').value = 'Alice';
  window.document.querySelector('#roomCode').value = 'DOMROOM';
  window.document.querySelector('#relay').value = app.ws;
  window.document.querySelector('#roomGo').click();
  for (let i = 0; i < 60 && !window.document.querySelector('#conn').textContent.includes('已连接'); i++) await sleep(50);
  assert.match(window.document.querySelector('#conn').textContent, /已连接/);
  assert.equal(window.document.querySelectorAll('#members span').length, 1);
  assert.equal(window.document.querySelector('#roomInfo').hidden, false);

  window.document.querySelector('#chatText').value = 'hello dom';
  window.document.querySelector('#chatSend').click();
  for (let i = 0; i < 40 && !window.document.querySelector('#chatList').textContent.includes('hello dom'); i++) await sleep(50);
  assert.match(window.document.querySelector('#chatList').textContent, /hello dom/);
  console.log('DOM room smoke OK');
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  await app.stop();
  window.close();
  setTimeout(() => process.exit(code), 200);
}
