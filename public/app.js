// AList Watchparty — browser side.
//
// The player/remux engine and the room/sync engine are vendored from LinWeb
// (MIT, see NOTICE.md). This file is the glue: AList browsing, a source
// descriptor the room can share, external subtitles, and a danmaku discussion.
import { Player } from './src/player.js';
import { TextCues } from './src/subs/text.js';
import { AssOverlay } from './src/subs/ass.js';
import { attachSrt, attachVtt } from './src/subs/srt.js';
import { Room } from './src/together/room.js';
import { PlaybackSync } from './src/together/sync.js';
import { DanmakuLayer } from './danmaku.js';

const $ = s => document.querySelector(s);
const video = $('#video');
const stage = $('#stage');
const logEl = $('#log');
const danmaku = new DanmakuLayer(stage, video, { log: (m) => log(m) });

const state = {
  source: null,          // { kind:'alist', path } | { kind:'url', url }
  info: null,
  videoIndex: 0,
  audioIndex: 0,
  embeddedSub: -1,
  external: null,        // { kind:'track'|'ass', el?, overlay?, label }
  messages: [],
  roomCode: '',
  relay: '',
  name: localStorage.getItem('awp:name') || '',
  remoteSource: null,
  loadToken: 0,
};
let alRoot = '/';

// ---- logging / toast ------------------------------------------------------
function log(msg, level = 'info') {
  const line = document.createElement('div');
  if (level === 'warn' || level === 'error') line.className = level;
  line.textContent = `${new Date().toLocaleTimeString('en-GB')} ${msg}`;
  logEl.append(line);
  while (logEl.childElementCount > 300) logEl.firstElementChild.remove();
  logEl.scrollTop = logEl.scrollHeight;
}
let toastTimer = null;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (err ? ' err' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
}

// ---- player ---------------------------------------------------------------
const player = new Player(video);
player.log = (msg, level) => log(msg, level);
player.onStalled = ({ message }) => {
  toast(`播放中断：${message}`, true);
  log(`读取中断：${message}`, 'error');
};

let textRenderer = null;       // TextCues for embedded text subtitles
let assRenderer = null;        // AssOverlay for embedded ASS
let externalTrack = null;      // <track> for external SRT/VTT
let externalOverlay = null;    // AssOverlay for external ASS
let externalMeta = null;       // { label, mode:'track'|'ass' }

function teardownEmbedded() {
  if (state.embeddedSub >= 0) {
    try { player.disableSubtitle(state.embeddedSub); } catch {}
  }
  textRenderer?.destroy?.().catch?.(() => {});
  assRenderer?.destroy?.().catch?.(() => {});
  textRenderer = null; assRenderer = null;
  player.onSubtitlePacket = null;
  state.embeddedSub = -1;
}

function teardownExternal() {
  if (externalTrack) { externalTrack.remove(); externalTrack = null; }
  externalOverlay?.destroy?.().catch?.(() => {});
  externalOverlay = null;
  externalMeta = null;
}

function teardownSubtitles() {
  teardownEmbedded();
  teardownExternal();
  rebuildSubOptions();
}

function applyEmbedded(index) {
  teardownExternal();
  teardownEmbedded();
  if (index < 0) { rebuildSubOptions(-2); return; }
  const entry = state.info?.subtitles?.[index];
  if (!entry) { log(`没有第 ${index + 1} 条字幕轨`, 'warn'); rebuildSubOptions(-2); return; }
  const fmt = entry.format;
  const language = entry.track?.language || 'und';
  try {
    if (fmt === 'ass' || fmt === 'ssa') {
      const header = entry.track?.codecPrivate;
      if (!header?.length) throw new Error('ASS 轨缺少 CodecPrivate');
      assRenderer = new AssOverlay(video, header, player.fontAttachments().map(f => f.data), {
        vendor: './vendor', log: (m, l) => log(m, l), queryFonts: false,
      });
      player.onSubtitlePacket = block => assRenderer?.push(block);
      player.enableSubtitle(index);
      log(`内嵌 ASS 字幕：${entry.label}`);
    } else if (fmt === 'srt' || fmt === 'vtt') {
      textRenderer = new TextCues(video, { label: entry.label || '字幕', language, log: (m, l) => log(m, l) });
      player.onSubtitlePacket = block => textRenderer?.push(block);
      player.enableSubtitle(index);
      log(`内嵌文本字幕：${entry.label}`);
    } else {
      throw new Error(`暂不支持 ${fmt || '未知'} 字幕渲染`);
    }
    state.embeddedSub = index;
    rebuildSubOptions(index);
  } catch (e) {
    log(`字幕开启失败：${e.message}`, 'error');
    toast(`字幕开启失败：${e.message}`, true);
    teardownEmbedded();
    rebuildSubOptions(-2);
  }
}

