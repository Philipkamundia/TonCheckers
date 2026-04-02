// Design system constants
export const COLORS = {
  DARK_NAVY: '#0D1B2A',
  TON_BLUE: '#0098EA',
  GOLD: '#FFD700',
  NEUTRAL_GRAY: '#6C757D',
  WHITE: '#FFFFFF',
  SUCCESS: '#10B981',
  ERROR: '#EF4444',
  WARNING: '#F59E0B'
} as const;

export const FONTS = {
  TITLE: 'Montserrat',
  BODY: 'Inter',
  MONO: 'Roboto Mono'
} as const;

// Animation durations (in milliseconds)
export const ANIMATIONS = {
  FAST: 200,
  NORMAL: 300,
  SLOW: 500,
  VERY_SLOW: 1000,
  SEARCH_SPINNER: 3000,
  CONFETTI: 2000,
  BALANCE_UPDATE: 1500
} as const;

// Breakpoints for responsive design
export const BREAKPOINTS = {
  SM: 640,
  MD: 768,
  LG: 1024,
  XL: 1280,
  '2XL': 1536
} as const;

// Z-index levels
export const Z_INDEX = {
  DROPDOWN: 1000,
  STICKY: 1020,
  FIXED: 1030,
  MODAL_BACKDROP: 1040,
  MODAL: 1050,
  POPOVER: 1060,
  TOOLTIP: 1070,
  TOAST: 1080
} as const;
