FROM oven/bun:1.4.3-slim

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src
COPY web ./web
COPY core ./core
COPY tsconfig.json ./

# The client is bundled here, not during a request. Bun's HTML import route
# returns an empty body in a production container, and this removes the
# question entirely.
RUN bun build web/index.html --outdir dist --minify

ENV NODE_ENV=production \
    PORT=8080 \
    OPSHUB_DB=/data/hub.sqlite

RUN mkdir -p /data && chown bun:bun /data
USER bun

EXPOSE 8080
VOLUME ["/data"]

# The image has no shell, so the healthcheck uses the argv form.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:8080/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["bun", "src/server.ts"]
