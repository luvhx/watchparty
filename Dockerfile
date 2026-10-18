# syntax=docker/dockerfile:1
# Static site + Node server + WebSocket relay. The build stage produces the
# JASSUB vendor bundle; the runtime stage needs no node_modules at all.
# The build stage produces only static JS/wasm, identical on every architecture.
# Pin it to the builder so a multi-arch build does not run npm under QEMU.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY scripts ./scripts
COPY public ./public
COPY server ./server
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/server ./server
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./
COPY NOTICE.md LICENSE ./
USER node
EXPOSE 8364
HEALTHCHECK --interval=60s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1:${PORT:-8364}/api/health || exit 1
CMD ["node", "server/index.mjs"]
