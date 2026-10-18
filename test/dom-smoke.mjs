// DOM-level smoke test without a full browser. It catches missing selectors,
// typos in the boot path, and top-level exceptions; it does not prove playback.
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync('public/index.html', 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost:8364/', pretendToBeVisual: true });
const { window } = dom;
const errors = [];
window.addEventListener('error', e => errors.push(e.error?.message || e.message));

// Canvas stub: jsdom has no 2d context without the native canvas package.
const ctx = {
  font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textBaseline: '',
  setTransform() {}, clearRect() {}, measureText: t => ({ width: String(t).length * 9 }),
  fillText() {}, strokeText() {},
};
window.HTMLCanvasElement.prototype.getContext = () => ctx;
window.HTMLElement.prototype.getBoundingClientRect = () => ({
  width: 1280, height: 720, top: 0, left: 0, right: 1280, bottom: 720, x: 0, y: 0,
});
window.ResizeObserver = class { observe() {} disconnect() {} };
window.requestAnimationFrame = () => 1;
window.cancelAnimationFrame = () => {};
window.HTMLMediaElement.prototype.play = () => Promise.resolve();
window.HTMLMediaElement.prototype.pause = () => {};
window.HTMLMediaElement.prototype.load = () => {};
window.fetch = async url => {
  if (String(url).includes('/api/config')) {
    return { ok: true, json: async () => ({ ok: true, alist: false, alistRoot: '/', allowAnyUrl: true }) };
  }
  return { ok: true, json: async () => ({ ok: true }), text: async () => '' };
};
if (!window.crypto) window.crypto = globalThis.crypto;

for (const k of ['window', 'document', 'navigator', 'location', 'history', 'localStorage', 'HTMLElement',
  'HTMLCanvasElement', 'HTMLMediaElement', 'ResizeObserver', 'requestAnimationFrame',
  'cancelAnimationFrame', 'fetch', 'crypto', 'TextEncoder', 'TextDecoder', 'URL', 'URLSearchParams',
  'Blob', 'Event', 'CustomEvent']) {
  if (window[k] === undefined) continue;
  try { globalThis[k] = window[k]; } catch {}
}

await import('../public/app.js');
await new Promise(r => setTimeout(r, 80));
if (errors.length) {
  console.error('DOM smoke errors:', errors);
  process.exit(1);
}
if (!document.querySelector('#subSel')) throw new Error('subtitle select missing');
if (document.querySelector('#tab-alist').hidden !== true) throw new Error('AList tab should be hidden when unconfigured');
console.log('DOM smoke OK');
