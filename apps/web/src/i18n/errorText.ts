import { isApiError } from '../api/client.ts';
import type { TKey } from './i18n.ts';

/** Localised message for an API error: errors.codes.<CODE>, else the problem's own text. */
export function errorText(t: (k: TKey) => string, e: unknown): string {
  if (isApiError(e)) {
    const key = `errors.codes.${e.code}` as TKey;
    const m = t(key);
    return m === key ? e.message : m;
  }
  return t('errors.body');
}
