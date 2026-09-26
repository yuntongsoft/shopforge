# =============================================================================
# ShopForge — Multi-stage Docker build
# =============================================================================
# Usage:
#   docker build -t shopforge .
#   docker run -p 3000:3000 --env-file .env shopforge
#
# Or with docker-compose:
#   docker compose up -d
# =============================================================================

# --- Stage 1: Install dependencies ---
FROM node:20-slim AS deps
WORKDIR /app

# Install OpenSSL for Prisma
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Copy package files (root + workspace members)
COPY package.json package-lock.json* ./
COPY landing/package.json ./landing/
COPY prisma ./prisma/

# Install dependencies (hoisted to root node_modules/) + generate Prisma client
RUN npm ci --ignore-scripts && npx prisma generate

# --- Stage 2: Build the app ---
FROM node:20-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY . .

# Build Remix + generate Prisma client for production
RUN npx prisma generate
RUN npm run build

# --- Stage 3: Production runtime ---
FROM node:20-slim AS runner
WORKDIR /app

# Minimal runtime dependencies
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000

# Copy built assets
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/server.mjs ./
COPY --from=builder /app/runtime ./runtime
COPY --from=builder /app/public ./public

# Health check — verify server is responding
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

EXPOSE 3000

# Run database migrations on startup (safe: idempotent)
CMD ["sh", "-c", "npx prisma migrate deploy && node server.mjs"]
