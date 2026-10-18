import { createHmac, timingSafeEqual } from 'node:crypto';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8',
  '.ass': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.flv': 'video/x-flv',
};

export const b64url = buf => Buffer.from(buf).toString('base64url');
export const unb64url = s => Buffer.from(s, 'base64url');

export function signUrl(secret, url, ttlMs = 6 * 3600_000) {
  const u = b64url(url);
  const e = Date.now() + ttlMs;
  const s = createHmac('sha256', secret).update(`${u}.${e}`).digest('base64url');
  return { u, e, s };
}

export function verifyUrl(secret, u, e, s) {
  if (!u || !e || !s) return null;
  const exp = Number(e);
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  const want = createHmac('sha256', secret).update(`${u}.${e}`).digest('base64url');
  const a = Buffer.from(s);
  const b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try { return unb64url(u).toString('utf8'); } catch { return null; }
}

export function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

export function sendText(res, status, text) {
  const body = Buffer.from(String(text));
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

export async function readJson(req, limit = 1 << 20) {
  const chunks = [];
  let n = 0;
  for await (const chunk of req) {
    n += chunk.length;
    if (n > limit) throw Object.assign(new Error('request body too large'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('invalid JSON'), { status: 400 }); }
}

export function normalizePath(p) {
  let path = String(p ?? '/').trim();
  if (!path.startsWith('/')) path = '/' + path;
  // Collapse duplicate slashes and remove . / .. segments. AList paths are
  // absolute; a path that escapes to the parent is never what a viewer meant.
  const parts = [];
  for (const seg of path.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { parts.pop(); continue; }
    parts.push(seg);
  }
  return '/' + parts.join('/');
}

export function encodePath(path) {
  return normalizePath(path).split('/').map(encodeURIComponent).join('/');
}
