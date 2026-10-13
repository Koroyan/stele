# syntax=docker/dockerfile:1.7
# Stele PDF renderer: Chromium + Noto fonts for every script (Latin, Cyrillic, Greek, Georgian,
# Armenian, Hebrew, Arabic, Indic, Thai, CJK, ...). Internal service only (see docker-compose.yml).
#
#   docker build -f infra/docker/pdf-renderer.Dockerfile -t stele-pdf-renderer .
ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS deps
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@12.8.1 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --prod --filter "@stele/pdf-renderer"

FROM ${NODE_IMAGE} AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium \
      fonts-noto-core fonts-noto-cjk fonts-noto-mono fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/* \
 && fc-cache -f
ENV NODE_ENV=production PORT=4100 CHROME_PATH=/usr/bin/chromium HOME=/tmp
WORKDIR /app
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/pdf-renderer/node_modules ./apps/pdf-renderer/node_modules
COPY apps/pdf-renderer/package.json ./apps/pdf-renderer/package.json
COPY apps/pdf-renderer/src ./apps/pdf-renderer/src
WORKDIR /app/apps/pdf-renderer
USER node
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4100/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.mjs"]
