import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

export async function freePort() {
  const s = net.createServer();
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  const port = s.address().port;
  s.close();
  await once(s, 'close');
  return port;
}

export async function startApp(extraEnv = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      PROXY_SECRET: 'test-secret',
      ALLOW_ANY_URL: '1',
      ALLOW_PRIVATE_UPSTREAM: '1',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode != null) throw new Error(`server exited early:\n${out}`);
    try {
      const r = await fetch(base + '/api/health');
      if (r.ok) break;
    } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  return {
    base,
    ws: `ws://127.0.0.1:${port}`,
    port,
    child,
    output: () => out,
    stop: async () => { child.kill('SIGTERM'); await Promise.race([once(child, 'exit'), new Promise(r => setTimeout(r, 1000))]); },
  };
}

export async function mockServer(handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    close: async () => { server.close(); await once(server, 'close'); },
  };
}

export function openWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error('ws open timeout')), 3000);
    ws.onopen = () => { clearTimeout(timer); resolve(ws); };
    ws.onerror = e => { clearTimeout(timer); reject(e); };
  });
}

export function nextFrame(ws, predicate = () => true, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.removeEventListener('message', on); reject(new Error('frame timeout')); }, timeout);
    const on = e => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (!predicate(m)) return;
      clearTimeout(timer);
      ws.removeEventListener('message', on);
      resolve(m);
    };
    ws.addEventListener('message', on);
  });
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