async function loadExternalSubtitle(text, label, fmt) {
  teardownExternal();
  teardownEmbedded();
  const format = String(fmt || '').toLowerCase();
  try {
    if (format === 'ass' || format === 'ssa') {
      const overlay = new AssOverlay(video, new TextEncoder().encode(text), [], {
        vendor: './vendor', log: (m, l) => log(m, l), queryFonts: 'local',
      });
      await overlay.ready;
      externalOverlay = overlay;
      externalMeta = { label, mode: 'ass' };
      log(`外挂 ASS 字幕：${label}`);
    } else {
      const isVtt = format === 'vtt' || /^\s*WEBVTT/m.test(text);
      const track = isVtt
        ? attachVtt(video, text, { label, language: 'und' })
        : attachSrt(video, text, { label, language: 'und' });
      externalTrack = track;
      externalMeta = { label, mode: 'track' };
      // A src swap inside player.play() can reset the mode.
      video.addEventListener('loadedmetadata', () => {
        if (externalTrack?.track) externalTrack.track.mode = 'showing';
      });
      log(`外挂文本字幕：${label}`);
    }
    rebuildSubOptions('ext');
    $('#subStatus').textContent = `当前外挂字幕：${label}`;
  } catch (e) {
    log(`外挂字幕失败：${e.message}`, 'error');
    toast(`外挂字幕失败：${e.message}`, true);
    teardownExternal();
    rebuildSubOptions(-2);
  }
}

function rebuildSubOptions(selected) {
  const sel = $('#subSel');
  const keep = selected ?? sel.value;
  sel.replaceChildren();
  const off = document.createElement('option');
  off.value = '-2'; off.textContent = '关闭';
  sel.append(off);
  (state.info?.subtitles || []).forEach((s, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = `${s.format?.toUpperCase() || '字幕'} · ${s.label || `轨道 ${i + 1}`}`;
    sel.append(o);
  });
  if (externalMeta) {
    const o = document.createElement('option');
    o.value = 'ext';
    o.textContent = `外挂 · ${externalMeta.label}`;
    sel.append(o);
  }
  if (keep === 'ext' && externalMeta) sel.value = 'ext';
  else if (/^\d+$/.test(String(keep)) && Number(keep) < (state.info?.subtitles?.length || 0)) sel.value = String(keep);
  else sel.value = '-2';
}

function selectSubtitle(value) {
  if (value === 'ext') { applyExternalAgain(); return; }
  const i = Number(value);
  if (Number.isInteger(i) && i >= 0) applyEmbedded(i);
  else { teardownSubtitles(); rebuildSubOptions(-2); }
}

function applyExternalAgain() {
  // External data is already in the DOM/overlay; only re-assert visibility.
  if (externalTrack?.track) externalTrack.track.mode = 'showing';
  if (externalOverlay) log('外挂 ASS 字幕仍在前台');
  if (!externalMeta) rebuildSubOptions(-2);
}

