import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import telegramAnalytics from '@telegram-apps/analytics';
import './index.css';
import { App } from './App';

// ─── Telegram Mini Apps Analytics SDK ────────────────────────────────────────
// Must be initialised BEFORE the application starts rendering so that all
// events (including the initial app-launch event) are captured correctly.
// Token and appName are injected via environment variables so they are never
// hard-coded in source. Set VITE_TELEGRAM_ANALYTICS_TOKEN and
// VITE_TELEGRAM_ANALYTICS_APP_NAME in your deployment environment.
// Obtain a token via @DataChief_bot on Telegram (TON Builders portal).
const analyticsToken   = import.meta.env.VITE_TELEGRAM_ANALYTICS_TOKEN   as string | undefined;
const analyticsAppName = import.meta.env.VITE_TELEGRAM_ANALYTICS_APP_NAME as string | undefined;

if (analyticsToken && analyticsAppName) {
  telegramAnalytics.init({
    token:   analyticsToken,
    appName: analyticsAppName,
  });
} else {
  // Warn in development so misconfiguration is obvious, but never crash the app
  if (import.meta.env.DEV) {
    console.warn(
      '[Analytics] VITE_TELEGRAM_ANALYTICS_TOKEN or VITE_TELEGRAM_ANALYTICS_APP_NAME is not set. ' +
      'Analytics will not be collected. Obtain a token from @DataChief_bot.',
    );
  }
}

// ─── Sentry (optional error tracking) ────────────────────────────────────────
const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 0,
    beforeSend(event) {
      if (event.user) delete event.user.email;
      return event;
    },
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
