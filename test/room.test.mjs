import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openWs, nextFrame, sleep } from './helpers.mjs';

test('room broadcasts state and chat, and late joiners get history', async t => {
  const app = await startApp();
  t.after(() => app.stop());

  const a = await openWs(`${app.ws}/room/ROOM01`);
  const welcomeA = nextFrame(a, m => m.t === 'welcome');
  a.send(JSON.stringify({ t: 'hello', name: 'Alice' }));
  const wa = await welcomeA;
  assert.equal(wa.you, wa.host);

  const chatA = nextFrame(a, m => m.t === 'chat' && m.text === 'first');
  const stateA = nextFrame(a, m => m.t === 'state' && m.pos === 42);
  a.send(JSON.stringify({ t: 'chat', text: 'first', pos: 12.5 }));
  a.send(JSON.stringify({ t: 'state', paused: false, pos: 42, rate: 1 }));
  await chatA;
  await stateA;

  const b = await openWs(`${app.ws}/room/ROOM01`);
  const welcomeB = nextFrame(b, m => m.t === 'welcome');
  b.send(JSON.stringify({ t: 'hello', name: 'Bob' }));
  const wb = await welcomeB;
  assert.equal(wb.state.pos, 42);
  assert.equal(wb.chat.length, 1);
  assert.equal(wb.chat[0].text, 'first');
  assert.equal(wb.chat[0].pos, 12.5);

  const gotChat = nextFrame(b, m => m.t === 'chat' && m.text === 'second');
  a.send(JSON.stringify({ t: 'chat', text: 'second', pos: 50 }));
  const chat = await gotChat;
  assert.equal(chat.name, 'Alice');
  assert.equal(chat.pos, 50);

  const gotState = nextFrame(b, m => m.t === 'state' && m.pos === 43);
  a.send(JSON.stringify({ t: 'state', paused: true, pos: 43, rate: 1 }));
  const st = await gotState;
  assert.equal(st.paused, true);

  a.close(); b.close();
});

test('room password is enforced', async t => {
  const app = await startApp();
  t.after(() => app.stop());

  const a = await openWs(`${app.ws}/room/LOCKED`);
  const welcomeA = nextFrame(a, m => m.t === 'welcome');
  a.send(JSON.stringify({ t: 'hello', name: 'Host', pass: 'secret' }));
  const welcome = await welcomeA;
  assert.ok(welcome.you);

  const b = await openWs(`${app.ws}/room/LOCKED`);
  const deniedB = nextFrame(b, m => m.t === 'denied');
  b.send(JSON.stringify({ t: 'hello', name: 'Guest', pass: 'wrong' }));
  const denied = await deniedB;
  assert.equal(denied.why, 'pass');
  a.close(); b.close();
});
