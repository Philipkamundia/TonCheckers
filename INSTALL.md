# CheckTON — Install Guide

Run these commands **once** after cloning, before starting the dev server.

---

## Quick Start (all at once)

```bash
cd apps/backend
npm install
cp .env.example .env
# Fill in .env values (see Environment Variables section below)
npm run migrate
npm run seed
npm run dev
```

---

## Full Package List

All packages are already declared in `apps/backend/package.json`.  
`npm install` handles everything. This file documents *why* each package exists.

### Production Dependencies

| Package | Version | Purpose | Phase Added |
|---|---|---|---|
| `express` | ^4.18.2 | HTTP server framework | P1 |
| `cors` | ^2.8.5 | Cross-origin headers for Telegram Mini App | P1 |
| `helmet` | ^7.0.0 | Security headers | P1 |
| `morgan` | ^1.10.0 | HTTP request logging | P1 |
| `compression` | ^1.7.4 | Gzip response compression | P1 |
| `dotenv` | ^16.3.1 | `.env` file loading | P1 |
| `winston` | ^3.10.0 | Structured logging | P1 |
| `express-rate-limit` | ^8.1.0 | API rate limiting (PRD §16) | P1 |
| `pg` | ^8.19.0 | PostgreSQL client (node-postgres) | P1 |
| `ioredis` | ^5.3.2 | Redis client — timers, cooldowns, cache | P1 |
| `socket.io` | ^4.7.2 | WebSocket server for real-time game rooms | P5 |
| `jsonwebtoken` | ^9.0.2 | JWT access + refresh tokens | P2 |
| `zod` | ^3.22.2 | Request body validation | P2 |
| `@ton/core` | ^0.61.0 | TON blockchain core types | P2 |
| `@ton/crypto` | ^3.3.0 | TON cryptography (Ed25519 for wallet proof) | P2 |
| `@ton/ton` | ^15.3.1 | TON SDK — deposit polling, withdrawal signing | P3 |
| `@tonconnect/sdk` | ^3.3.0 | TonConnect proof verification | P2 |
| `axios` | ^1.12.2 | HTTP client for TON API calls | P3 |
| `node-cron` | ^4.2.1 | Scheduled jobs (deposit polling, tournament start) | P3 |

### Dev Dependencies

| Package | Version | Purpose |
|---|---|---|
| `typescript` | ^5.0.2 | TypeScript compiler |
| `tsx` | ^3.12.7 | Run TypeScript directly (dev server + scripts) |
| `@types/node` | ^20.5.0 | Node.js type definitions |
| `@types/express` | ^4.17.17 | Express type definitions |
| `@types/cors` | ^2.8.13 | CORS type definitions |
| `@types/compression` | ^1.7.3 | Compression type definitions |
| `@types/morgan` | ^1.9.4 | Morgan type definitions |
| `@types/jsonwebtoken` | ^9.0.2 | JWT type definitions |
| `@types/pg` | ^8.11.0 | PostgreSQL type definitions |
| `@typescript-eslint/parser` | ^6.0.0 | TypeScript ESLint parser |
| `@typescript-eslint/eslint-plugin` | ^6.0.0 | TypeScript ESLint rules |
| `eslint` | ^8.45.0 | Linter |
| `rimraf` | ^5.0.1 | Cross-platform `rm -rf` for `npm run clean` |
| `vitest` | ^0.34.1 | Unit test runner |

---

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```bash
cp apps/backend/.env.example apps/backend/.env
```

### Required for Phase 1 (server starts)
```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/checkton
REDIS_URL=redis://localhost:6379
JWT_SECRET=<random 32+ char string>
JWT_REFRESH_SECRET=<different random 32+ char string>
```

### Required for Phase 2 (auth works)
```env
TELEGRAM_BOT_TOKEN=<from @BotFather>
```

### Required for Phase 3 (deposits work)
```env
TON_NETWORK=testnet
TON_API_KEY=<from toncenter.com>
HOT_WALLET_ADDRESS=<your TON hot wallet address>
HOT_WALLET_MNEMONIC=<24 word mnemonic>
COLD_WALLET_ADDRESS=<your TON cold wallet address>
```

### Required for Phase 12 (admin dashboard)
```env
TREASURY_WALLET_ADDRESS=<your personal admin wallet address>
ADMIN_BOT_TOKEN=<from @BotFather — separate bot>
```

---

## Railway Deployment (Phase 12)

On Railway, environment variables are injected automatically:

```
DATABASE_URL  →  ${{Postgres.DATABASE_URL}}
REDIS_URL     →  ${{Redis.REDIS_URL}}
```

All other variables are set manually in the Railway dashboard.

After first deploy, run migrations via Railway shell:
```bash
npm run migrate
```

---

## Local Dev Prerequisites

- **Node.js** 20.x or higher
- **PostgreSQL** 15+ running locally (`brew install postgresql` / `apt install postgresql`)
- **Redis** 7+ running locally (`brew install redis` / `apt install redis`)

### Quick local DB setup
```bash
# Create the database
psql -U postgres -c "CREATE DATABASE checkton;"

# Run migrations
cd apps/backend
npm run migrate

# Seed test data
npm run seed
```

---

## npm Scripts Reference

| Command | What it does |
|---|---|
| `npm run dev` | Start dev server with hot reload (tsx watch) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start` | Run compiled production build |
| `npm run migrate` | Run all pending database migrations |
| `npm run seed` | Seed local database with 5 test users |
| `npm run lint` | Run ESLint on all TypeScript files |
| `npm run test` | Run unit tests with Vitest |
| `npm run clean` | Delete `dist/` folder |

---

## Frontend Setup

```bash
cd apps/frontend
cp .env.example .env
# Fill in VITE_API_URL, VITE_WS_URL, VITE_APP_URL
npm install
npm run dev          # local dev server on :5173
npm run build        # production build → dist/
```

### Frontend Package List

| Package | Purpose |
|---|---|
| `react` + `react-dom` | UI framework |
| `react-router-dom` | Screen routing |
| `@tonconnect/ui-react` | TonConnect wallet button + proof |
| `socket.io-client` | WebSocket for real-time game events |
| `zustand` | Global state (user, balance, game) |
| `axios` | HTTP client with initData auto-injection |

### Telegram Mini App Registration
1. Open @BotFather on Telegram
2. Send `/newapp` and follow prompts
3. Set your hosted frontend URL as the Web App URL
4. The `tonconnect-manifest.json` must be accessible at `{VITE_APP_URL}/tonconnect-manifest.json`
