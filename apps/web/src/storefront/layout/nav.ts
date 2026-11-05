import type { TKey } from '../../i18n/i18n.ts';

/** Primary navigation, shared by the header. */
export const PRIMARY_NAV: { to: string; key: TKey; end?: boolean }[] = [
  { to: '/saunas', key: 'nav.saunas' },
  { to: '/how-it-works', key: 'nav.howItWorks' },
  { to: '/guide', key: 'nav.guide' },
  { to: '/about', key: 'nav.about' },
];

export const SECONDARY_NAV: { to: string; key: TKey }[] = [
  { to: '/faq', key: 'nav.faq' },
  { to: '/contact', key: 'nav.contact' },
];
