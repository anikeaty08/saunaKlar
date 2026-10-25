import { z } from 'zod';
import { isoDateTime, priceSnapshot, uuid } from './common.ts';
import { saunaDetailSchema } from './catalog.ts';
import { placementSchema } from './configurations.ts';

export const createShareLinkRequest = z.object({ expiresInDays: z.number().int().min(1).max(90).optional() });

/** The token is returned exactly once, at creation; only its SHA-256 is stored. */
export const createdShareLinkSchema = z.object({ id: uuid, url: z.string(), expiresAt: isoDateTime });

export const shareLinkSchema = z.object({
  id: uuid,
  configurationId: uuid,
  expiresAt: isoDateTime,
  revokedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
  views: z.number().int().nonnegative(),
  lastViewedAt: isoDateTime.nullable(),
  state: z.enum(['ACTIVE', 'EXPIRED', 'REVOKED']),
});
export type ShareLink = z.infer<typeof shareLinkSchema>;
export const shareLinksSchema = z.object({ items: z.array(shareLinkSchema) });

/** GET /api/shared/:token — read-only snapshot, no account needed. */
export const sharedConfigurationSchema = z.object({
  configuration: z.object({ id: uuid, name: z.string(), selections: z.array(uuid), lockedAt: isoDateTime }),
  sauna: saunaDetailSchema.omit({ maxDiscountBps: true }),
  placement: placementSchema.nullable(),
  snapshot: priceSnapshot,
  expiresAt: isoDateTime,
});
export type SharedConfiguration = z.infer<typeof sharedConfigurationSchema>;

/** POST /api/shared/:token/claim — copy into the signed-in customer's account (review C5). */
export const claimResponse = z.object({ configurationId: uuid });
