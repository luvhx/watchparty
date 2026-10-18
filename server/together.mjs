// Watch-party WebSocket endpoint, on the same HTTP server as the site.
//
// The protocol decisions live in public/src/together/relay.js (shared with the
// browser-side room/sync code). This file is only RFC 6455: handshake, frame
// decode, and forwarding. No `ws` dependency; the subset a relay needs is a
// SHA-1 handshake and a length-prefixed frame.
import { createHash } from 'node:crypto';
import { Relay } from '../public/src/together/relay.js';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 1 << 20;          // chat + state frames are tiny; SDP is a few KB
const IDLE_MS = 120_000;            // clients ping every 25s
const SWEEP_MS = 15_000;

function frame(opcode, payload) {
  const len = payload.length;
  const head = len < 126 ? Buffer.alloc(2) : len < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  head[0] = 0x80 | opcode;
  if (len < 126) head[1] = len;
  else if (len < 65536) { head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, payload]);
}

function unframe(buf) {
  const frames = [];
  let p = 0;
  while (p + 2 <= buf.length) {
    const b0 = buf[p], b1 = buf[p + 1];
    const fin = (b0 & 0x80) !== 0, opcode = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f, q = p + 2;
    if (len === 126) { if (q + 2 > buf.length) break; len = buf.readUInt16BE(q); q += 2; }
    else if (len === 127) {
      if (q + 8 > buf.length) break;
      const big = buf.readBigUInt64BE(q); q += 8;
      if (big > BigInt(MAX_FRAME)) return { frames, rest: buf, fatal: 'frame too large' };
      len = Number(big);
    }
    if (len > MAX_FRAME) return { frames, rest: buf, fatal: 'frame too large' };
    if (!masked) return { frames, rest: buf, fatal: 'unmasked frame from client' };
    if (q + 4 + len > buf.length) break;
    const key = buf.subarray(q, q + 4); q += 4;
    const payload = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) payload[i] = buf[q + i] ^ key[i & 3];
    q += len;
    frames.push({ fin, opcode, payload });
    p = q;
  }
  return { frames, rest: buf.subarray(p), fatal: null };
}

export function attachTogether(server, cfg, log = () => {}) {
  const rooms = new Map();          // code -> Relay

  server.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { socket.destroy(); return; }
    const m = url.pathname.match(/^\/room\/([^/]{1,64})$/);
    if (!m) { socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
    if ((req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    if (head?.length) socket.unshift(head);
    attach(socket, decodeURIComponent(m[1]).toUpperCase());
  });

  function attach(socket, code) {
    let relay = rooms.get(code);
    if (!relay) { relay = new Relay({ maxMembers: cfg.roomMaxMembers }); rooms.set(code, relay); }
    log(`room ${code}: member joined`);

    let buf = Buffer.alloc(0);
    let cont = null;
    let closed = false;

    const conn = {
      send(msg) {
        if (closed || socket.destroyed) return;
        try { socket.write(frame(0x1, Buffer.from(JSON.stringify(msg), 'utf8'))); } catch {}
      },
      close() { end(1000); },
    };

    function end(code_ = 1000) {
      if (closed) return;
      closed = true;
      try { socket.write(frame(0x8, Buffer.from([code_ >> 8, code_ & 0xff]))); } catch {}
      socket.destroy();
      if (relay.leave(conn) && !relay.size) { rooms.delete(code); log(`room ${code}: empty`); }
    }

    socket.setTimeout(IDLE_MS, () => end(1001));
    socket.on('end', () => end());
    socket.on('error', () => end());
    socket.on('close', () => {
      if (closed) return;
      closed = true;
      if (relay.leave(conn) && !relay.size) { rooms.delete(code); log(`room ${code}: empty`); }
    });

    socket.on('data', chunk => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      const { frames, rest, fatal } = unframe(buf);
      buf = rest;
      if (fatal) { try { socket.destroy(); } catch {} return; }
      for (const f of frames) {
        if (f.opcode === 0x8) { end(1000); return; }
        if (f.opcode === 0x9) { try { socket.write(frame(0xA, f.payload)); } catch {} continue; }
        if (f.opcode === 0xA) continue;
        if (f.opcode === 0x0) {
          if (!cont) continue;
          cont.chunks.push(f.payload);
          if (!f.fin) continue;
          const whole = Buffer.concat(cont.chunks);
          handleMessage(whole);
          cont = null;
          continue;
        }
        if (f.opcode === 0x1 || f.opcode === 0x2) {
          if (!f.fin) { cont = { opcode: f.opcode, chunks: [f.payload] }; continue; }
          handleMessage(f.payload);
        }
      }
    });

    function handleMessage(payload) {
      let msg;
      try { msg = JSON.parse(payload.toString('utf8')); } catch { return; }
      relay.message(conn, msg);
    }
  }

  // Sweep agents that vanished without a close frame. Relay is application-level
  // about this because a socket timeout is reset by writes (the host broadcasts).
  setInterval(() => {
    for (const [code, relay] of rooms) {
      if (relay.sweep()) {
        if (!relay.size) { rooms.delete(code); log(`room ${code}: swept empty`); }
      }
    }
  }, SWEEP_MS).unref?.();

  return rooms;
}