// ---- track menus ----------------------------------------------------------
function buildTrackMenus() {
  const vSel = $('#videoTrack'), aSel = $('#audioTrack');
  vSel.replaceChildren(); aSel.replaceChildren();
  const info = state.info;
  if (!info || info.native) {
    for (const sel of [vSel, aSel]) {
      const o = document.createElement('option');
      o.textContent = '原生播放（由浏览器选择）';
      sel.append(o);
      sel.disabled = true;
    }
    rebuildSubOptions(-2);
    return;
  }
  info.video.forEach((v, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = v.label + (v.supported ? '' : ' · 不支持');
    vSel.append(o);
  });
  info.audio.forEach((a, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = a.label + (a.supported ? '' : ' · 软件/不支持');
    aSel.append(o);
  });
  vSel.disabled = false; aSel.disabled = false;
  vSel.value = String(state.videoIndex);
  aSel.value = String(state.audioIndex);
  rebuildSubOptions(state.embeddedSub >= 0 ? state.embeddedSub : (externalMeta ? 'ext' : -2));
}

async function restartWithTracks() {
  if (!state.info || state.info.native) return;
  state.videoIndex = Number($('#videoTrack').value) || 0;
  state.audioIndex = Number($('#audioTrack').value) || 0;
  const keepSub = state.embeddedSub;
  try {
    await player.play({ videoIndex: state.videoIndex, audioIndex: state.audioIndex });
    log(`已切换轨道：视频 ${state.videoIndex + 1} / 音频 ${state.audioIndex + 1}`);
    if (keepSub >= 0) applyEmbedded(keepSub); else rebuildSubOptions(externalMeta ? 'ext' : -2);
    syncToRoom(true);
  } catch (e) {
    log(`切换轨道失败：${e.message}`, 'error');
    toast(`切换轨道失败：${e.message}`, true);
  }
}

// ---- source loading -------------------------------------------------------
function showPlaceholder(title, hint) {
  const p = $('#placeholder');
  p.style.display = '';
  const b = p.querySelector('b'); const s = p.querySelector('span');
  if (b) b.textContent = title || '从右侧选择片源';
  if (s) s.textContent = hint || 'AList / OpenList / 小雅 alist，或任意 MP4 / MKV / WebM / FLV 直链';
}

function setNowPlaying(title, meta) {
  $('#nowTitle').textContent = title || '未命名';
  $('#nowMeta').textContent = meta || '';
  $('#placeholder').style.display = 'none';
  try { document.title = `${title || 'AList Watchparty'} · AList Watchparty`; } catch {}
}

function isHls(url) { return /\.(m3u8|mpd)(\?|$)/i.test(url || ''); }

async function startPlayback(source, stream, size = 0) {
  const token = ++state.loadToken;
  teardownSubtitles();
  state.source = source;
  state.info = null;
  state.remoteSource = null;
  hideOffer();
  const sourceName = source.url || source.path || source.title || stream;
  setNowPlaying(source.title || '载入中…', isHls(sourceName) ? 'HLS/DASH 暂不支持' : '正在解析容器…');
  if (isHls(sourceName)) {
    toast('HLS / DASH 暂不支持，请使用 MP4 / MKV / WebM / FLV 直链', true);
    log('检测到 HLS/DASH：当前播放器只处理可分片读取的文件容器', 'warn');
    showPlaceholder('HLS / DASH 暂不支持', '请换成 MP4 / MKV / WebM / FLV 直链；HLS 需要额外集成 hls.js。');
    return;
  }
  try {
    const info = await player.load(stream);
    if (token !== state.loadToken) return;
    state.info = info;
    state.videoIndex = 0; state.audioIndex = 0;
    setNowPlaying(
      source.title || info.name || '视频',
      [
        info.container || (info.native ? '原生' : ''),
        info.duration ? `${fmtTime(info.duration)}` : '',
        size || info.size ? fmtBytes(size || info.size) : '',
        info.native ? '原生解码' : `${info.video.length} 视频 / ${info.audio.length} 音频 / ${info.subtitles.length} 字幕`,
      ].filter(Boolean).join(' · ')
    );
    buildTrackMenus();
    if (!info.native) await player.play({ videoIndex: 0, audioIndex: 0 });
    if (token !== state.loadToken) return;
    video.play().catch(e => log(`自动播放被浏览器拦下：${e.name}`, 'warn'));
    stampSource(source);
    if (room.isHost && room.connected) shareSource();
    syncToRoom(true);
    log(`已载入：${source.title || info.name}（${info.native ? '原生' : '重封装 MSE'}）`);
  } catch (e) {
    if (token !== state.loadToken) return;
    log(`载入失败：${e.message}`, 'error');
    toast(`载入失败：${e.message}`, true);
    setNowPlaying(source.title || '载入失败', e.message);
    showPlaceholder('载入失败', e.message);
  }
}

