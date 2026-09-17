---
title: "Getting Started with ShopForge in 10 Minutes"
description: "Clone the repo, configure your environment, and have a running Shopify app with OAuth, billing, and a dashboard — all in under 10 minutes."
date: "2026-08-20"
author: "ShopForge Team"
---

# Getting Started with ShopForge in 10 Minutes

ShopForge is a production-ready Shopify App starter kit. This guide walks you from zero to a running app.

## Prerequisites

Before you begin, make sure you have:

- Node.js 20+ installed
- A PostgreSQL database (or Docker)
- A Shopify Partner account with a development store

## Quick Start

Clone the repository and install dependencies:

```bash
git clone https://github.com/your-org/shopforge.git my-app
cd my-app
npm install
```

Configure your environment by copying the example file:

```bash
cp .env.example .env
```

Fill in these 4 required values:

- `SHOPIFY_API_KEY` — from your Partner Dashboard
- `SHOPIFY_API_SECRET` — from your Partner Dashboard
- `DATABASE_URL` — your PostgreSQL connection string
- `ENCRYPTION_KEY` — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

Push the database schema and start the dev server:

```bash
npm run db:push
npm run dev
```

That's it! Open the tunnel URL and install the app on your development store.

## What's Included

You now have a fully working Shopify app with:

- **OAuth** — automatic session management with encrypted tokens
- **Billing** — three-tier subscription plans (Free / Pro / Business)
- **Dashboard** — real-time stats from the Shopify API
- **CRUD Example** — a complete Items page you can customize or delete
- **Code Generator** — run `npm run generate YourModel` to scaffold new pages

## Next Steps

Check out the [Day 1 Developer Guide](https://github.com/your-org/shopforge#day-1-developer-guide) in the README for step-by-step instructions on adding your own business logic.

---

Happy building!
