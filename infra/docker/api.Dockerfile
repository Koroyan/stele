# syntax=docker/dockerfile:1.7
# Stele API image: HTTP API + relayer + workers (dist/main.js) or the chain indexer
# (dist/indexer-main.js) / standalone workers (dist/worker-main.js), selected by the command.
#
#   docker build -f infra/docker/api.Dockerfile -t stele-api .
#
# Keys (relayer, attestor) are NEVER baked into the image: mount them as secrets at runtime and point
# RELAYER_KEYPAIR / ATTESTOR_KEYPAIR at the mounted files.
ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@12.8.1 --activate
WORKDIR /repo

# Build: bundle the API (workspace packages are inlined by tsup).
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --filter "@stele/api..." \
 && pnpm --filter @stele/api run build

# Production dependencies only (third-party modules the bundle imports at runtime).
FROM base AS prod-deps
COPY . .
RUN pnpm install --frozen-lockfile --prod --filter "@stele/api"

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000
WORKDIR /app
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=prod-deps /repo/apps/api/node_modules ./apps/api/node_modules
# dist/ includes the SQL migrations (dist/drizzle).
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
WORKDIR /app/apps/api
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
