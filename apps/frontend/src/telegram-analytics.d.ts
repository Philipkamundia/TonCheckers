/**
 * Type declarations for @telegram-apps/analytics
 *
 * These declarations satisfy TypeScript when the package's bundled types
 * are not resolved automatically (e.g. older bundler/moduleResolution combos).
 * If the package bundles its own types, these are simply ignored.
 */
declare module '@telegram-apps/analytics' {
  interface TelegramAnalyticsInitOptions {
    /** SDK auth token obtained from @DataChief_bot */
    token: string;
    /** The analytics identifier registered in @DataChief_bot */
    appName: string;
  }

  interface TelegramAnalytics {
    /** Initialise the SDK. Must be called before the app starts rendering. */
    init(options: TelegramAnalyticsInitOptions): void;
  }

  const telegramAnalytics: TelegramAnalytics;
  export default telegramAnalytics;
}
