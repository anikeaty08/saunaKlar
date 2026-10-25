import { z } from 'zod';
import { basisPoints, currencyCode, email, isoDateTime, minorUnits, slug, uuid } from './common.ts';

// ---- Manufacturer admin: /api/manufacturer/* on ADMIN_HOST only -----------
// Never returns customer PII (design A10): only reseller-level aggregates.

export const resellerStatus = z.enum(['ACTIVE', 'SUSPENDED']);

export const resellerSummarySchema = z.object({
  id: uuid,
  slug,
  name: z.string(),
  currency: currencyCode,
  status: resellerStatus,
  storefrontUrl: z.string(),
  saunasAssigned: z.number().int(),
  customers: z.number().int(),
  openRequests: z.number().int(),
  createdAt: isoDateTime,
});
export type ResellerSummary = z.infer<typeof resellerSummarySchema>;

export const resellerDetailSchema = resellerSummarySchema.extend({
  defaultShareExpiryDays: z.number().int(),
  catalogVersion: z.number().int(),
  admins: z.array(z.object({ id: uuid, email: z.string(), displayName: z.string(), role: z.enum(['OWNER', 'ADMIN']), status: z.enum(['INVITED', 'ACTIVE', 'DISABLED']) })),
  rooms: z.array(z.object({ id: uuid, code: z.string(), name: z.string(), assigned: z.boolean() })),
});
export type ResellerDetail = z.infer<typeof resellerDetailSchema>;

export const createResellerRequest = z.object({
  slug,
  name: z.string().trim().min(1).max(120),
  currencyCode,
  owner: z.object({ email, displayName: z.string().trim().min(1).max(120) }),
});
export const resellerPatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  status: resellerStatus.optional(),
});
export const inviteAdminRequest = z.object({ email, displayName: z.string().trim().min(1).max(120), role: z.enum(['OWNER', 'ADMIN']).default('ADMIN') });

export const assignmentSchema = z.object({
  saunaModelId: uuid,
  slug: z.string(),
  name: z.string(),
  assigned: z.boolean(),
  /** Why it cannot be assigned, e.g. a missing price in the reseller currency. */
  blockedReason: z.string().nullable(),
  isVisible: z.boolean().nullable(),
});
export const assignmentsSchema = z.object({ items: z.array(assignmentSchema) });
export const putRoomsRequest = z.object({ roomSceneIds: z.array(uuid).max(200) });

export const manufacturerSaunaSchema = z.object({
  id: uuid,
  sku: z.string(),
  slug: z.string(),
  name: z.string(),
  status: z.enum(['DRAFT', 'ACTIVE', 'RETIRED']),
  thumbnailUrl: z.string().nullable(),
  prices: z.array(z.object({ currency: currencyCode, listPriceMinor: minorUnits, maxDiscountBps: basisPoints })),
  resellersAssigned: z.number().int(),
});
export type ManufacturerSauna = z.infer<typeof manufacturerSaunaSchema>;

export const manufacturerSaunaDetailSchema = manufacturerSaunaSchema.extend({
  groups: z.array(z.object({
    id: uuid,
    code: z.string(),
    name: z.string(),
    selectionType: z.enum(['SINGLE', 'MULTI']),
    required: z.boolean(),
    options: z.array(z.object({
      id: uuid,
      code: z.string(),
      name: z.string(),
      prices: z.array(z.object({ currency: currencyCode, priceDeltaMinor: minorUnits })),
    })),
  })),
});
export type ManufacturerSaunaDetail = z.infer<typeof manufacturerSaunaDetailSchema>;

export const putPriceRequest = z.object({ listPriceMinor: minorUnits, maxDiscountBps: basisPoints });
export const putOptionPriceRequest = z.object({ priceDeltaMinor: minorUnits });

export const manufacturerAnalyticsSchema = z.object({
  days: z.number().int(),
  resellers: z.array(z.object({
    resellerId: uuid,
    name: z.string(),
    slug: z.string(),
    customers: z.number().int(),
    configurations: z.number().int(),
    requests: z.number().int(),
    acceptedRequests: z.number().int(),
    shareLinkViews: z.number().int(),
  })),
});

export const auditEventSchema = z.object({
  id: z.string(),
  occurredAt: isoDateTime,
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  resellerId: uuid.nullable(),
  actorName: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).nullable(),
});
export const auditQuery = z.object({
  resellerId: uuid.optional(),
  entityType: z.string().max(60).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
