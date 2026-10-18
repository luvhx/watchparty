import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, mockServer } from './helpers.mjs';

test('static site and health', async t => {
  const app = await startApp();
  t.after(() => app.stop());
  for (const p of ['/', '/app.js', '/styles.css', '/src/player.js', '/vendor/jassub.js']) {
    const r = await fetch(app.base + p);
    assert.equal(r.status, 200, p);
  }
  const health = await (await fetch(app.base + '/api/health')).json();
  assert.equal(health.ok, true);
  const cfg = await (await fetch(app.base + '/api/config')).json();
  assert.equal(cfg.ok, true);
});

test('signed proxy forwards Range and applies upstream headers', async t => {
  const seen = [];
  const body = Buffer.alloc(64 * 1024, 0x42);
  const up = await mockServer((req, res) => {
    seen.push({ range: req.headers.range, ua: req.headers['user-agent'], referer: req.headers.referer, cookie: req.headers.cookie });
    if (req.url === '/r') { res.writeHead(302, { Location: '/file.mkv' }); res.end(); return; }
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    if (m) {
      const start = +m[1], end = m[2] ? +m[2] : body.length - 1;
      res.writeHead(206, {
        'Content-Type': 'video/x-matroska',
        'Content-Range': `bytes ${start}-${end}/${body.length}`,
        'Content-Length': end - start + 1,
        'Accept-Ranges': 'bytes',
      });
      res.end(body.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'video/x-matroska', 'Content-Length': body.length });
    res.end(body);
  });
  t.after(() => up.close());
  const app = await startApp({ PROXY_REFERER: 'https://ref.example/', PROXY_COOKIE: 'SECRET=1' });
  t.after(() => app.stop());

  const r = await fetch(app.base + '/api/resolve', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: up.url + '/r', title: 'movie.mkv' }),
  });
  const data = await r.json();
  assert.equal(data.ok, true);
  assert.match(data.stream, /^\/api\/stream\?/);

  const s = await fetch(app.base + data.stream, { headers: { Range: 'bytes=100-199' } });
  assert.equal(s.status, 206);
  assert.equal(s.headers.get('content-range'), `bytes 100-199/${body.length}`);
  assert.equal(s.headers.get('access-control-allow-origin'), '*');
  const buf = Buffer.from(await s.arrayBuffer());
  assert.equal(buf.length, 100);
  assert.equal(buf[0], 0x42);
  assert.ok(seen.some(x => x.referer === 'https://ref.example/'));
  assert.ok(seen.some(x => /Chrome\/131/.test(x.ua || '')));
  // A configured Cookie must not leak to an arbitrary pasted host unless allow-listed.
  assert.ok(seen.every(x => x.cookie == null));
  assert.ok(seen.every(x => x.range === 'bytes=100-199' || x.range == null));
});

test('bad/expired signature is rejected', async t => {
  const app = await startApp();
  t.after(() => app.stop());
  const r = await fetch(app.base + '/api/stream?u=abc&e=1&s=nope');
  assert.equal(r.status, 403);
});

test('AList list and resolve use the server-side token', async t => {
  const seen = [];
  const ol = await mockServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization, ua: req.headers['user-agent'], body });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/fs/list') {
        res.end(JSON.stringify({ code: 200, data: { content: [
          { name: 'Movies', is_dir: true, size: 0 },
          { name: 'movie.mkv', is_dir: false, size: 123 },
        ] } }));
      } else if (req.url === '/api/fs/get') {
        res.end(JSON.stringify({ code: 200, data: { name: 'movie.mkv', is_dir: false, size: 123, raw_url: 'http://127.0.0.1:1/d/movie.mkv' } }));
      } else {
        res.end(JSON.stringify({ code: 404, message: 'no' }));
      }
    });
  });
  t.after(() => ol.close());
  const app = await startApp({ ALIST_URL: ol.url, ALIST_TOKEN: 'tok', PROXY_USER_AGENT: 'TestUA/1.0' });
  t.after(() => app.stop());

  const list = await (await fetch(app.base + '/api/alist/list', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '/' }),
  })).json();
  assert.equal(list.ok, true);
  assert.equal(list.items.length, 2);
  assert.equal(list.items[0].path, '/Movies');

  const get = await (await fetch(app.base + '/api/alist/resolve', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '/movie.mkv' }),
  })).json();
  assert.equal(get.ok, true);
  assert.equal(get.title, 'movie.mkv');
  assert.match(get.stream, /^\/api\/stream\?/);
  assert.ok(seen.every(x => x.auth === 'tok'));
  // The UA used to mint the upstream link must be the UA the stream proxy uses.
  assert.ok(seen.every(x => x.ua === 'TestUA/1.0'));
});
