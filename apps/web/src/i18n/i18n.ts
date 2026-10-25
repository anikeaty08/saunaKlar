/**
 * Small typed i18n: nested message objects per locale (`en` is the source of
 * truth), `{name}` interpolation and plurals through Intl.PluralRules.
 *
 * Language resolution: `?lang=` → localStorage → navigator.languages → `en`.
 * Non-English messages are separate chunks, loaded before they are shown.
 */
import { create } from 'zustand';
import { en, type Messages } from './locales/en.ts';
import type { MessagePath, Params, PluralForms } from './types.ts';

export const LOCALES = ['en', 'de', 'fr', 'it', 'rm'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** Endonyms: a language is always named in itself. */
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', de: 'Deutsch', fr: 'Français', it: 'Italiano', rm: 'Rumantsch' };

/** BCP 47 tag for Intl formatting (the platform is Swiss-centred; English uses en-GB conventions). */
export const INTL_TAG: Record<Locale, string> = { en: 'en-GB', de: 'de-CH', fr: 'fr-CH', it: 'it-CH', rm: 'rm-CH' };

const STORAGE_KEY = 'saunaklar:lang';

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as readonly string[]).includes(v);

export function detectLocale(): Locale {
  try {
    const q = new URLSearchParams(window.location.search).get('lang')?.toLowerCase();
    if (isLocale(q)) return q;
  } catch {
    /* ignore */
  }
  try {
    const s = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(s)) return s;
  } catch {
    /* ignore */
  }
  for (const l of navigator.languages ?? [navigator.language]) {
    const base = l?.toLowerCase().split('-')[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

const loaders: Record<Locale, () => Promise<Messages>> = {
  en: async () => en,
  de: () => import('./locales/de.ts').then(m => m.de),
  fr: () => import('./locales/fr.ts').then(m => m.fr),
  it: () => import('./locales/it.ts').then(m => m.it),
  rm: () => import('./locales/rm.ts').then(m => m.rm),
};
const loaded = new Map<Locale, Messages>([['en', en]]);

export async function loadMessages(locale: Locale): Promise<Messages> {
  const hit = loaded.get(locale);
  if (hit) return hit;
  const m = await loaders[locale]();
  loaded.set(locale, m);
  return m;
}

// ---- store -----------------------------------------------------------------------

interface I18nState {
  locale: Locale;
  messages: Messages;
  switching: boolean;
}

export const useI18n = create<I18nState>(() => ({ locale: DEFAULT_LOCALE, messages: en, switching: false }));

function commit(locale: Locale, messages: Messages) {
  useI18n.setState({ locale, messages });
  document.documentElement.lang = locale;
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
}

/** Called once before the first render so the first paint is already in the right language. */
export async function initI18n(): Promise<void> {
  const locale = detectLocale();
  try {
    commit(locale, await loadMessages(locale));
  } catch {
    commit(DEFAULT_LOCALE, en);
  }
}

/**
 * The page-flip transition registers itself here. It receives `swap`, which
 * it must call at the midpoint (content edge-on), and resolves when done.
 */
type Transition = (swap: () => void) => Promise<void>;
let transition: Transition | null = null;
export function registerLocaleTransition(t: Transition | null): void {
  transition = t;
}

export async function setLocale(locale: Locale): Promise<void> {
  const state = useI18n.getState();
  if (locale === state.locale || state.switching) return;
  useI18n.setState({ switching: true });
  try {
    const messages = await loadMessages(locale);
    if (transition) await transition(() => commit(locale, messages));
    else commit(locale, messages);
  } finally {
    useI18n.setState({ switching: false });
  }
}

export const getLocale = (): Locale => useI18n.getState().locale;

// ---- translate -----------------------------------------------------------------------

const pluralCache = new Map<Locale, Intl.PluralRules>();
function plural(locale: Locale, n: number): Intl.LDMLPluralRule {
  let r = pluralCache.get(locale);
  if (!r) {
    r = new Intl.PluralRules(INTL_TAG[locale]);
    pluralCache.set(locale, r);
  }
  return r.select(n);
}

/** Replaces `{name}` placeholders; numbers are formatted for the locale. */
export function interpolate(template: string, params: Params | undefined, locale: Locale = getLocale()): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (all, key: string) => {
    const v = params[key];
    if (v === undefined) return all;
    return typeof v === 'number' ? new Intl.NumberFormat(INTL_TAG[locale]).format(v) : v;
  });
}

function lookup(messages: Messages, path: string): unknown {
  let node: unknown = messages;
  for (const part of path.split('.')) {
    if (node && typeof node === 'object' && part in node) node = (node as Record<string, unknown>)[part];
    else return undefined;
  }
  return node;
}

export type TKey = MessagePath<Messages>;

export function translate(messages: Messages, locale: Locale, key: TKey, params?: Params): string {
  let node = lookup(messages, key);
  // A missing key in a translation falls back to English rather than showing the key.
  if (node === undefined) node = lookup(en, key);
  if (typeof node === 'string') return interpolate(node, params, locale);
  if (node && typeof node === 'object' && 'other' in node) {
    const forms = node as PluralForms;
    const count = Number(params?.count ?? 0);
    const form = (count === 0 && forms.zero) || forms[plural(locale, count)] || forms.other;
    return interpolate(form, params, locale);
  }
  if (import.meta.env.DEV) console.warn(`[i18n] missing message ${key}`);
  return key;
}

/** Translate outside React (uses the current locale). */
export function t(key: TKey, params?: Params): string {
  const { messages, locale } = useI18n.getState();
  return translate(messages, locale, key, params);
}

export interface Translator {
  t: (key: TKey, params?: Params) => string;
  /** The whole message tree, for lists (FAQ items, legal sections…). */
  m: Messages;
  locale: Locale;
  /** Interpolate a string taken from `m`. */
  f: (template: string, params?: Params) => string;
}

export function useT(): Translator {
  const messages = useI18n(s => s.messages);
  const locale = useI18n(s => s.locale);
  return {
    t: (key, params) => translate(messages, locale, key, params),
    m: messages,
    locale,
    f: (template, params) => interpolate(template, params, locale),
  };
}

export type { Messages };
