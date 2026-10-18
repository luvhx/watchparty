# Third-party notices

## LinWeb

Portions of this project are derived from **LinWeb** (repository `webplayer`):

  https://github.com/zzzwannasleep/webplayer

MIT License, Copyright (c) 2026 zzzwannasleep.

The derived files live under `public/src/` (player, worker, demuxers, fMP4
remuxer, audio fallback, subtitle renderers, together room/sync/relay) and
`server/together.mjs` (adapted from `tools/together-server.mjs`). The original
MIT license text is reproduced in `LICENSE`.

## JASSUB

`public/vendor/jassub*.{js,wasm}` is built from
[JASSUB](https://github.com/ThaUnknown/jassub), which embeds libass.

JASSUB is distributed under **LGPL-2.1-or-later** (its npm metadata also lists
the licenses of the components it bundles). It is loaded as a separate wasm
bundle through its public API, so it remains a replaceable component. If you
redistribute a built image or site, keep the JASSUB license notice and the
corresponding source offer.

## Other runtime components

- `jassub` (LGPL-2.1-or-later) — ASS/SSA rendering.
- No `ws` dependency: the WebSocket relay is a small RFC 6455 implementation.
