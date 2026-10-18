// One process, one port: static site + AList-compatible API + signed media
// proxy + watch-party WebSocket. The browser talks to this origin for everything, so
// there is no CORS to configure and no second service to remember.
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { networkInterfaces } from 'node:os';
import { makeConfig } from './env.mjs';
import { MIME, sendJson, sendText, readJson } from './util.mjs';
import { AList } from './alist.mjs';
import { makeStreamUrl, makeSubtitleUrl, readStreamTarget, proxyStream, proxySubtitle } from './proxy.mjs';
import { attachTogether } from './together.mjs';

const cfg = makeConfig();
const ROOT = resolve('public');
const log = (msg, level = 'info') => console.log(`[${new Date().toISOString()}] ${level} ${msg}`);
const alist = new AList(cfg, log);

function fileFor(urlPath) {
  let pathname;
  try { pathname = decodeURIComponent(urlPath.split('?')[0]); } catch { return null; }
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const abs = resolve(join(ROOT, normalize('.' + pathname)));
  if (abs !== ROOT && !abs.startsWith(ROOT + sep)) return null;
  return abs;
}

async function serveStatic(req, res, pathname) {
  const file = fileFor(pathname);
  if (!file) { sendText(res, 403, 'forbidden'); return; }
  let st;
  try { st = statSync(file); } catch { sendText(res, 404, 'not found'); return; }
  if (st.isDirectory()) {
    const idx = join(file, 'index.html');
    try { st = statSync(idx); } catch { sendText(res, 404, 'not found'); return; }
    res.writeHead(302, { Location: pathname.replace(/\/?$/, '/') + 'index.html' }).end();
    return;
  }
  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': st.size,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  });
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(file).pipe(res);
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Range',
      'Access-Control-Max-Age': '600',
    }).end();
    return;
  }

  if (p === '/api/health') { sendJson(res, 200, { ok: true, service: 'alist-watchparty' }); return; }

  if (p === '/api/config') {
    sendJson(res, 200, {
      ok: true,
      alist: !!cfg.alistUrl,
      alistRoot: cfg.alistRoot,
      allowAnyUrl: cfg.allowAnyUrl,
      roomMaxMembers: cfg.roomMaxMembers,
    });
    return;
  }

  if (p === '/api/stream') {
    const target = readStreamTarget(cfg, url.searchParams);
    if (!target) { sendText(res, 403, 'bad or expired signature'); return; }
    await proxyStream(req, res, target, cfg, alist);
    return;
  }

  if (p === '/api/subtitle') {
    const target = readStreamTarget(cfg, url.searchParams);
    if (!target) { sendText(res, 403, 'bad or expired signature'); return; }
    await proxySubtitle(req, res, target, cfg, alist);
    return;
  }

  if (p === '/api/alist/list' || p === '/api/openlist/list') {
    if (!cfg.alistUrl) { sendJson(res, 503, { ok: false, error: '未配置 ALIST_URL' }); return; }
    const body = await readJson(req);
    const out = await alist.list(body.path || cfg.alistRoot);
    sendJson(res, 200, { ok: true, ...out });
    return;
  }

  if (p === '/api/alist/resolve' || p === '/api/openlist/resolve') {
    if (!cfg.alistUrl) { sendJson(res, 503, { ok: false, error: '未配置 ALIST_URL' }); return; }
    const body = await readJson(req);
    if (!body.path) { sendJson(res, 400, { ok: false, error: '缺少 path' }); return; }
    const r = await alist.resolve(body.path);
    sendJson(res, 200, {
      ok: true,
      title: r.name,
      path: r.path,
      size: r.size,
      stream: makeStreamUrl(cfg, r.url),
      subtitle: makeSubtitleUrl(cfg, r.url),
    });
    return;
  }

  if (p === '/api/resolve') {
    if (!cfg.allowAnyUrl) { sendJson(res, 403, { ok: false, error: '未开启 ALLOW_ANY_URL' }); return; }
    const body = await readJson(req);
    let u;
    try { u = new URL(String(body.url || '')); } catch { sendJson(res, 400, { ok: false, error: 'URL 不合法' }); return; }
    if (!/^https?:$/.test(u.protocol)) { sendJson(res, 400, { ok: false, error: '只支持 http/https' }); return; }
    const title = String(body.title || u.pathname.split('/').pop() || '直接播放');
    sendJson(res, 200, {
      ok: true,
      title,
      url: u.toString(),
      stream: makeStreamUrl(cfg, u.toString()),
      subtitle: makeSubtitleUrl(cfg, u.toString()),
    });
    return;
  }

  if (p === '/api/subtitle/sign') {
    if (!cfg.allowAnyUrl) { sendJson(res, 403, { ok: false, error: '未开启 ALLOW_ANY_URL' }); return; }
    const body = await readJson(req);
    let u;
    try { u = new URL(String(body.url || '')); } catch { sendJson(res, 400, { ok: false, error: 'URL 不合法' }); return; }
    if (!/^https?:$/.test(u.protocol)) { sendJson(res, 400, { ok: false, error: '只支持 http/https' }); return; }
    sendJson(res, 200, { ok: true, url: makeSubtitleUrl(cfg, u.toString()) });
    return;
  }

  sendJson(res, 404, { ok: false, error: 'unknown API' });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) { await handleApi(req, res, url); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { sendText(res, 405, 'method not allowed'); return; }
    await serveStatic(req, res, url.pathname);
  } catch (e) {
    log(`request ${url.pathname}: ${e.stack || e.message}`, 'error');
    if (!res.headersSent) sendJson(res, e.status || 500, { ok: false, error: e.message || 'internal error' });
    else try { res.destroy(); } catch {}
  }
});

attachTogether(server, cfg, log);

server.listen(cfg.port, cfg.host, () => {
  const lans = Object.values(networkInterfaces()).flat()
    .filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n.address);
  log(`AList Watchparty listening on http://localhost:${cfg.port}`);
  for (const ip of lans) log(`  LAN: http://${ip}:${cfg.port}`);
  log(cfg.alistUrl ? `AList backend: ${cfg.alistUrl}` : 'AList backend: 未配置（仍可粘贴任意直链）');
  log(`arbitrary URL proxy: ${cfg.allowAnyUrl ? 'on' : 'off'} · private upstream: ${cfg.allowPrivate ? 'on' : 'off'}`);
  if (cfg.proxySecret === 'change-me-to-a-long-random-string') {
    log('WARN: PROXY_SECRET 还是示例值，签名可以被伪造；请换成随机长字符串', 'warn');
  }
  if (cfg.allowAnyUrl && cfg.host === '0.0.0.0') {
    log('WARN: ALLOW_ANY_URL=1 且监听 0.0.0.0 —— 这是开放代理/SSRF，公网部署前请加认证', 'warn');
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { log(`shutting down (${sig})`); server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 3000); });
}
