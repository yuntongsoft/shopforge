# Getting Started — From Zero to Running App

Complete walkthrough for developers. Estimated time: **10 minutes**.

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 20+ | `node -v` to check |
| npm | 10+ | Comes with Node.js |
| Git | Any | For cloning |
| Shopify Partner account | — | [Register here](https://partners.shopify.com/signup) |
| Shopify development store | — | Created from Partner Dashboard → Stores |

---

## Step 1: Clone & Install

```bash
git clone https://github.com/your-org/shopforge.git my-shopify-app
cd my-shopify-app
npm install
```

This installs all dependencies and generates the Prisma client.

---

## Step 2: Create Shopify App

1. Log in to [Shopify Partners](https://partners.shopify.com)
2. Navigate to **Apps** → **Create app**
3. Enter app name (e.g. "My App"), select distribution type
4. Click **Create version** — fill in:
   - **App URL**: `https://example.com` (placeholder, auto-updated by CLI)
   - **Redirect URLs**: `https://example.com/auth/callback` (also placeholder)
5. Configure **API access** (scopes):
   ```
   read_discounts, write_discounts, read_orders, read_products, write_products
   ```
6. Click **Release** to activate the version

> **Why release?** Shopify requires at least one released version before the app can run in dev preview. URLs are auto-updated by CLI later.

---

## Step 3: Run Setup

```bash
npm run setup
```

The setup wizard will guide you through:

1. **Database** — defaults to SQLite (zero config). Press Enter to accept.
2. **Shopify credentials** — paste your API Key and API Secret from Step 2.
3. **Database init** — tables are created automatically.

That's it. The `.env` file, encryption keys, and database are all configured for you.

### Quick mode (skip Shopify credentials)

```bash
npm run setup -- --quick
```

This sets up SQLite + auto-generates security keys. You can fill in Shopify credentials in `.env` later.

### Switch to PostgreSQL/MySQL

```bash
npm run setup -- --provider postgresql
npm run setup -- --provider mysql
```

---

## Step 4: Start the App

```bash
npm run dev
```

The dev server will:
1. Check your configuration (auto-runs setup if `.env` is missing)
2. Sync the database schema
3. Compile any Shopify Functions (if present in `extensions/`)
4. Start the Remix dev server with a Cloudflare tunnel

> **First run?** If `.env` doesn't exist, `npm run dev` will automatically run setup for you. No need to run `npm run setup` separately.

Wait until you see output like:

```
  App already configured. Starting dev server...
  Access your app from Shopify Admin → Apps menu.
```

---

## Step 5: Open in Browser

While the dev server is running, press the **P** key in the terminal.

This opens the app in your browser via the Shopify dev preview. You should see:

1. **Loading screen** — brief spinner (matches framework style)
2. **Auto-reload** — if it's a cold start, the page reloads automatically once App Bridge is ready
3. **Dashboard** — the app homepage with real data from your dev store

> **First launch?** If the dashboard shows a loading spinner for a few seconds then loads data — that's the cold-start self-healing working correctly. Subsequent page navigations are instant.

---

## Troubleshooting

### "Example Domain" page instead of app

Your `application_url` in Partner Dashboard hasn't been updated by CLI yet. Make sure `npm run dev` is running and the tunnel is active. Press **P** again.

### 401 Unauthorized or blank page

Session token expired. Refresh the browser. If it persists:
1. Stop the dev server (Ctrl+C)
2. Delete the database: `rm prisma/dev.db` (or `DROP DATABASE` for PostgreSQL/MySQL)
3. Run `npm run dev` again
4. Press **P** to reopen

### "App not installed" error

You need to release at least one version in Partner Dashboard (Step 2). The dev preview requires a released version.

### Port already in use

```bash
# Kill the process on port 3000 (or your configured PORT)
npx kill-port 3000
# Then restart
npm run dev
```

### Database connection failed

Check your `DATABASE_URL` in `.env`. For SQLite, make sure the path is writable. For PostgreSQL/MySQL, verify the host, port, username, and password.

To reconfigure database:
```bash
rm .env
npm run setup
```

---

## What's Next?

```bash
# Remove demo code (optional)
npm run clean:demo

# Set up Shopify Functions
npm run functions:setup

# Generate a CRUD page from your Prisma model
npm run generate YourModel
```

See the full [README](README.md) for module guide, scripts reference, and deployment instructions.
