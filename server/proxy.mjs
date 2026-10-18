// Signed, Range-capable stream proxy.
//
// Why this exists at all: a cloud-drive direct link is often not a
// browser-friendly URL. It may want a desktop User-Agent or a site Referer, it
// answers with a 302 to a different CDN host, and it may not send CORS headers.
// None of that can be fixed from a page. The proxy adds configurable headers,
// follows redirects itself, and hands the browser a same-origin URL with the
// CORS + Range behaviour LinWeb's demuxer needs.
//
// The URL is signed with HMAC so this cannot be used as an open relay by
// somebody who merely found the port. /api/resolve is the only place that
// decides which upstreams may be signed; that decision is the trust boundary.
import { Readable } from 'node:stream';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { signUrl, verifyUrl, MIME } from './util.mjs';

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 8;

function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip.includes(':')) {
    const s = ip.toLowerCase();
    return s === '::1' || s === '::' || s.startsWith('fc') || s.startsWith('fd') ||
           s.startsWith('fe80') || s.startsWith('ff');
  }
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  return p[0] === 10 || p[0] === 127 || p[0] === 0 ||
         (p[0] === 169 && p[1] === 254) ||
         (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
         (p[0] === 192 && p[1] === 168) ||
         (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
         (p[0] === 198 && (p[1] === 18 || p[1] === 19));
}

async function assertSafeUrl(url, cfg) {
  let u;
  try { u = new URL(url); } catch { throw Object.assign(new Error('非法 URL'), { status: 400 }); }
  if (!/^https?:$/.test(u.protocol)) throw Object.assign(new Error('只允许 http/https 上游'), { status: 400 });
  if (cfg.allowPrivate) return u;
  const host = u.hostname;
  if (host === 'localhost' || host.endsWith('.localhost')) throw Object.assign(new Error('不允许访问本机地址'), { status: 403 });
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addresses.length) throw Object.assign(new Error(`无法解析上游域名: ${host}`), { status: 502 });
  for (const a of addresses) {
    if (isPrivateIp(a.address)) throw Object.assign(new Error('不允许访问内网地址'), { status: 403 });
  }
  return u;
}

function hostMatches(host, list) {
  const h = String(host || '').toLowerCase();
  return (list || []).some(entry => h === entry || h.endsWith('.' + entry));
}

function headersFor(url, cfg, alist, range) {
  const h = {
    'User-Agent': cfg.proxyUserAgent,
    'Accept': '*/*',
    'Accept-Encoding': 'identity',
  };
  let host = '';
  let origin = '';
  try {
    const u = new URL(url);
    host = u.hostname;
    origin = u.origin;
  } catch {}
  const isAList = !!alist && host === alist.host();
  // A Cookie is a credential. It is only sent to the AList host or to hosts the
  // operator explicitly allow-listed, never to an arbitrary pasted URL.
  if (cfg.proxyCookie && (isAList || hostMatches(host, cfg.proxyCookieHosts))) {
    h.Cookie = cfg.proxyCookie;
  }
  // Some CDNs check Referer; if one is configured use it, otherwise act like a
  // same-origin request. Neither is a secret.
  if (cfg.proxyReferer) h.Referer = cfg.proxyReferer;
  else if (origin) h.Referer = origin + '/';
  // AList's own /d/ route may require the API token. Sending it to a third-party
  // CDN after a redirect would be a credential leak, so it is host-matched.
  if (isAList && alist?.token) h.Authorization = alist.token;
  if (range) h.Range = range;
  return h;
}

function contentHeaders(upstream, url) {
  const h = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
    'Cache-Control': 'no-store',
    // Nginx/OpenResty (including 1Panel) buffers proxied responses by default.
    // For a multi-GB video that means temp files and a very late first byte;
    // this tells nginx to stream this response straight through.
    'X-Accel-Buffering': 'no',
    'Accept-Ranges': 'bytes',
  };
  for (const name of ['content-type', 'content-length', 'content-range', 'last-modified', 'etag']) {
    const v = upstream.headers.get(name);
    if (v) h[name.replace(/(^|-)\w/g, c => c.toUpperCase())] = v;
  }
  if (!h['Content-Type']) {
    const ext = new URL(url).pathname.match(/\.[a-z0-9]{2,5}$/i)?.[0]?.toLowerCase();
    if (ext && MIME[ext]) h['Content-Type'] = MIME[ext];
  }
  return h;
}

