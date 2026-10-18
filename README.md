# Watchparty

[![Build and publish image](https://github.com/luvhx/watchparty/actions/workflows/docker.yml/badge.svg)](https://github.com/luvhx/watchparty/actions/workflows/docker.yml)
[![GitHub Container Registry](https://img.shields.io/badge/ghcr.io-luvhx%2Fwatchparty-2496ED?logo=docker&logoColor=white)](https://github.com/luvhx/watchparty/pkgs/container/watchparty)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

仓库：<https://github.com/luvhx/watchparty>

在浏览器里播放 **AList / OpenList / 小雅 alist 的网盘直链**，或者任意等效的视频直链，并且和朋友**一起看**：

- 服务端代理上游直链，按需补 `User-Agent` / `Referer` / Cookie，转发 `Range` 和 302；
- 浏览器端重封装 MKV / MP4 / MOV / WebM / FLV 为 fMP4 喂给 MSE，视频码流不重编码，HDR / Dolby Vision 原样保留；
- 外挂 SRT / VTT / ASS 字幕，内嵌 SRT / ASS 字幕本地解复用；
- 房间同步播放 / 暂停 / seek / 倍速，带漂移纠正和“等缓冲”；
- 弹幕式讨论区：聊天消息从画面飘过，侧栏有可回看的讨论列表，点时间可以跳转。

> 这是一个自托管项目，不包含任何影片、账号、Cookie 或 DRM 绕过。请只播放你有权访问的内容。

---

## 快速开始

需要 Node.js 22+（推荐 22/24）。

```bash
npm install
cp .env.example .env
# 编辑 .env，至少填 ALIST_URL / ALIST_TOKEN
npm run build      # 生成 public/vendor（JASSUB）
npm start
```

打开：

```text
http://localhost:8364/
```

局域网内其他设备用 `http://<这台机器的 IP>:8364/`。

---

## 用预构建镜像部署（推荐）

镜像由 GitHub Actions 构建并推到 **GitHub Container Registry**，Compose 默认只拉镜像，不在服务器上编译。

### 1. 镜像已经发布

本仓库当前的公开镜像：

```text
ghcr.io/luvhx/watchparty:latest
ghcr.io/luvhx/watchparty:sha-<commit>
```

- `latest`：main 分支最新构建；
- `sha-<短哈希>`：对应 commit，适合固定版本；
- 打 `v*` tag 时还会发布版本号 tag；
- 支持 `linux/amd64` 和 `linux/arm64`。

拉取测试：

```bash
docker pull ghcr.io/luvhx/watchparty:latest
```

[.github/workflows/docker.yml](.github/workflows/docker.yml) 在每次 push 到 `main` 时自动：

1. 跑 `npm run check`、`npm run build`、`npm test`；
2. 构建多架构镜像；
3. 推送到 GHCR。

<details>
<summary>Fork 后怎么发布自己的镜像</summary>

```bash
git init
git add .
git commit -m "Watchparty"
git branch -M main
git remote add origin git@github.com:<你的用户>/watchparty.git
git push -u origin main
```

Workflow 会把镜像推到 `ghcr.io/<你的用户>/watchparty`。然后改 `.env` 里的
`IMAGE`。Fork 的 GHCR 包默认可能是 private：在 Package 设置里改成 public，或部署机
`docker login ghcr.io`。

</details>

### 2. 配置 `.env`

```bash
cp .env.example .env
```

至少改：

```env
# 预构建镜像的完整地址
IMAGE=ghcr.io/luvhx/watchparty:latest

# AList / OpenList / 小雅 alist 的 AList 兼容 API
ALIST_URL=http://host.docker.internal:5244
ALIST_TOKEN=你的 AList token

# 换成一个随机长字符串
PROXY_SECRET=change-me-to-a-long-random-string

# 只播 AList 的话建议关掉；要“任意直链”再开
ALLOW_ANY_URL=0
ALLOW_PRIVATE_UPSTREAM=1
```

宿主机端口默认是 **8364**，改 `HOST_PORT` 即可。

### 3. 启动

```bash
docker compose pull
docker compose up -d

docker compose ps
docker compose logs -f --tail=100
curl -s http://127.0.0.1:8364/api/health
```

打开：

```text
http://<服务器 IP>:8364/
```

### 4. 更新

```bash
docker compose pull
docker compose up -d
```

### 常用命令

```bash
docker compose down                      # 停止并删除容器
docker compose up -d --force-recreate    # 改完 .env 后重建（restart 不会重载 env）
docker compose config                    # 检查 compose 解析结果
```

### 本地构建（不想用预构建镜像）

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

本地构建镜像名是 `watchparty:local`，不会覆盖 `.env` 里的 `IMAGE`。

### 不用 Compose 的 Docker

```bash
docker build -t watchparty .
docker run -d --name watchparty --restart unless-stopped \
  -p 8364:8364 --env-file .env watchparty
```

容器内部固定监听 **8364**。

---

## OpenList / 小雅 alist 怎么接

本项目对接的是 **AList 兼容 API**：

```text
POST /api/fs/list
POST /api/fs/get
```

因此适用于：

- [AList](https://github.com/alist-org/alist)
- [OpenList](https://github.com/OpenListTeam/OpenList)（AList 的活跃分支）
- 小雅 alist 的 AList 接口
- 其他保持这套 API 的 fork

如果小雅只提供 Emby 端口、没有 AList API，本项目不直接对接 Emby；那种情况请用 AList 的 `/d/` 直链，或把片源作为普通直链播放。

### AList 在 Docker 宿主机上

Linux 下把 `docker-compose.yml` 里这段取消注释：

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

然后：

```env
ALIST_URL=http://host.docker.internal:5244
ALLOW_PRIVATE_UPSTREAM=1
```

也可以直接写局域网 IP，例如 `http://192.168.1.10:5244`。

### AList 也是 Compose 服务

如果 AList/OpenList 和本项目在同一个 Docker 网络里，用服务名即可：

```yaml
services:
  watchparty:
    networks: [media]
  openlist:
    networks: [media]

networks:
  media:
    external: true
```

```env
ALIST_URL=http://openlist:5244
ALLOW_PRIVATE_UPSTREAM=1
```

### 只播直链

不填 `ALIST_URL` 也可以启动，直接用「直链」页签：

- `https://.../movie.mp4`
- `https://.../movie.mkv`
- AList / OpenList / 小雅 alist 的 `/d/...` 链接
- 其他返回视频文件、支持 Range 的 http(s) 链接

需要：

```env
ALLOW_ANY_URL=1
```

---

## 配置

`.env` 关键项：

| 变量 | 说明 |
|---|---|
| `IMAGE` | Compose 使用的预构建镜像 |
| `HOST_PORT` | 宿主机端口，默认 `8364` |
| `ALIST_URL` | AList / OpenList / 小雅 alist 地址，不要带结尾 `/` |
| `ALIST_TOKEN` | AList/OpenList 后台 → 设置 → 其他 → Token |
| `ALIST_USERNAME` / `ALIST_PASSWORD` | 没有 token 时，服务端用账号密码登录 |
| `ALIST_ROOT` | 文件浏览器默认目录，默认 `/` |
| `PROXY_USER_AGENT` | 回源 UA，默认桌面 Chrome |
| `PROXY_REFERER` | 可选回源 Referer；留空则使用上游自己的 origin |
| `PROXY_COOKIE` | 可选 Cookie |
| `PROXY_COOKIE_HOSTS` | Cookie 允许发送的域名，逗号分隔；空 = 只发给 AList 主机 |
| `ALLOW_ANY_URL` | 是否允许“直链”页签代理任意 http(s) URL |
| `ALLOW_PRIVATE_UPSTREAM` | 是否允许回源到内网/本机 |
| `PROXY_SECRET` | 签名 `/api/stream` 的密钥；不填则每次启动随机生成 |
| `ROOM_MAX_MEMBERS` | 房间人数上限，默认 32 |

旧变量 `OPENLIST_URL` / `OPENLIST_TOKEN` / `OPENLIST_USERNAME` / `OPENLIST_PASSWORD` / `OPENLIST_ROOT` 仍然兼容。

### 上游请求头

不同网盘/CDN 的要求不同，本项目不针对某一家写死：

- `PROXY_USER_AGENT`：很多 CDN 要桌面浏览器 UA；
- `PROXY_REFERER`：有的要站点 Referer；留空就用上游 origin；
- `PROXY_COOKIE` + `PROXY_COOKIE_HOSTS`：需要 Cookie 时，只对允许的域名发送，**不会**发给直链页签里粘贴的任意第三方。

例如某家网盘要自己的 Referer/Cookie，就填：

```env
PROXY_REFERER=https://example.com/
PROXY_COOKIE=UID=...; CID=...
PROXY_COOKIE_HOSTS=example.com,cdn.example.com
```

### 代理链路

```text
浏览器
  → 本站 /api/stream（HMAC 签名 URL）
    → AList /d/...（带 AList token）
      → 上游 CDN（按需 UA / Referer / Cookie，手动跟随 302）
        → 206 + Range 回到浏览器
```

代理层负责：

- 跟随 302；
- 转发 `Range` / `If-Range`；
- 暴露 `Content-Range` / `Accept-Ranges` / `Content-Length`；
- 让浏览器只跟本站同源打交道。

---

## 使用

### 播放 AList 视频

1. 右侧「片源」→「AList / OpenList」；
2. 输入路径或点目录浏览；
3. 点视频文件开始播放；
4. 点字幕文件会把该字幕作为外挂字幕加载。

### 播放任意直链

「片源」→「直链」，粘贴 `http(s)` 直链。服务端会：

- 用 `/api/resolve` 校验并签名；
- 用 `/api/stream` 代理；
- 按需补 UA / Referer / Range，并跟随 302。

需要 `ALLOW_ANY_URL=1`。

### 外挂字幕

- URL：`.srt` / `.vtt` / `.ass` / `.ssa`；
- 本地文件：选择字幕文件；
- 内嵌字幕：播放后出现在底部「字幕」菜单；
- SRT/VTT 用浏览器 `<track>`，ASS 用 JASSUB（libass wasm）。

字幕只影响本机，不会同步给房间其他人。

### 一起看

1. 填昵称；房间号留空会自动生成；
2. 可选密码；
3. 点「创建 / 加入」；
4. 点「复制邀请」，把链接发给朋友；
5. 房主选片源后，房间会共享“放什么”；
6. 其他人打开邀请链接，空播放器会自动跟上；已在看别的会自动提示「跟上房间」。

同步内容：

- 播放 / 暂停 / seek / 倍速；
- 当前片源（AList 路径或直链 URL），不传影片字节；
- 谁在缓冲，所有人一起等（最多 20 秒）；
- 成员列表、房主交接、聊天/弹幕。

房主每 5 秒用自己的真实播放头重新定锚；其他人按服务器时钟计算目标位置：

```text
target = paused ? pos : pos + (serverNow - at) / 1000 * rate
```

漂移处理（沿用 LinWeb 的阈值）：

| 偏差 | 动作 |
|---|---|
| < 80 ms | 不动，属于测量噪声 |
| 80 ms ~ 2.5 s | 微调 `playbackRate`，封顶 ±8% |
| > 2.5 s | 才 seek |

### 讨论区 / 弹幕

- 加入房间后，侧栏输入框发送消息；
- 消息带当前播放时间，以弹幕形式从右向左飘过；
- 侧栏列表保留最近 200 条，点时间跳回该位置；
- 后加入的人会收到最近 100 条历史；
- 房间空了，内存里的历史随之清空（不写数据库）；
- 没有房间时不能发言；可以先开一个只有自己的房间。

---

## 架构

```text
AList / OpenList / 小雅 alist / 任意直链
        │
        ▼
server/alist.mjs   list / fs/get → raw_url
        │
        ▼
server/proxy.mjs   签名 URL · Range · 302 · UA/Referer/Cookie
        │
        ▼
浏览器 public/app.js
  ├─ Player（LinWeb MIT）: demux → fMP4 → MSE → <video>
  ├─ 字幕：TextCues / JASSUB
  ├─ 房间：Room + PlaybackSync + WebSocket /room/<code>
  └─ 弹幕：canvas DanmakuLayer + 讨论列表
```

### 目录

```text
.github/workflows/  CI + GHCR 镜像发布
server/
  index.mjs         HTTP 路由、静态文件、API
  alist.mjs         AList 兼容客户端（token 只在服务端）
  proxy.mjs         签名流代理、Range、302、可配置请求头
  together.mjs      RFC 6455 WebSocket + Relay
public/
  index.html        页面
  app.js            UI、片源、字幕、房间、弹幕
  danmaku.js        canvas 弹幕
  src/              LinWeb MIT 播放/同步模块
  vendor/           npm run build 生成（JASSUB）
test/               Node / jsdom 集成测试
scripts/            build-vendor / syntax check
```

### 为什么代理要签名

`/api/stream` 如果接受任意 `?url=`，就是一个开放的 SSRF / 开放代理。现在只有服务端在 `/api/resolve`（受 `ALLOW_ANY_URL` 控制）或 `/api/alist/resolve`（由 AList 返回）之后才签发带 HMAC 的 URL；`/api/stream` 只认签名。

默认配置为了方便自托管：

```env
ALLOW_ANY_URL=1
ALLOW_PRIVATE_UPSTREAM=1
```

**如果放到公网，请在前面加认证**（反向代理 Basic Auth、Authelia、Cloudflare Access 等），否则任何人拿到地址都能借你的服务器回源。

---

## 限制

### 不支持

- **HLS（m3u8）/ DASH（mpd）**：当前播放器只处理可随机读取的文件容器。HLS 需要额外集成 `hls.js`，而且 m3u8 里的分片 URL 还需要重写代理，暂未实现。
- **直播流**：没有 live 同步模型。
- **DRM**：Netflix / Disney+ 等 EME 内容无法播放。
- **PGS / VobSub / DVB 字幕**：能识别为字幕轨，但不绘制；外挂同样不支持。
- **语音聊天 / TURN**：没有实现 WebRTC 语音。
- **AVI / TS / WMV / RMVB**：播放器只解 Matroska / MP4 / FLV；这些容器会提示转封装。

### 音频

浏览器原生支持 AAC / MP3 / FLAC / Opus 时直接重封装。

AC-3 / E-AC-3 / DTS / TrueHD 需要 ffmpeg.wasm 软件解码；本项目默认**没有**打包 ffmpeg.wasm（31 MB，且 `@ffmpeg/core` 是 GPL-2.0-or-later）。遇到这些音轨时通常表现为**静音播放**。如果你需要，可以按 LinWeb 的 `tools/build-vendor.mjs` 把 ffmpeg 加进 `public/vendor/`，并自行处理 GPL 合规。

### 上游网盘

- 网盘 Cookie 过期时，代理也会收到 401/403；
- `raw_url` 签名过期时，重新点一次文件即可（服务端会重新解析）；
- 直链代理会占用服务器带宽；房间人越多，回源请求越多；
- 本项目不针对某一家网盘的 UA/Referer 规则写死，需要时用 `PROXY_*` 配。

### 浏览器

推荐 Chromium / Edge 最新版；HEVC / HDR 是否可播取决于操作系统和硬件解码器。Firefox 也能用，但部分编码组合不同。Safari / iOS 未做完整测试。

---

## 测试

```bash
npm test
```

覆盖：

- 静态页面 / health / config；
- 签名代理的 Range、302、上游 UA/Referer/Cookie 作用域；
- 无效签名拒绝；
- AList list / resolve 与 token；
- SRT → WebVTT、ASS 数据包解析；
- WebSocket 房间广播、迟到成员的状态/聊天历史、房间密码；
- PlaybackSync 让第二个成员跟随播放、seek 和暂停；
- jsdom DOM 冒烟；
- jsdom + 真实 WebSocket 的房间/聊天 UI 冒烟。

```bash
npm run check   # 所有模块 node --check
```

可选的浏览器冒烟测试（需要一个能启动的 Chromium；Linux 上可能要先补 Playwright 的系统依赖）：

```bash
npm run test:browser
```

---

## 反向代理（HTTPS / wss）

页面和 WebSocket 同源，所以只要把整个站点反代到 https，`wss://` 会自动成立：

```caddy
example.com {
    reverse_proxy 127.0.0.1:8364
}
```

nginx 需要转发 Upgrade：

```nginx
location / {
    proxy_pass http://127.0.0.1:8364;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_buffering off;
    proxy_read_timeout 3600s;
}
```

视频流走 `proxy_buffering off`，避免反代把 Range 响应缓冲成整段。

---

## 许可证与来源

本项目 MIT。

`public/src/` 下的播放器、demux、remux、音频兜底、字幕渲染、房间同步，以及
`server/together.mjs`，派生自 [LinWeb](https://github.com/zzzwannasleep/webplayer)
（MIT，Copyright (c) 2026 zzzwannasleep）。详见 [NOTICE.md](NOTICE.md)。

ASS 渲染使用 [JASSUB](https://github.com/ThaUnknown/jassub)（LGPL-2.1-or-later，
内含 libass），以独立 wasm bundle 形式加载；分发构建产物时请保留其许可证与源码获取方式。
