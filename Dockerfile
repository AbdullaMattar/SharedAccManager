# ─── Stage 1: Install dependencies ───────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY lib/db/package.json ./lib/db/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/accounts-manager/package.json ./artifacts/accounts-manager/
COPY scripts/package.json ./scripts/

# Install all deps
RUN pnpm install --frozen-lockfile

# ─── Stage 2: Build ───────────────────────────────────────────────────────────
FROM deps AS builder
WORKDIR /app

# Copy full source
COPY . .

# Build the API server
RUN pnpm --filter @workspace/api-server run build

# Build the frontend
RUN pnpm --filter @workspace/accounts-manager run build

# ─── Stage 3: Production runtime ─────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nodeapp

# Copy built API server
COPY --from=builder --chown=nodeapp:nodejs /app/artifacts/api-server/dist ./dist

# Copy frontend build (served as static files by Express in production)
COPY --from=builder --chown=nodeapp:nodejs /app/artifacts/accounts-manager/dist ./public

# Copy drizzle schema + config for migrations
COPY --from=builder --chown=nodeapp:nodejs /app/lib/db ./lib/db
COPY --from=builder --chown=nodeapp:nodejs /app/node_modules ./node_modules

# Persistent data volume for SQLite
RUN mkdir -p /app/data && chown nodeapp:nodejs /app/data
VOLUME ["/app/data"]

USER nodeapp

EXPOSE 5000

# Run migrations then start server
CMD ["sh", "-c", "node -e \"require('./dist/index.mjs')\""]
