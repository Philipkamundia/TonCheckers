/**
 * theme.ts — Single source of truth for all colour tokens.
 *
 * Rules:
 *  - "dark"   : dark cards (#2c2c2e), white text  — always Telegram dark-style
 *  - "light"  : white cards (#ffffff), black text
 *  - "system" : remove overrides so Telegram's own CSS vars take over
 *
 * Every CSS variable used across screens must be listed here.
 * Never add raw hex values to component files — reference these vars instead.
 */

export type Theme = 'system' | 'light' | 'dark';

interface TokenMap {
  '--tg-theme-bg-color': string;
  '--tg-theme-secondary-bg-color': string;
  '--tg-theme-text-color': string;
  '--tg-theme-hint-color': string;
  '--tg-theme-link-color': string;
  '--tg-theme-button-color': string;
  '--tg-theme-button-text-color': string;
  '--tg-theme-destructive-text-color': string;
  '--card-border': string;
}

export const THEME_TOKENS: Record<'dark' | 'light', TokenMap> = {
  dark: {
    '--tg-theme-bg-color':              '#1c1c1e',
    '--tg-theme-secondary-bg-color':    '#2c2c2e',
    '--tg-theme-text-color':            '#ffffff',
    '--tg-theme-hint-color':            '#8e8e93',
    '--tg-theme-link-color':            '#2AABEE',
    '--tg-theme-button-color':          '#2AABEE',
    '--tg-theme-button-text-color':     '#ffffff',
    '--tg-theme-destructive-text-color':'#ff3b30',
    '--card-border':                    '1px solid rgba(255,255,255,0.07)',
  },
  light: {
    '--tg-theme-bg-color':              '#f2f2f7',
    '--tg-theme-secondary-bg-color':    '#ffffff',
    '--tg-theme-text-color':            '#000000',
    '--tg-theme-hint-color':            '#6d6d72',
    '--tg-theme-link-color':            '#2AABEE',
    '--tg-theme-button-color':          '#2AABEE',
    '--tg-theme-button-text-color':     '#ffffff',
    '--tg-theme-destructive-text-color':'#ff3b30',
    '--card-border':                    '1px solid rgba(0,0,0,0.08)',
  },
};

/**
 * Apply a theme by writing CSS custom properties onto <html>.
 * Briefly adds `.theme-transition` so the change animates smoothly,
 * then removes it so it doesn't interfere with in-app animations.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;

  if (theme === 'system') {
    // Clear all manual overrides; Telegram's injected vars take back control.
    const allKeys = Object.keys(THEME_TOKENS.dark) as Array<keyof TokenMap>;
    allKeys.forEach(key => root.style.removeProperty(key));
    return;
  }

  // Kick off transition before applying values so browsers animate the change.
  root.classList.add('theme-transition');
  const tokens = THEME_TOKENS[theme];
  (Object.entries(tokens) as Array<[string, string]>).forEach(([key, val]) => {
    root.style.setProperty(key, val);
  });
  // Remove transition class after the animation window (300 ms) to avoid
  // interfering with game-board or loading animations.
  setTimeout(() => root.classList.remove('theme-transition'), 350);
}
