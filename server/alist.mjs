// AList-compatible client: AList, OpenList and any fork that keeps the same
// /api/fs/list + /api/fs/get surface (including 小雅 alist). Everything here
// runs on the server, so the token never reaches the browser.
//
// The two calls that matter:
//   POST /api/fs/list  -> the browser's file picker
//   POST /api/fs/get   -> the storage's raw URL for one file
//
// A cloud-drive backed AList usually returns a signed CDN URL from fs/get. That
// URL is handed to the stream proxy, which adds the UA/Referer/Cookie that a
// browser cannot set and follows redirects manually.
import { normalizePath, encodePath } from './util.mjs';

export class AList {
  constructor(cfg, log = () => {}) {
    this.base = cfg.alistUrl;
    this.token = cfg.alistToken;
    this.user = cfg.alistUser;
    this.pass = cfg.alistPass;
    this.log = log;
    this._login = null;
  }

  get configured() { return !!this.base; }

  async ensureToken() {
    if (this.token) return this.token;
    if (!this.user) throw new Error('AList 未配置 token，也没有用户名/密码');
    if (!this._login) {
      this._login = (async () => {
        const r = await this._fetch('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username: this.user, password: this.pass }),
        }, false);
        const token = r?.data?.token || r?.data?.Token;
        if (!token) throw new Error('AList 登录没有返回 token');
        this.token = token;
        this.log('AList 登录成功');
        return token;
      })().finally(() => { this._login = null; });
    }
    return this._login;
  }

  async _fetch(path, init = {}, auth = true) {
    const url = this.base + path;
    const headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
    if (auth) headers.Authorization = await this.ensureToken();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20_000);
    let r;
    try {
      r = await fetch(url, { ...init, headers, signal: ac.signal });
    } catch (e) {
      throw new Error(`AList 请求失败 (${e.name}): ${e.message}`);
    } finally { clearTimeout(timer); }
    const text = await r.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; }
    catch { throw new Error(`AList 返回了非 JSON (${r.status}): ${text.slice(0, 120)}`); }
    if (!r.ok || (data.code != null && data.code !== 200)) {
      throw new Error(`AList ${r.status}/${data.code ?? '?'}: ${data.message || text.slice(0, 120)}`);
    }
    return data;
  }

  async list(path = '/') {
    const p = normalizePath(path);
    const data = await this._fetch('/api/fs/list', {
      method: 'POST',
      body: JSON.stringify({ path: p, password: '', page: 1, per_page: 500, refresh: false }),
    });
    const content = data?.data?.content || [];
    const items = content.map(it => ({
      name: String(it.name ?? ''),
      path: normalizePath((p === '/' ? '' : p) + '/' + it.name),
      isDir: !!it.is_dir,
      size: Number(it.size) || 0,
      modified: it.modified || '',
      type: it.type ?? 0,
    })).filter(it => it.name && !it.name.startsWith('.'));
    items.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name, 'zh-CN'));
    return { path: p, items };
  }

  async resolve(path) {
    const p = normalizePath(path);
    const data = await this._fetch('/api/fs/get', {
      method: 'POST',
      body: JSON.stringify({ path: p, password: '' }),
    });
    const d = data?.data || {};
    if (d.is_dir) throw Object.assign(new Error('这是一个目录，不是视频文件'), { status: 400 });
    let raw = d.raw_url || d.rawUrl || d.url || '';
    // Older/odd builds omit raw_url for some drivers. /d<path> is AList's
    // own direct route; the proxy supplies the Authorization header.
    if (!raw) raw = `${this.base}/d${encodePath(p)}`;
    let url;
    try { url = new URL(raw, this.base + '/').toString(); }
    catch { throw new Error('AList 返回的 raw_url 不是合法 URL'); }
    return {
      path: p,
      url,
      name: d.name || p.split('/').pop() || 'video',
      size: Number(d.size) || 0,
      type: d.type ?? 0,
    };
  }

  // A stream URL is resolved fresh, which matters for 网盘: the CDN signature
  // expires, and the room should not inherit a dead link from an hour ago.
  host() {
    try { return new URL(this.base).hostname; } catch { return ''; }
  }
}
