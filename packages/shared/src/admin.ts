import { z } from 'zod';
import { basisPoints, discount, hexColor, isoDateTime, minorUnits, uuid } from './common.ts';
import { tenantSchema } from './catalog.ts';

// ---- Reseller admin: /api/admin/* on the reseller's own host -------------

export const brandingSchema = tenantSchema.shape.branding;
export const brandingPatch = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  tagline: z.string().trim().max(200).nullable().optional(),
  primaryColor: hexColor.optional(),
  supportEmail: z.email().nullable().optional(),
  supportPhone: z.string().trim().max(40).nullable().optional(),
  legalName: z.string().trim().max(200).nullable().optional(),
  legalAddress: z.string().trim().max(500).nullable().optional(),
  vatDisplay: z.enum(['INCLUDED', 'EXCLUDED', 'NONE']).optional(),
});

export const uploadKind = z.enum(['LOGO', 'FAVICON']);
export const UPLOAD_LIMITS = {
  LOGO: { maxBytes: 2 * 1024 * 1024, contentTypes: ['image/png', 'image/webp', 'image/jpeg'] },
  FAVICON: { maxBytes: 1024 * 1024, contentTypes: ['image/png', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon'] },
} as const;
export const createUploadRequest = z.object({
  kind: uploadKind,
  contentType: z.string().max(100),
  byteSize: z.number().int().positive().max(2 * 1024 * 1024),
});
/** A presigned PUT: the browser uploads directly to object storage, then calls `complete`. */
export const createUploadResponse = z.object({
  uploadId: z.string(),
  url: z.string(),
  headers: z.record(z.string(), z.string()),
  expiresAt: isoDateTime,
});

export const settingsSchema = z.object({ defaultShareExpiryDays: z.number().int().min(1).max(90) });

export const adminSaunaSchema = z.object({
  id: uuid,
  slug: z.string(),
  name: z.string(),
  thumbnailUrl: z.string().nullable(),
  isVisible: z.boolean(),
  sortOrder: z.number().int(),
  listPriceMinor: minorUnits,
  maxDiscountBps: basisPoints,
  discount: discount.nullable(),
  effectiveDiscount: discount.nullable(),
  priceFromMinor: minorUnits,
});
export type AdminSauna = z.infer<typeof adminSaunaSchema>;
export const adminSaunasSchema = z.object({ items: z.array(adminSaunaSchema), defaultDiscount: discount.nullable() });
export const adminSaunaPatch = z.object({ isVisible: z.boolean().optional(), sortOrder: z.number().int().min(0).max(100_000).optional() });
/** PUT /api/admin/saunas/order — whole ordering at once, for drag-and-drop. */
export const adminSaunaOrder = z.object({ saunaModelIds: z.array(uuid).max(1000) });

export const adminCustomerSummarySchema = z.object({
  id: uuid,
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  status: z.enum(['PENDING', 'ACTIVE', 'ANONYMISED']),
  createdAt: isoDateTime,
  configurations: z.number().int(),
  requests: z.number().int(),
});
export const adminCustomerListQuery = z.object({
  q: z.string().trim().max(200).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const analyticsQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });
export const analyticsSchema = z.object({
  days: z.number().int(),
  totals: z.object({
    customers: z.number().int(),
    configurations: z.number().int(),
    requests: z.number().int(),
    shareLinkViews: z.number().int(),
    acceptedRequests: z.number().int(),
  }),
  requestsByStatus: z.record(z.string(), z.number().int()),
  daily: z.array(z.object({ date: z.string(), requests: z.number().int(), configurations: z.number().int(), views: z.number().int() })),
  topSaunas: z.array(z.object({ saunaModelId: uuid, name: z.string(), configurations: z.number().int(), requests: z.number().int() })),
});
export type Analytics = z.infer<typeof analyticsSchema>;
