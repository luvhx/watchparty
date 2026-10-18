// A small canvas danmaku layer.
//
// The player already has a <video> and a stage; this draws one line of text per
// comment, right to left, in lanes. It is deliberately not a full danmaku
// engine: no collision solver beyond "is the lane's last item far enough left",
// no styling DSL. That is the right size for a discussion sidebar.
const COLORS = ['#ffffff', '#ffd166', '#8ecae6', '#ff8fab', '#a7f3d0', '#c4b5fd', '#fca5a5'];

function pickColor(seed) {
  let h = 0;
  for (const ch of String(seed || 'x')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export class DanmakuLayer {
  constructor(stage, video, { log = () => {} } = {}) {
    this.stage = stage;
    this.video = video;
    this.log = log;
    this.canvas = stage.querySelector('canvas#danmaku') || document.createElement('canvas');
    if (!this.canvas.isConnected) {
      this.canvas.id = 'danmaku';
      stage.append(this.canvas);
    }
    this.ctx = this.canvas.getContext('2d');
    this.enabled = true;
    this.items = [];
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this._last = 0;
    this._raf = null;
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(stage);
    this._onSeek = () => this.clear();
    video.addEventListener('seeking', this._onSeek);
    this.resize();
    this._loop = t => {
      this._raf = requestAnimationFrame(this._loop);
      const dt = this._last ? Math.min(0.05, (t - this._last) / 1000) : 0;
      this._last = t;
      this.tick(dt);
    };
    this._raf = requestAnimationFrame(this._loop);
  }

  resize() {
    const r = this.stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = r.width;
    this.height = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.clear();
  }

  setEnabled(on) {
    this.enabled = !!on;
    this.canvas.style.display = this.enabled ? '' : 'none';
    if (!this.enabled) this.clear();
  }

  clear() {
    this.items = [];
    if (this.ctx) this.ctx.clearRect(0, 0, this.width, this.height);
  }

  /** @param {{text:string,name?:string,color?:string}} msg */
  add(msg) {
    if (!this.enabled || !this.width || !this.height) return;
    const name = String(msg.name || '').trim();
    const body = String(msg.text || '').trim();
    if (!body) return;
    const text = name ? `${name}：${body}` : body;
    const font = '600 18px ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
    this.ctx.font = font;
    const width = Math.ceil(this.ctx.measureText(text).width);
    const lineH = 30;
    const lanes = Math.max(1, Math.floor(this.height / lineH));
    let lane = 0;
    let bestGap = -Infinity;
    for (let i = 0; i < lanes; i++) {
      const last = this.items.filter(it => it.lane === i).at(-1);
      const gap = this.width - (last ? last.x + last.width : 0);
      if (gap > 24) { lane = i; bestGap = gap; break; }
      if (gap > bestGap) { bestGap = gap; lane = i; }
    }
    // Long lines move a little faster so they do not sit on screen forever.
    const speed = 95 + Math.min(95, width * 0.045);
    this.items.push({
      text, lane, x: this.width + 8, y: 24 + lane * lineH,
      width, speed, color: msg.color || pickColor(name || text),
    });
    if (this.items.length > 80) this.items.splice(0, this.items.length - 80);
  }

  tick(dt) {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.width, this.height);
    if (!this.enabled) return;
    const moving = !this.video.paused;
    for (const it of this.items) {
      if (moving) it.x -= it.speed * dt;
      this.ctx.font = '600 18px ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
      this.ctx.textBaseline = 'middle';
      this.ctx.lineWidth = 3;
      this.ctx.strokeStyle = 'rgba(0,0,0,.72)';
      this.ctx.strokeText(it.text, it.x, it.y);
      this.ctx.fillStyle = it.color;
      this.ctx.fillText(it.text, it.x, it.y);
    }
    this.items = this.items.filter(it => it.x + it.width > -20);
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    this._ro.disconnect();
    this.video.removeEventListener('seeking', this._onSeek);
    this.canvas.remove();
    this.items = [];
  }
}