function stampSource(source) {
  try {
    const q = new URLSearchParams();
    if (source.kind === 'alist' || source.kind === 'openlist') q.set('path', source.path);
    else if (source.kind === 'url') q.set('url', source.url);
    const search = q.toString();
    history.replaceState(null, '', `${location.pathname}${search ? '?' + search : ''}${location.hash}`);
  } catch {}
}

async function playAList(path, title) {
  try {
    $('#alStatus').textContent = '解析地址…';
    const r = await postJson('/api/alist/resolve', { path });
    if (!r.ok) throw new Error(r.error || '解析失败');
    $('#alStatus').textContent = '';
    await startPlayback(
      { kind: 'alist', path, title: title || r.title, size: r.size },
      r.stream, r.size,
    );
  } catch (e) {
    $('#alStatus').textContent = e.message;
    log(`AList 解析失败：${e.message}`, 'error');
    toast(`AList 解析失败：${e.message}`, true);
  }
}

async function playDirect(url) {
  try {
    const r = await postJson('/api/resolve', { url });
    if (!r.ok) throw new Error(r.error || '解析失败');
    await startPlayback({ kind: 'url', url, title: r.title }, r.stream);
  } catch (e) {
    log(`直链解析失败：${e.message}`, 'error');
    toast(`直链解析失败：${e.message}`, true);
  }
}

async function loadSubtitleUrl(url) {
  try {
    $('#subStatus').textContent = '取字幕…';
    const abs = new URL(url, location.href);
    let target = abs.toString();
    if (abs.origin !== location.origin) {
      const signed = await postJson('/api/subtitle/sign', { url: target });
      if (!signed.ok) throw new Error(signed.error || '字幕代理签名失败');
      target = signed.url;
    }
    const r = await fetch(target);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    const name = decodeURIComponent(abs.pathname.split('/').pop() || '外挂字幕');
    const fmt = (name.match(/\.(srt|vtt|ass|ssa)$/i)?.[1] || '').toLowerCase() || (/^\s*WEBVTT/m.test(text) ? 'vtt' : 'srt');
    await loadExternalSubtitle(text, name, fmt);
    $('#subStatus').textContent = `当前外挂字幕：${name}`;
  } catch (e) {
    $('#subStatus').textContent = e.message;
    log(`字幕加载失败：${e.message}`, 'error');
    toast(`字幕加载失败：${e.message}`, true);
  }
}

async function loadAListSubtitle(path, title) {
  try {
    const r = await postJson('/api/alist/resolve', { path });
    if (!r.ok) throw new Error(r.error || '解析失败');
    const abs = new URL(r.subtitle, location.href);
    const text = await (await fetch(abs)).text();
    const name = title || path.split('/').pop() || '字幕';
    const fmt = (name.match(/\.(srt|vtt|ass|ssa)$/i)?.[1] || '').toLowerCase() || 'srt';
    await loadExternalSubtitle(text, name, fmt);
  } catch (e) {
    log(`AList 字幕失败：${e.message}`, 'error');
    toast(`AList 字幕失败：${e.message}`, true);
  }
}

// ---- AList browser -----------------------------------------------------
const VIDEO_EXT = /\.(mp4|m4v|mkv|webm|mov|flv|ts|m2ts|avi|wmv|rmvb)$/i;
const SUB_EXT = /\.(srt|vtt|ass|ssa)$/i;

