# Deployment Guide

ShopForge supports multiple deployment targets. Choose the one that fits your infrastructure.

## Prerequisites

- Node.js 18+ and npm
- PostgreSQL 14+ database
- Shopify Partner account with app credentials
- (Optional) Redis for production rate limiting
- (Optional) Resend API key for transactional emails

## Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable | Required | Description |
|:---|:---|:---|
| `SHOPIFY_API_KEY` | Yes | From Partner Dashboard |
| `SHOPIFY_API_SECRET` | Yes | From Partner Dashboard |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `ENCRYPTION_KEY` | Yes | 64 hex chars (32 bytes) |
| `APP_URL` | Yes | Your production URL (e.g. `https://your-app.com`) |
| `REDIS_URL` | Recommended | Redis connection for multi-process rate limiting |
| `RESEND_API_KEY` | Optional | For transactional emails (mocked if not set) |
| `CRON_SECRET` | Recommended | For health endpoint detail mode authentication |
| `CSRF_SECRET` | Optional | For CSRF token signing (defaults to SESSION_SECRET) |

Generate a secure encryption key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Option 1: Vercel (Recommended)

### One-Click Deploy
```bash
npm i -g vercel
vercel --yes
```

### Configure Environment
```bash
vercel env add SHOPIFY_API_KEY
vercel env add SHOPIFY_API_SECRET
vercel env add DATABASE_URL
vercel env add ENCRYPTION_KEY
vercel env add APP_URL
vercel env add REDIS_URL
vercel env add CRON_SECRET
```

### Deploy to Production
```bash
vercel --prod
```

### Database
Use [Neon](https://neon.tech), [Supabase](https://supabase.com), or [Railway](https://railway.app) for managed PostgreSQL:
```bash
npx prisma db push
```

---

## Option 2: Railway

### Setup
1. Create a new project on [Railway](https://railway.app)
2. Add PostgreSQL and Redis services
3. Add your app service from GitHub

### Environment
Set all environment variables in Railway dashboard → Variables.

### Deploy
Railway auto-deploys on git push. For manual deploy:
```bash
railway up
```

### Domain
Railway provides a free `.up.railway.app` domain. For custom domain:
1. Add in Railway dashboard → Settings → Domains
2. Update `APP_URL` environment variable

---

## Option 3: Fly.io

### Setup
```bash
flyctl launch --name shopforge --region iad
flyctl postgres create --name shopforge-db
flyctl postgres attach shopforge-db
flyctl redis create --name shopforge-redis
```

### Configure
```bash
flyctl secrets set SHOPIFY_API_KEY=your-key
flyctl secrets set SHOPIFY_API_SECRET=your-secret
flyctl secrets set ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
flyctl secrets set APP_URL=https://shopforge.fly.dev
flyctl secrets set CRON_SECRET=$(openssl rand -hex 32)
```

### Deploy
```bash
flyctl deploy
```

---

## Option 4: Docker (Self-Hosted)

### Build
```bash
docker build -t shopforge:latest .
```

### Run
```bash
docker run -d \
  --name shopforge \
  -p 3000:3000 \
  -e SHOPIFY_API_KEY=your-key \
  -e SHOPIFY_API_SECRET=your-secret \
  -e DATABASE_URL=postgresql://user:pass@host:5432/shopforge \
  -e ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  -e APP_URL=https://your-domain.com \
  -e REDIS_URL=redis://redis:6379 \
  -e CRON_SECRET=$(openssl rand -hex 32) \
  shopforge:latest
```

### Docker Compose
```yaml
version: "3.9"
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://shopforge:secret@db:5432/shopforge
      - REDIS_URL=redis://redis:6379
    depends_on:
      - db
      - redis

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: shopforge
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: shopforge
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine

volumes:
  pgdata:
```

---

## Post-Deploy Checklist

- [ ] Set all required environment variables
- [ ] Run `npx prisma migrate deploy` to apply versioned migrations (production)
- [ ] Update `shopify.app.toml` with production URLs
- [ ] Run `npx shopify app deploy` to push config to Shopify
- [ ] Verify OAuth flow works end-to-end
- [ ] Test billing subscription creation
- [ ] Confirm webhooks are being received
- [ ] Set up health check monitoring (cron → `/health?detail=true`)
- [ ] Configure log aggregation (Datadog, Logtail, etc.)
- [ ] Set up error tracking (Sentry, Bugsnag, etc.)

---

## Database Upgrade (from legacy installations)

If you are upgrading from a ShopForge version prior to the baseline migration (`20260926000000_baseline`), your database uses PascalCase table names (`Shop`, `Session`, `Order`, `ShopFunction`) and is missing several columns and infrastructure tables.

> **New installations**: Just run `npx prisma migrate deploy` — the baseline migration handles everything.

### Upgrade tool

```bash
# Step 1: Dry-run — detect state and preview changes (no modifications)
npm run upgrade:db

# Step 2: Apply upgrade (with interactive confirmation)
npm run upgrade:db -- --apply

# Step 3: Skip confirmation (for CI/automated scripts)
npm run upgrade:db -- --apply --force
```

### What the upgrade does

1. Detects database state (fresh / legacy / current / mixed / failed-migration)
2. Drops the legacy `Session→Shop` foreign key (SDK writes sessions before Shop exists)
3. Renames tables from PascalCase to snake_case (`Shop` → `shops`, etc.)
4. Renames indexes and foreign key constraints to match baseline naming
5. Adds missing columns to `shops` (subscription fields, installation_id, locale, etc.)
6. Adds missing columns to `sessions` (credential_version, refresh_lease_*)
7. Adds missing columns to `orders` (customer_id, external_order_id)
8. Converts `orders.amount` from DECIMAL(18,2) to DOUBLE PRECISION
9. Creates infrastructure tables (operation_leases, webhook_executions, privacy_requests)

### Safety guarantees

- **Default is dry-run** — no changes are made unless you pass `--apply`
- **Idempotent** — uses `IF EXISTS` / `IF NOT EXISTS` throughout; safe to re-run
- **No data loss** — never generates `DROP TABLE`, `DELETE`, or `TRUNCATE`
- **Conflict detection** — aborts on mixed naming or unrecognized states
- **PostgreSQL only** — MySQL/SQLite should start fresh with `prisma migrate deploy`

### After upgrade

```bash
# Reconcile Prisma migration history (official patching workflow)
# See: https://www.prisma.io/docs/orm/prisma-migrate/workflows/patching-and-hotfixing

# Regenerate Prisma Client
npx prisma generate

# Verify schema alignment
npx prisma validate
```

## Shopify App Store Submission

Before submitting:
1. Complete all [App Store requirements](https://shopify.dev/docs/apps/listing/app-store-listing)
2. Fill in app listing details (description, screenshots, pricing)
3. Ensure GDPR webhooks are working
4. Pass Shopify's automated review checks
5. Submit via Partner Dashboard
