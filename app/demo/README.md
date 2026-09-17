# Demo Code

> **Delete these to remove all demo code:**
>
> ```bash
> rm -rf app/demo        # Demo services, routes, components
> rm -rf tests/demo      # Demo tests
> rm app/routes/app.order.tsx app/routes/app.discounts.tsx \
>    app/routes/app.theme-widget.tsx app/routes/app.pricing.tsx
> ```
>
> Or use the automated script:
> ```bash
> pnpm clean:demo
> ```

## What's in here

| Location | Description |
|----------|-------------|
| `services/discount-api.ts` | Shopify Discount API — CRUD for automatic discounts |
| `services/rule-engine.ts` | High-level rule abstraction (hides Function IDs) |
| `services/function-registry.ts` | Maps rule types → deployed Function GIDs |
| `routes/discounts.tsx` | Discount management UI |
| `routes/order.tsx` | CRUD page for Order model |
| `routes/theme-widget.tsx` | Theme widget configuration |
| `routes/pricing.tsx` | Subscription billing page |

## Route wrappers

Demo route components live here (`app/demo/routes/`), but Remix requires route
files in `app/routes/`. The wrappers in `app/routes/` are thin re-exports:

```tsx
// app/routes/app.discounts.tsx — just re-exports
export { loader, action, default } from "~/demo/routes/discounts";
```

## Tests

Demo tests are in `tests/demo/` (unified test directory).

## Dependencies

Demo code imports from infrastructure (`~/services/`, `~/utils/`, `~/db.server`).
Infrastructure does NOT import from demo.
