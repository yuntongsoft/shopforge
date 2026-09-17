# Contributing to ShopForge

Thanks for your interest in contributing! This guide will help you get started.

## Development Setup

```bash
# Clone and install
git clone https://github.com/your-org/shopforge.git
cd shopforge
npm install

# Set up environment
# macOS/Linux: cp .env.example .env
# Windows:     Copy-Item .env.example .env
# Then edit .env with your Shopify API credentials

# Start development
npm run dev
```

## Project Structure

```
shopforge/
├── app/                    # Main Remix application
│   ├── demo/               # Demo code (safe to delete)
│   ├── routes/             # Remix file-based routes
│   ├── services/           # Business logic layer
│   └── utils/              # Shared utilities
├── tests/                  # All tests (unified directory)
├── landing/                # Marketing site (npm workspace)
├── prisma/                 # Database schema and migrations
└── scripts/                # Build, dev, and utility scripts
```

## Key Principles

### Demo Isolation

All example code lives in `app/demo/` and `tests/demo/`. Infrastructure code in `app/services/` and `app/utils/` must NOT import from demo.

Demo routes in `app/routes/` are thin wrappers that re-export from `app/demo/routes/`:

```tsx
// app/routes/app.discounts.tsx
export { loader, action, default } from "~/demo/routes/discounts";
```

### Testing

All tests live in the unified `tests/` directory:

```
tests/
├── setup.ts        # Global mocks
├── utils/          # Infrastructure tests
├── services/       # Service tests
└── demo/           # Demo-specific tests
```

Run tests:

```bash
npm test              # Watch mode
npm run check         # Type check + full test run
```

### API Version

The Shopify API version is defined in ONE place: `app/utils/shopify-config.ts`. Both the SDK initialization and raw GraphQL calls import from this file. Never hardcode API versions elsewhere.

### Authentication

Two auth paths exist — use the right one:

| Function | When to use |
|----------|-------------|
| `authenticate.admin(request)` | SDK built-in, when you don't need shop data |
| `authenticatePage(request)` | Custom, when you need `{ shop, accessToken }` |

Both are documented in their respective files with usage examples.

## Code Style

- **TypeScript strict mode** — no `any` unless absolutely necessary
- **Functional components** — use hooks, not class components
- **Named exports** — prefer `export const` over `export default` for utilities
- **Comments explain Why** — code should be self-documenting for What/How

## Pull Request Process

1. Fork the repo and create a branch from `main`
2. Add tests for any new functionality
3. Run `npm run check` to verify everything passes
4. Update documentation if needed
5. Submit a PR with a clear description of changes

## Reporting Issues

When reporting bugs, include:

- Steps to reproduce
- Expected vs actual behavior
- Environment (Node version, OS, package manager)
- Relevant error messages or logs

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
