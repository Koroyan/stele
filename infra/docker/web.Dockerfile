# syntax=docker/dockerfile:1.7
# Stele web app (Next.js standalone server).
#
#   docker build -f infra/docker/web.Dockerfile \
#     --build-arg API_INTERNAL_URL=http://api:4000 \
#     --build-arg NEXT_PUBLIC_PROGRAM_ID=<program id> \
#     --build-arg NEXT_PUBLIC_CHAIN_ID=<caip-2 chain id> \
#     -t stele-web .
#
# API_INTERNAL_URL is compiled into the /api rewrite, and NEXT_PUBLIC_* values are pinned into the
# browser bundle — both must be provided at BUILD time.
ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@12.8.1 --activate
WORKDIR /repo

FROM base AS build
ARG API_INTERNAL_URL=http://api:4000
ARG NEXT_PUBLIC_PROGRAM_ID
ARG NEXT_PUBLIC_CHAIN_ID
ARG NEXT_PUBLIC_RPC_URLS
ARG NEXT_PUBLIC_REPO_URL
ARG PUBLIC_RPC_URLS
ENV API_INTERNAL_URL=${API_INTERNAL_URL} \
    NEXT_PUBLIC_PROGRAM_ID=${NEXT_PUBLIC_PROGRAM_ID} \
    NEXT_PUBLIC_CHAIN_ID=${NEXT_PUBLIC_CHAIN_ID} \
    NEXT_PUBLIC_RPC_URLS=${NEXT_PUBLIC_RPC_URLS} \
    NEXT_PUBLIC_REPO_URL=${NEXT_PUBLIC_REPO_URL} \
    PUBLIC_RPC_URLS=${PUBLIC_RPC_URLS}
COPY . .
RUN pnpm install --frozen-lockfile --filter "@stele/web..." \
 && pnpm --filter @stele/web run build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1 \
    STELE_REPO_ROOT=/app
WORKDIR /app
# The build completes the standalone output (scripts/prepare-standalone.mjs): client assets and the
# Markdown rendered by the documentation pages are already inside it.
COPY --from=build /repo/apps/web/.next/standalone ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
