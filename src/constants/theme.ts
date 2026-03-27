export const COLORS = {
  mastersGreen: '#006747',
  mastersDark: '#004d35',
  mastersLight: '#008a5e',
  mastersYellow: '#FFD700',
  mastersGold: '#C5A028',
  mastersCream: '#FFF8E7',
  mastersBg: '#f5f5f0',
  white: '#FFFFFF',
  black: '#000000',
  gray: {
    50: '#f9fafb',
    100: '#f3f4f6',
    200: '#e5e7eb',
    300: '#d1d5db',
    400: '#9ca3af',
    500: '#6b7280',
    600: '#4b5563',
    700: '#374151',
    800: '#1f2937',
    900: '#111827',
  },
} as const;

export const TIER_COLORS = [
  { bg: 'bg-masters-yellow', text: 'text-gray-900', label: 'Tier 1 — Favorites' },
  { bg: 'bg-orange-400', text: 'text-white', label: 'Tier 2 — Contenders' },
  { bg: 'bg-blue-500', text: 'text-white', label: 'Tier 3 — Solid Picks' },
  { bg: 'bg-purple-500', text: 'text-white', label: 'Tier 4 — Mid-Range' },
  { bg: 'bg-emerald-600', text: 'text-white', label: 'Tier 5 — Sleepers' },
  { bg: 'bg-red-500', text: 'text-white', label: 'Tier 6 — Long Shots' },
] as const;

export const PAYMENT_METHODS = {
  venmo: 'Phil-Overton',
  cashApp: 'PhilipOverton',
  payPal: 'pove1@juno.com',
  zelle: 'pove1@juno.com',
} as const;

export const ENTRY_FEE = 10;
