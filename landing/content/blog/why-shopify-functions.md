---
title: "Why Shopify Functions Are a Game Changer for App Developers"
description: "Shopify Functions let you run custom logic at checkout — discounts, delivery rules, payment customizations — all with sub-50ms performance. Here's why they matter."
date: "2026-08-15"
author: "ShopForge Team"
---

# Why Shopify Functions Are a Game Changer for App Developers

Shopify Functions are the modern way to customize checkout behavior in Shopify. They replace the old Script API with a faster, more flexible, and more reliable system.

## What Are Shopify Functions?

A Shopify Function is a small piece of code that runs on Shopify's infrastructure during checkout. It receives input data (cart contents, customer info, etc.) and returns instructions (apply discount, rename shipping option, etc.).

Key characteristics:

- **Pure functions** — they read data and return operations, they cannot modify the cart
- **Sub-50ms execution** — Shopify enforces strict performance limits
- **WASM or JavaScript** — compile to WebAssembly for performance, or use JavaScript for simplicity

## Why They Matter for App Developers

Before Functions, customizing checkout required Shopify Plus and the legacy Script API. Now, any app can:

- Create custom discount logic (BOGO, volume pricing, loyalty discounts)
- Customize delivery options (free shipping thresholds, surcharges)
- Modify payment customization rules

This opens up a massive market of checkout customization apps.

## How ShopForge Makes It Easy

ShopForge includes 6 Function templates out of the box:

- `order-discount` (Rust) — spend threshold discount
- `order-discount-js` (JavaScript) — same logic, no Rust needed
- `free-shipping-js` — free shipping above a minimum cart value
- `volume-discount-js` — tiered quantity discounts

Each template includes:

1. The Function logic (`run.js` or `run.rs`)
2. A Polaris config UI in the admin
3. A Discount API service to create and manage discounts
4. Metafield-based data flow between UI and Function

## Getting Started with Functions

The fastest way to try a Function:

```bash
# Scaffold from template
npm run generate:function free-shipping-js

# Edit the logic
# extensions/free-shipping-js/src/run.js

# Test locally
npm run test:function free-shipping-js

# Deploy
shopify app deploy
```

No Rust toolchain required for the JavaScript templates. Just edit `run.js` and deploy.

---

Shopify Functions are the future of checkout customization. Start building your Function-powered app today with ShopForge.
