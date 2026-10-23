import { z } from 'zod';
import { isoDateTime, priceBreakdown, priceSnapshot, uuid } from './common.ts';
import { requestStatus } from './requests.ts';

export const placementSchema = z.object({
  roomSceneId: uuid,
  positionXMm: z.number().int().min(-50_000).max(50_000),
  positionZMm: z.number().int().min(-50_000).max(50_000),
  rotationDeg: z.number().min(-360).max(360),
});
export type Placement = z.infer<typeof placementSchema>;

export const configurationSchema = z.object({
  id: uuid,
  name: z.string(),
  sauna: z.object({ id: uuid, slug: z.string(), name: z.string(), thumbnailUrl: z.string().nullable() }),
  selections: z.array(uuid),
  placement: placementSchema.nullable(),
  locked: z.boolean(),
  lockedAt: isoDateTime.nullable(),
  /** Live price while a draft; the frozen snapshot once locked. */
  price: priceBreakdown,
  snapshot: priceSnapshot.nullable(),
  owner: z.enum(['CUSTOMER', 'STAFF']),
  customerId: uuid.nullable(),
  sourceConfigurationId: uuid.nullable(),
  request: z.object({ id: uuid, status: requestStatus }).nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Configuration = z.infer<typeof configurationSchema>;

export const configurationSummarySchema = configurationSchema.pick({
  id: true, name: true, sauna: true, locked: true, lockedAt: true, owner: true, request: true, createdAt: true, updatedAt: true,
}).extend({ finalPriceMinor: z.number().int(), currency: z.string() });
export type ConfigurationSummary = z.infer<typeof configurationSummarySchema>;

export const createConfigurationRequest = z.object({
  saunaModelId: uuid,
  name: z.string().trim().min(1).max(120).optional(),
  /** Omitted → the model's default selection. */
  selections: z.array(uuid).max(200).optional(),
});
export const renameConfigurationRequest = z.object({ name: z.string().trim().min(1).max(120) });
export const putSelectionsRequest = z.object({ optionIds: z.array(uuid).max(200) });
export const putPlacementRequest = placementSchema.nullable();
export const submitRequestRequest = z.object({ message: z.string().trim().max(4000).optional() });

/** POST /api/admin/configurations — a reseller configures on behalf of a customer or as a draft to share. */
export const adminCreateConfigurationRequest = createConfigurationRequest.extend({ customerId: uuid.optional() });
