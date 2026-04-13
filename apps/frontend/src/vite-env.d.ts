/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_WS_URL: string;
  readonly VITE_APP_URL: string;
  readonly VITE_SENTRY_DSN?: string;
  /** Telegram Mini Apps Analytics token from @DataChief_bot */
  readonly VITE_TELEGRAM_ANALYTICS_TOKEN?: string;
  /** Analytics app name registered in @DataChief_bot */
  readonly VITE_TELEGRAM_ANALYTICS_APP_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