async function postJson(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  let data;
  try { data = await r.json(); } catch { data = { ok: false, error: `HTTP ${r.status}` }; }
  if (!r.ok && !data.error) data.error = `HTTP ${r.status}`;
  return data;
}

function crumb(path, root) {
  const box = $('#alCrumb');
  box.replaceChildren();
  const rootBtn = document.createElement('button');
  rootBtn.className = 'btn ghost'; rootBtn.type = 'button'; rootBtn.textContent = '根目录';
  rootBtn.onclick = () => loadDir(root || '/');
  box.append(rootBtn);
  let acc = '';
  for (const part of path.split('/').filter(Boolean)) {
    acc += '/' + part;
    const b = document.createElement('button');
    b.className = 'btn ghost'; b.type = 'button'; b.textContent = part;
    b.onclick = () => loadDir(acc);
    box.append(document.createTextNode(' / '), b);
  }
}

async function loadDir(path) {
  $('#alStatus').textContent = '';
  $('#alPath').value = path;
  $('#alList').replaceChildren(Object.assign(document.createElement('li'), { className: 'muted', textContent: '载入中…' }));
  try {
    const r = await postJson('/api/alist/list', { path });
    if (!r.ok) throw new Error(r.error || '列目录失败');
    crumb(r.path, alRoot);
    const list = $('#alList');
    list.replaceChildren();
    const up = document.createElement('li');
    up.innerHTML = '<span class="ico">↰</span><span class="nm">返回上一级</span>';
    up.onclick = () => loadDir(r.path.replace(/\/[^/]+$/, '') || '/');
    if (r.path !== '/') list.append(up);
    if (!r.items.length) {
      const li = document.createElement('li');
      li.className = 'muted'; li.textContent = '空目录';
      list.append(li);
    }
    for (const it of r.items) {
      const li = document.createElement('li');
      if (it.isDir) li.className = 'dir';
      const ico = document.createElement('span');
      ico.className = 'ico';
      ico.textContent = it.isDir ? '📁' : (SUB_EXT.test(it.name) ? '字' : '🎬');
      const nm = document.createElement('span');
      nm.className = 'nm'; nm.textContent = it.name; nm.title = it.path;
      const sz = document.createElement('span');
      sz.className = 'sz'; sz.textContent = it.isDir ? '' : fmtBytes(it.size);
      li.append(ico, nm, sz);
      li.onclick = () => {
        if (it.isDir) loadDir(it.path);
        else if (SUB_EXT.test(it.name)) loadAListSubtitle(it.path, it.name);
        else if (VIDEO_EXT.test(it.name)) playAList(it.path, it.name);
        else toast('这个文件不是视频或字幕', true);
      };
      list.append(li);
    }
  } catch (e) {
    $('#alStatus').textContent = e.message;
    $('#alList').replaceChildren(Object.assign(document.createElement('li'), { className: 'muted', textContent: e.message }));
    log(`AList 列目录失败：${e.message}`, 'error');
  }
}

// ---- room / sync ----------------------------------------------------------
const room = new Room({ log: (m, l) => log(m, l), onEvent: onRoomEvent });
const sync = new PlaybackSync(video, room, {
  log: (m, l) => log(m, l),
  onChange: paintRoomState,
});

function randomCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = crypto.getRandomValues(new Uint8Array(6));
  return [...a].map(b => abc[b % abc.length]).join('');
}

function defaultRelay() {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
}

