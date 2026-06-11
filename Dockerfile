# ─── Stage 1: Install dependencies ───────────────────────────────────────────
FROM node:22-slim AS deps
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY lib/db/package.json ./lib/db/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/accounts-manager/package.json ./artifacts/accounts-manager/
COPY scripts/package.json ./scripts/

RUN echo 'node-linker=hoisted' > .npmrc && pnpm install --frozen-lockfile

# ─── Stage 2: Build ───────────────────────────────────────────────────────────
FROM deps AS builder
WORKDIR /app

COPY . .

RUN pnpm --filter @workspace/api-server run build

# PORT and BASE_PATH are consumed by vite.config.ts at build time
RUN PORT=5000 BASE_PATH=/ pnpm --filter @workspace/accounts-manager run build

# ─── Stage 3: Production runtime ─────────────────────────────────────────────
FROM node:22-slim AS runner
WORKDIR /app

RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid 1001 nodeapp

COPY --from=builder --chown=nodeapp:nodejs /app/artifacts/api-server/dist ./dist
# Frontend build is served as static files from ./public
COPY --from=builder --chown=nodeapp:nodejs /app/artifacts/accounts-manager/dist/public ./public

COPY --from=builder --chown=nodeapp:nodejs /app/lib/db ./lib/db
COPY --from=builder --chown=nodeapp:nodejs /app/node_modules ./node_modules

RUN mkdir -p /app/data && chown nodeapp:nodejs /app/data
VOLUME ["/app/data"]

USER nodeapp

EXPOSE 5000

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
