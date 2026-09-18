# Getting Started — From Zero to Running App

Complete walkthrough for developers. Estimated time: **15 minutes**.

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

This installs all dependencies for both the app and the landing page (npm workspace).

---

## Step 2: Create Shopify App

### 2.1 Go to Partner Dashboard

1. Log in to [Shopify Partners](https://partners.shopify.com)
2. Navigate to **Apps** in the left sidebar
3. Click **Create app**
4. Enter app name (e.g. "My App")
5. Select **Self-serve** as the distribution type (or as needed)

### 2.2 Create App Version

After creating the app, you'll land on the app overview page. You need to create a version before the app can run:

1. Click **Create version** (top-right area)
2. Fill in the following fields:

| Field | Development Value | Notes |
|-------|-------------------|-------|
| **App URL** | `https://example.com` | Placeholder — Shopify CLI auto-replaces with tunnel URL during `npm run dev` |
| **Allowed redirection URL(s)** | `https://example.com/auth/callback` | Also a placeholder — auto-updated by CLI |

3. Click **Save** (or **Create version**)

### 2.3 Configure API Access (Scopes)

In the same version creation page, find **API access** (or **Configuration → API access**):

Add the following scopes (comma-separated):

```
read_discounts, write_discounts, read_orders, read_products, write_products
```

> **Note:** These are the default scopes pre-configured in `shopify.app.toml`. If your app needs additional scopes (e.g. `read_customers`), add them in both the Partner Dashboard and `shopify.app.toml`.

### 2.4 Release the Version

After filling in all fields, click **Release** (or **Save and release**) to activate this version.

> **Why release?** Shopify requires at least one released version before the app can be installed or accessed via dev preview. The URLs will be automatically updated by Shopify CLI when you run `npm run dev`.

---

## Step 3: Get API Credentials

1. In your app's Partner Dashboard, go to **Configuration → App settings** (or click **App settings** in the left sidebar under your app)
2. Find the **API credentials** section
3. Copy these two values:

| Credential | Location |
|------------|----------|
| **API Key** (Client ID) | App settings → API credentials |
| **API Secret Key** (Client Secret) | App settings → API credentials → Click **Show** |

Keep these ready for the next step.

---

## Step 4: Configure Environment

### 4.1 Create .env file

```bash
cp .env.example .env
```

### 4.2 Edit .env

Open `.env` and fill in the **4 required values**:

```bash
# 1. Paste from Step 3
SHOPIFY_API_KEY=your_api_key_from_partner_dashboard
SHOPIFY_API_SECRET=your_api_secret_from_partner_dashboard

# 2. Database — pick one:
#    SQLite (easiest, recommended for dev):
DATABASE_URL=file:./dev.db
#    PostgreSQL:
#    DATABASE_URL=postgresql://user:password@localhost:5432/shopforge
#    MySQL:
#    DATABASE_URL=mysql://user:password@localhost:3306/shopforge

# 3. Encryption key — generate with:
#    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=paste_generated_hex_string_here

# 4. CSRF secret — generate with:
#    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
CSRF_SECRET=paste_another_hex_string_here
```

### 4.3 Edit shopify.app.toml

Open `shopify.app.toml` and update `client_id` with your API Key:

```toml
client_id = "your_api_key_here"    # ← Replace with your actual API Key (Client ID)
name = "Your App Name"              # ← Change to your app name
application_url = "https://example.com"
embedded = true

[auth]
redirect_urls = [ "https://example.com/auth/callback" ]
```

> **Tip:** `application_url` and `redirect_urls` use `https://example.com` as placeholders. Shopify CLI will automatically update these to the tunnel URL when you run `npm run dev`. You don't need to manually change them for development.

---

## Step 5: Start the App

```bash
npm run dev
```

The dev server will:
1. Validate your `.env` configuration
2. Sync the database schema (auto-create tables if needed)
3. Compile any Shopify Functions (if present in `extensions/`)
4. Start the Remix dev server with a Cloudflare tunnel

Wait until you see output like:

```
✓ App already configured. Starting dev server...
  Access your app from Shopify Admin → Apps menu.
```

---

## Step 6: Open in Browser

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
2. Delete the database: `rm dev.db` (or `DROP DATABASE` for PostgreSQL/MySQL)
3. Run `npm run dev` again
4. Press **P** to reopen

### "App not installed" error

You need to release at least one version in Partner Dashboard (Step 2.4). The dev preview requires a released version.

### Port already in use

```bash
# Kill the process on port 3000 (or your configured PORT)
npx kill-port 3000
# Then restart
npm run dev
```

### Database connection failed

Check your `DATABASE_URL` in `.env`. For SQLite, make sure the path is writable. For PostgreSQL/MySQL, verify the host, port, username, and password.

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