function onRoomEvent(m) {
  if (m.t === 'status') {
    const open = m.state === 'open';
    $('#conn').textContent = open ? '房间已连接' : m.state === 'retrying' ? '重连中…' : '未连接房间';
    $('#conn').className = 'pill ' + (open ? 'on' : 'off');
    if (open) sync.start();
    if (m.state === 'closed' || m.state === 'retrying') sync.stop();
    if (m.detail) log(`房间：${m.detail}`, m.state === 'closed' ? 'warn' : 'info');
  }
  if (m.t === 'welcome') {
    state.roomCode = room.code;
    state.relay = room.url;
    sync.start();
    sync.onMessage(m);
    renderMembers();
    $('#roomCodeShow').textContent = room.code;
    $('#roomStatus').textContent = room.isHost ? '房间已创建，把邀请链接发给朋友。' : '已加入房间。';
    $('#roomInfo').hidden = false;
    $('#roomLeave').hidden = false;
    $('#roomCopy').hidden = false;
    if (Array.isArray(m.chat)) {
      for (const c of m.chat) addMessage(c, { history: true });
    }
    if (room.isHost) shareSource();
    if (m.media) handleRemoteMedia(m.media);
    log(`已加入房间 ${room.code}（${room.isHost ? '房主' : '成员'}）`);
  } else {
    sync.onMessage(m);
  }
  if (m.t === 'join' || m.t === 'leave' || m.t === 'host') {
    renderMembers();
    // A host handover can arrive as a `leave` frame, not only as `host`.
    if (room.isHost) shareSource();
  }
  if (m.t === 'chat') addMessage(m);
  if (m.t === 'media') handleRemoteMedia(m);
  if (m.t === 'denied') toast(m.why === 'pass' ? '房间密码不对' : '房间已满', true);
}

function paintRoomState() {
  const open = room.connected;
  $('#conn').textContent = open ? '房间已连接' : '未连接房间';
  $('#conn').className = 'pill ' + (open ? 'on' : 'off');
  if (!open) {
    $('#syncState').textContent = '未加入房间';
    $('#waitState').textContent = '';
    return;
  }
  const bits = [];
  bits.push(room.isHost ? '你是房主' : `房主：${room.nameOf(room.host) || '…'}`);
  if (Number.isFinite(sync.drift) && Math.abs(sync.drift) > 0.15) {
    bits.push(`${sync.drift > 0 ? '+' : ''}${sync.drift.toFixed(1)}s`);
  }
  if (room.rtt != null) bits.push(`RTT ${Math.round(room.rtt)}ms`);
  $('#syncState').textContent = bits.join(' · ');
  if (Number.isFinite(sync.baseRate)) $('#rate').value = String(sync.baseRate);
  const held = room.members.filter(x => sync.waiters.includes(x.id)).map(x => x.name);
  $('#waitState').textContent = held.length ? `等待缓冲：${held.join('、')}` : '';
}

function renderMembers() {
  const box = $('#members');
  box.replaceChildren();
  for (const m of room.members) {
    const s = document.createElement('span');
    if (m.id === room.host) s.className = 'host';
    s.textContent = (m.id === room.id ? '你 · ' : '') + (m.name || '匿名') + (m.id === room.host ? ' · 房主' : '');
    box.append(s);
  }
}

function joinRoom() {
  const code = ($('#roomCode').value.trim() || randomCode()).toUpperCase();
  const name = $('#roomName').value.trim() || state.name || '匿名';
  const relay = $('#relay').value.trim() || defaultRelay();
  const pass = $('#roomPass').value;
  state.name = name; state.relay = relay;
  localStorage.setItem('awp:name', name);
  $('#roomName').value = name;
  $('#roomCode').value = code;
  $('#relay').value = relay;
  $('#roomStatus').textContent = `连接 ${code}…`;
  room.connect(relay, code, name, pass);
}

function leaveRoom() {
  sync.stop();
  room.disconnect();
  state.roomCode = '';
  state.remoteSource = null;
  $('#roomInfo').hidden = true;
  $('#roomLeave').hidden = true;
  $('#roomCopy').hidden = true;
  $('#members').replaceChildren();
  $('#roomStatus').textContent = '已退出房间。';
  hideOffer();
  paintRoomState();
  try { history.replaceState(null, '', location.pathname + location.search); } catch {}
}

async function copyInvite() {
  if (!room.connected) return;
  const relay = state.relay || defaultRelay();
  const pass = room.pass || '';
  const h = new URLSearchParams({ together: room.code, relay });
  if (pass) h.set('pass', pass);
  const url = `${location.origin}${location.pathname}${location.search}#${h}`;
  try { await navigator.clipboard.writeText(url); toast('邀请链接已复制'); }
  catch { prompt('复制这个邀请链接', url); }
}

