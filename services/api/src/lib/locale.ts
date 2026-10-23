import { negotiateLocale, type AppLocale } from '@saunaklar/shared';
import type { Ctx } from '../context.ts';

/** `?lang=` wins (it is part of the CDN cache key), then Accept-Language. */
export function requestLocale(c: Ctx): AppLocale {
  return negotiateLocale(c.req.query('lang'), c.req.header('accept-language'));
}
