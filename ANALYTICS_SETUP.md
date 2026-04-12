# Telegram Mini Apps Analytics — Setup Guide

## Why This Is Required

TApps Center requires the `@telegram-apps/analytics` SDK to be integrated before
an app can be listed. The SDK tracks app launches and TON Connect interactions
for ranking purposes.

## Step 1 — Get a Token

1. Open Telegram and message **@DataChief_bot**
2. Follow the prompts to register your app:
   - App name: `TonCheckers` (or your preferred identifier)
   - Mini App URL: `https://t.me/Toncheckers_bot/game`
3. The bot will issue you an **Analytics Token** and confirm your **App Name**

## Step 2 — Set Environment Variables

In your Cloudflare Pages / Vercel / Netlify deployment settings, add:

```
VITE_TELEGRAM_ANALYTICS_TOKEN=<token from @DataChief_bot>
VITE_TELEGRAM_ANALYTICS_APP_NAME=TonCheckers
```

For local development, update `apps/frontend/.env`:

```
VITE_TELEGRAM_ANALYTICS_TOKEN=your-token-here
VITE_TELEGRAM_ANALYTICS_APP_NAME=TonCheckers
```

## Step 3 — Verify

The SDK is initialised in `apps/frontend/src/main.tsx` **before** the React render
call, which is the required initialisation order per the SDK docs.

After deploying, open the Mini App in Telegram and check your analytics dashboard
at https://tganalytics.xyz/ — you should see a launch event within a few minutes.

## What the SDK Tracks (Automatically)

- App launches
- TON Connect wallet connection events
- User sessions

No manual event tracking is needed for the TApps Center requirement.

## Re-submission Checklist

- [ ] Token obtained from @DataChief_bot
- [ ] `VITE_TELEGRAM_ANALYTICS_TOKEN` set in deployment environment
- [ ] `VITE_TELEGRAM_ANALYTICS_APP_NAME` set in deployment environment
- [ ] Frontend rebuilt and deployed
- [ ] Verified a launch event appears in https://tganalytics.xyz/
- [ ] Re-submit via the TApps Center bot: @tapps_center_moderation