function shareSource() {
  if (!room.connected || !room.isHost || !state.source) return;
  const want = { ...state.source };
  const href = location.href;
  sync.shareMedia({ href, want });
  log(`已向房间共享片源：${want.title || want.path || want.url}`);
}

function sameSource(a, b) {
  if (!a || !b) return false;
  const isAlist = x => x.kind === 'alist' || x.kind === 'openlist';
  if (isAlist(a) && isAlist(b)) return a.path === b.path;
  if (a.kind === 'url' && b.kind === 'url') return a.url === b.url;
  return false;
}

function handleRemoteMedia(m) {
  const want = m?.want;
  if (!want || m.from === room.id) return;
  if (sameSource(want, state.source)) { hideOffer(); return; }
  state.remoteSource = want;
  $('#offerText').textContent = `房间在放《${want.title || want.path || want.url || '片源'}》`;
  $('#sourceOffer').hidden = false;
  log(`房间片源：${want.title || want.path || want.url}`);
  if (!state.source || video.readyState === 0) followRoomSource();
}

async function followRoomSource() {
  const want = state.remoteSource;
  if (!want) return;
  hideOffer();
  if ((want.kind === 'alist' || want.kind === 'openlist') && want.path) await playAList(want.path, want.title);
  else if (want.kind === 'url' && want.url) await playDirect(want.url);
  else toast('房主分享的片源缺少地址', true);
  syncToRoom(true);
}

function hideOffer() {
  $('#sourceOffer').hidden = true;
}

/** After a source is loaded, align a paused room and let the tick handle drift. */
function syncToRoom(force = false) {
  if (!room.connected || !sync.enabled) return;
  const s = sync.state;
  if (!s) return;
  const target = sync.target();
  if (!Number.isFinite(target)) return;
  if (force || Math.abs(video.currentTime - target) > 2.5) {
    try { video.currentTime = Math.max(0, target); } catch {}
  }
  if (s.paused && !video.paused) video.pause();
  else if (!s.paused && video.paused) video.play().catch(e => log(`房间播放被拦：${e.name}`, 'warn'));
}

// ---- chat / danmaku -------------------------------------------------------
function fmtTime(s) {
  if (!Number.isFinite(s) || s < 0) return '--:--';
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}

function addMessage(m, { history = false } = {}) {
  const id = m.id || `${m.from || 'x'}:${m.s || ''}:${m.text || ''}`;
  if (state.messages.some(x => x.id === id)) return;
  const msg = { id, name: m.name || '匿名', text: String(m.text || ''), pos: Number.isFinite(m.pos) ? m.pos : null };
  state.messages.push(msg);
  if (state.messages.length > 200) state.messages.shift();

  const box = $('#chatList');
  const placeholder = box.querySelector('.muted');
  if (placeholder) placeholder.remove();
  const line = document.createElement('div');
  line.className = 'chatline';
  const at = document.createElement('span');
  at.className = 'at';
  at.textContent = msg.pos == null ? '--:--' : fmtTime(msg.pos);
  at.title = '跳到这里';
  at.onclick = () => { if (msg.pos != null) { try { video.currentTime = msg.pos; } catch {} } };
  const who = document.createElement('span');
  who.className = 'who'; who.textContent = msg.name;
  const txt = document.createElement('span');
  txt.className = 'txt'; txt.textContent = msg.text;
  line.append(at, who, txt);
  const wasBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 30;
  box.append(line);
  while (box.childElementCount > 250) box.firstElementChild.remove();
  if (wasBottom) box.scrollTop = box.scrollHeight;

  if (!history && $('#dmkToggle').checked) {
    danmaku.add({ name: msg.name, text: msg.text });
  }
}

function sendChat() {
  const input = $('#chatText');
  const text = input.value.trim();
  if (!text) return;
  if (!room.connected) { toast('先加入一个房间再发言', true); return; }
  room.sendChat(text, Number.isFinite(video.currentTime) ? video.currentTime : null);
  input.value = '';
}

