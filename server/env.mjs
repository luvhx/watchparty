// Small .env loader. Node 22 has --env-file, but that fails when the file is
// absent; a self-hosted project should start with zero configuration.
import { existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

export function loadEnv(file = '.env') {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

const bool = (v, d = false) => v == null || v === '' ? d : /^(1|true|yes|on|y)$/i.test(String(v));
const pick = (...names) => {
  for (const n of names) {
    const v = process.env[n];
    if (v != null && v !== '') return v;
  }
  return '';
};

export function makeConfig() {
  loadEnv();
  const alistUrl = pick('ALIST_URL', 'OPENLIST_URL').trim().replace(/\/+$/, '');
  return {
    // 8364 is deliberately not one of the usual 8000/8080/3000/5000 defaults.
    port: Number(process.env.PORT || 8364),
    host: process.env.HOST || '0.0.0.0',
    proxySecret: process.env.PROXY_SECRET || randomBytes(32).toString('hex'),

    alistUrl,
    // ALIST_* is the current spelling; OPENLIST_* still works for older .env.
    alistToken: pick('ALIST_TOKEN', 'OPENLIST_TOKEN').trim(),
    alistUser: pick('ALIST_USERNAME', 'OPENLIST_USERNAME').trim(),
    alistPass: pick('ALIST_PASSWORD', 'OPENLIST_PASSWORD'),
    alistRoot: pick('ALIST_ROOT', 'OPENLIST_ROOT') || '/',

    // Generic upstream request shaping. No provider is special-cased.
    proxyUserAgent: process.env.PROXY_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    proxyReferer: (process.env.PROXY_REFERER || '').trim(),
    proxyCookie: (process.env.PROXY_COOKIE || '').trim(),
    // Cookie allowlist, comma separated. Empty = send only to the AList host.
    proxyCookieHosts: (process.env.PROXY_COOKIE_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),

    allowAnyUrl: bool(process.env.ALLOW_ANY_URL, false),
    allowPrivate: bool(process.env.ALLOW_PRIVATE_UPSTREAM, false),
    roomMaxMembers: Math.max(2, Number(process.env.ROOM_MAX_MEMBERS || 32)),
    upstreamTimeoutMs: Number(process.env.UPSTREAM_TIMEOUT_MS || 30_000),
  };
}
