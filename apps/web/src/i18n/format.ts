/**
 * The single place for locale-aware formatting: money (via the pricing
 * package), numbers, units, dates and relative times.
 */
import { formatMoney } from '@saunaklar/pricing';
import { useI18n, INTL_TAG, getLocale, type Locale } from './i18n.ts';

export interface Formatter {
  money: (minor: number, currency: string) => string;
  number: (n: number, opts?: Intl.NumberFormatOptions) => string;
  /** 2400 mm → "2.4 m" style, or keeps mm when asked. */
  mm: (mm: number, unit?: 'm' | 'cm' | 'mm') => string;
  date: (iso: string | Date, style?: 'short' | 'medium' | 'long') => string;
  dateTime: (iso: string | Date) => string;
  relative: (iso: string | Date) => string;
  list: (items: string[], type?: 'conjunction' | 'disjunction') => string;
  percentBps: (bps: number) => string;
}

export function formatterFor(locale: Locale): Formatter {
  const tag = INTL_TAG[locale];
  const nf = (o?: Intl.NumberFormatOptions) => new Intl.NumberFormat(tag, o);
  return {
    money: (minor, currency) => {
      try {
        return formatMoney(minor, currency, tag);
      } catch {
        return nf({ style: 'currency', currency }).format(minor / 100);
      }
    },
    number: (n, o) => nf(o).format(n),
    mm: (mm, unit = 'm') => {
      if (unit === 'mm') return `${nf().format(mm)} mm`;
      if (unit === 'cm') return `${nf({ maximumFractionDigits: 1 }).format(mm / 10)} cm`;
      return `${nf({ minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(mm / 1000)} m`;
    },
    date: (iso, style = 'medium') => new Intl.DateTimeFormat(tag, { dateStyle: style }).format(new Date(iso)),
    dateTime: iso => new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)),
    relative: iso => {
      const diff = (new Date(iso).getTime() - Date.now()) / 1000;
      const rtf = new Intl.RelativeTimeFormat(tag, { numeric: 'auto' });
      const abs = Math.abs(diff);
      if (abs < 60) return rtf.format(Math.round(diff), 'second');
      if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
      if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
      if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
      return rtf.format(Math.round(diff / (86400 * 30)), 'month');
    },
    list: (items, type = 'conjunction') => new Intl.ListFormat(tag, { style: 'long', type }).format(items),
    percentBps: bps => nf({ style: 'percent', maximumFractionDigits: 2 }).format(bps / 10_000),
  };
}

export function useFormat(): Formatter {
  const locale = useI18n(s => s.locale);
  return formatterFor(locale);
}

export const format = (): Formatter => formatterFor(getLocale());