// ---- formatting -----------------------------------------------------------
function fmtBytes(n) {
  n = Number(n) || 0;
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

// ---- wire UI --------------------------------------------------------------
document.querySelectorAll('.tab').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b === btn));
    $('#tab-alist').hidden = btn.dataset.tab !== 'alist';
    $('#tab-url').hidden = btn.dataset.tab !== 'url';
  };
});

$('#alGo').onclick = () => loadDir($('#alPath').value || '/');
$('#alPath').addEventListener('keydown', e => { if (e.key === 'Enter') loadDir($('#alPath').value || '/'); });
$('#directGo').onclick = () => { const u = $('#directUrl').value.trim(); if (u) playDirect(u); };
$('#directUrl').addEventListener('keydown', e => { if (e.key === 'Enter') { const u = $('#directUrl').value.trim(); if (u) playDirect(u); } });
$('#subLoad').onclick = () => { const u = $('#subUrl').value.trim(); if (u) loadSubtitleUrl(u); };
$('#subFile').onchange = async e => {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    const text = await f.text();
    const fmt = (f.name.match(/\.(srt|vtt|ass|ssa)$/i)?.[1] || 'srt').toLowerCase();
    await loadExternalSubtitle(text, f.name, fmt);
  } catch (err) { toast(`读取字幕失败：${err.message}`, true); }
  e.target.value = '';
};
$('#subOff').onclick = () => { teardownSubtitles(); rebuildSubOptions(-2); };
$('#subSel').onchange = e => selectSubtitle(e.target.value);
$('#videoTrack').onchange = restartWithTracks;
$('#audioTrack').onchange = restartWithTracks;
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
for (const r of RATES) {
  const o = document.createElement('option');
  o.value = String(r); o.textContent = `${r}×`;
  $('#rate').append(o);
}
$('#rate').value = '1';
$('#rate').onchange = e => {
  const r = Number(e.target.value) || 1;
  video.defaultPlaybackRate = video.playbackRate = r;
  if (room.connected && sync.enabled) sync.setRate(r);
  else log(`倍速 ${r}×`);
};
$('#dmkToggle').onchange = e => danmaku.setEnabled(e.target.checked);
$('#roomGo').onclick = joinRoom;
$('#roomLeave').onclick = leaveRoom;
$('#roomCopy').onclick = copyInvite;
$('#offerGo').onclick = followRoomSource;
$('#chatSend').onclick = sendChat;
$('#chatText').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });
$('#fsBtn').onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else stage.requestFullscreen?.().catch(e => toast(`全屏失败：${e.message}`, true));
};

// ---- boot -----------------------------------------------------------------
(async function boot() {
  const cfg = await fetch('/api/config').then(r => r.json()).catch(() => ({ ok: false }));
  alRoot = cfg.alistRoot || '/';
  if (cfg.alist) loadDir(alRoot);
  else {
    $('#tab-alist').hidden = true;
    document.querySelector('.tab[data-tab="alist"]').classList.add('disabled');
    document.querySelector('.tab[data-tab="url"]').click();
    $('#alStatus').textContent = '未配置 AList（.env 里的 ALIST_URL）；仍可用直链播放。';
  }

  const name = state.name || `观众${Math.floor(Math.random() * 900 + 100)}`;
  $('#roomName').value = name;
  const relay = defaultRelay();
  $('#relay').value = localStorage.getItem('awp:relay') || relay;

  // Deep links: ?path=... / ?url=... and #together=...&relay=...
  const params = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (params.get('path')) playAList(params.get('path'));
  else if (params.get('url')) playDirect(params.get('url'));

  if (hash.get('together')) {
    $('#roomCode').value = (hash.get('together') || '').toUpperCase();
    if (hash.get('relay')) $('#relay').value = hash.get('relay');
    if (hash.get('pass')) $('#roomPass').value = hash.get('pass');
    joinRoom();
  }
})();
