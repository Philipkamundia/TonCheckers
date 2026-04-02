# CheckTON — Deployment Guide

**Backend + DB → Railway | Frontend → Vercel**

---

## Prerequisites

- Railway account (railway.app)
- Vercel account (vercel.com)
- Telegram bots created via @BotFather:
  - Main bot: @CheckTONBot (user notifications)
  - Admin bot: @CheckTONAdminBot (private, admin dashboard)
- TON wallets: hot wallet, cold wallet, treasury/admin wallet
- TON API key from toncenter.com (recommended for mainnet)

---

## Part 1 — Railway (Backend + Database + Redis)

### 1.1 Create Railway Project

1. railway.app → New Project → Deploy from GitHub repo → select this repo
2. Railway auto-detects `railway.json` — no extra config needed

### 1.2 Add Services

In your Railway project dashboard, add:

- **PostgreSQL** plugin → Railway injects `DATABASE_URL` automatically
- **Redis** plugin → Railway injects `REDIS_URL` automatically

### 1.3 Set Environment Variables

In the backend service → Variables tab:

```env
# Injected automatically by Railway plugins
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}

# Server
NODE_ENV=production
PORT=3001

# Auth — generate with: openssl rand -base64 32
JWT_SECRET=<random 32+ char string>
JWT_REFRESH_SECRET=<different random 32+ char string>

# Telegram
TELEGRAM_BOT_TOKEN=<from @BotFather>
ADMIN_BOT_TOKEN=<second bot from @BotFather>
TELEGRAM_BOT_SECRET=<random string for webhook verification>

# TON Network
TON_NETWORK=mainnet
TON_API_KEY=<from toncenter.com>

# Treasury Wallets
HOT_WALLET_ADDRESS=<hot wallet TON address>
HOT_WALLET_MNEMONIC=<24-word seed phrase — Railway encrypts this>
COLD_WALLET_ADDRESS=<cold wallet TON address>
TREASURY_WALLET_ADDRESS=<your admin wallet — used for admin auth>

# Game Config
PLATFORM_FEE_PERCENT=15
TOURNAMENT_PLATFORM_FEE_PERCENT=25
TOURNAMENT_CREATOR_FEE_PERCENT=5
MIN_DEPOSIT_TON=0.5
MIN_STAKE_TON=0.1
MAX_DAILY_WITHDRAWAL_TON=100

# Frontend URL (set after Vercel deploy)
FRONTEND_URL=https://your-app.vercel.app

# Sentry (optional)
SENTRY_DSN=<from sentry.io>
```

### 1.4 Run Database Migrations

After first deploy, open Railway shell for the backend service:

```bash
npm run migrate --workspace=apps/backend
```

Runs all 8 migrations in order. Safe to re-run — idempotent.

### 1.5 Verify Backend

```bash
curl https://your-backend.railway.app/health
# Expected: { "ok": true, "db": "connected", "redis": "connected" }
```

---

## Part 2 — Vercel (Frontend)

### 2.1 Deploy

```bash
cd apps/frontend
npx vercel --prod
```

Or connect the repo in Vercel dashboard:
- Root directory: `apps/frontend`
- Build command: `npm run build`
- Output directory: `dist`
- Framework preset: Vite

### 2.2 Set Environment Variables in Vercel

```env
VITE_API_URL=https://your-backend.railway.app
VITE_WS_URL=https://your-backend.railway.app
VITE_APP_URL=https://your-app.vercel.app
VITE_SENTRY_DSN=<from sentry.io — optional>
```

### 2.3 SPA Routing

`vercel.json` is already configured to serve `index.html` for all routes.
The `tonconnect-manifest.json` is served with CORS headers so TonConnect wallets can fetch it.

---

## Part 3 — Telegram Mini App Setup

### 3.1 Register the Mini App

1. Open @BotFather → `/newapp`
2. Select your main bot
3. Set Web App URL: `https://your-app.vercel.app`
4. Upload the game icon (512×512 PNG) — use `gameicon.png` from the repo root

### 3.2 Register Admin Bot Webhook

```bash
curl "https://api.telegram.org/bot{ADMIN_BOT_TOKEN}/setWebhook?url=https://your-backend.railway.app/api/admin/bot-webhook"
```

When admin sends `/start` to the admin bot, they receive a dashboard link.

### 3.3 Update tonconnect-manifest.json

`apps/frontend/public/tonconnect-manifest.json` already references `https://checkton.app/gameicon.png`.
Update the `url` field to match your actual deployed domain before launch.

---

## Part 4 — Post-Deploy Checklist

- [ ] `GET /health` returns `{ ok: true, db: "connected", redis: "connected" }`
- [ ] `npm run migrate` ran successfully (8 migrations applied)
- [ ] Frontend loads at Vercel URL inside Telegram
- [ ] TonConnect wallet connection works (proof verification)
- [ ] Test deposit: send 1 TON with memo = your user ID → credited within 60s
- [ ] Test withdrawal to connected wallet
- [ ] Admin bot sends dashboard link on `/start`
- [ ] `NODE_ENV=production` confirmed
- [ ] All secrets are production values (not dev placeholders)
- [ ] `HOT_WALLET_MNEMONIC` stored in Railway encrypted env vars
- [ ] CORS: `FRONTEND_URL` in Railway matches your Vercel URL exactly

---

## CORS Note

The backend allows requests from `FRONTEND_URL` in production.
If your Vercel URL changes (e.g. preview deployments), add it to the allowed origins
or set a custom domain in Vercel and use that as `FRONTEND_URL`.

## WebSocket Note

Socket.IO connects to `VITE_WS_URL`. Railway provides a persistent connection —
no special config needed. Vercel does NOT support WebSockets, which is why
the backend stays on Railway.