export function makeStreamUrl(cfg, url, ttlMs = 24 * 3600_000) {
  const { u, e, s } = signUrl(cfg.proxySecret, url, ttlMs);
  return `/api/stream?u=${encodeURIComponent(u)}&e=${e}&s=${encodeURIComponent(s)}`;
}

export function makeSubtitleUrl(cfg, url, ttlMs = 24 * 3600_000) {
  const { u, e, s } = signUrl(cfg.proxySecret, url, ttlMs);
  return `/api/subtitle?u=${encodeURIComponent(u)}&e=${e}&s=${encodeURIComponent(s)}`;
}

export function readStreamTarget(cfg, query) {
  return verifyUrl(cfg.proxySecret, query.get('u'), query.get('e'), query.get('s'));
}

export async function proxyStream(req, res, target, cfg, alist) {
  const ac = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ac.abort(); }, cfg.upstreamTimeoutMs);
  const onClose = () => ac.abort();
  res.once('close', onClose);
  try {
    let current = target;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertSafeUrl(current, cfg);
      const headers = headersFor(current, cfg, alist, req.headers.range);
      if (req.headers['if-range']) headers['If-Range'] = req.headers['if-range'];
      const upstream = await fetch(current, { headers, redirect: 'manual', signal: ac.signal });
      if (REDIRECTS.has(upstream.status)) {
        const loc = upstream.headers.get('location');
        upstream.body?.cancel().catch(() => {});
        if (!loc) throw Object.assign(new Error('上游 302 没有 Location'), { status: 502 });
        current = new URL(loc, current).toString();
        continue;
      }
      const headersOut = contentHeaders(upstream, current);
      const status = upstream.status >= 200 && upstream.status < 300
        ? (upstream.status === 206 ? 206 : 200)
        : upstream.status;
      res.writeHead(status, headersOut);
      if (req.method === 'HEAD' || !upstream.body) { res.end(); return; }
      const body = Readable.fromWeb(upstream.body);
      body.on('error', () => { try { res.destroy(); } catch {} });
      body.pipe(res);
      return;
    }
    throw Object.assign(new Error('重定向次数过多'), { status: 502 });
  } catch (e) {
    if (ac.signal.aborted && !res.headersSent) {
      if (!res.destroyed) res.writeHead(timedOut ? 504 : 499).end(timedOut ? 'upstream timeout' : 'client closed request');
      return;
    }
    if (!res.headersSent) {
      res.writeHead(e.status || 502, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      }).end(`upstream: ${e.message}`);
    } else {
      try { res.destroy(); } catch {}
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function proxySubtitle(req, res, target, cfg, alist) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20_000);
  res.on('close', () => ac.abort());
  try {
    let current = target;
    let upstream = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertSafeUrl(current, cfg);
      upstream = await fetch(current, {
        headers: headersFor(current, cfg, alist),
        redirect: 'manual',
        signal: ac.signal,
      });
      if (!REDIRECTS.has(upstream.status)) break;
      const loc = upstream.headers.get('location');
      upstream.body?.cancel().catch(() => {});
      if (!loc) throw Object.assign(new Error('字幕 302 没有 Location'), { status: 502 });
      current = new URL(loc, current).toString();
      upstream = null;
    }
    if (!upstream) throw Object.assign(new Error('字幕重定向次数过多'), { status: 502 });
    if (!upstream.ok) throw Object.assign(new Error(`字幕上游 ${upstream.status}`), { status: 502 });
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > 20 * 1024 * 1024) throw Object.assign(new Error('字幕文件超过 20MB'), { status: 413 });
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': buf.length,
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    }).end(buf);
  } catch (e) {
    if (!res.headersSent && !res.destroyed) {
      res.writeHead(e.status || 502, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      }).end(`subtitle: ${e.message}`);
    }
  } finally {
    clearTimeout(timer);
  }
}
