import { z } from 'zod';
import { basisPoints, currencyCode, discount, hexColor, isoDateTime, minorUnits, slug, uuid } from './common.ts';

/** GET /api/tenant — public, cached 60 s. */
export const tenantSchema = z.object({
  id: uuid,
  slug,
  name: z.string(),
  currency: currencyCode,
  catalogVersion: z.number().int().positive(),
  defaultShareExpiryDays: z.number().int().min(1).max(90),
  branding: z.object({
    displayName: z.string(),
    tagline: z.string().nullable(),
    primaryColor: hexColor,
    logoUrl: z.string().nullable(),
    faviconUrl: z.string().nullable(),
    supportEmail: z.string().nullable(),
    supportPhone: z.string().nullable(),
    legalName: z.string().nullable(),
    legalAddress: z.string().nullable(),
    vatDisplay: z.enum(['INCLUDED', 'EXCLUDED', 'NONE']),
  }),
});
export type Tenant = z.infer<typeof tenantSchema>;

export const attributeSchema = z.object({
  code: z.string(),
  label: z.string(),
  unit: z.string().nullable(),
  value: z.union([z.number(), z.string(), z.boolean()]),
});
export type Attribute = z.infer<typeof attributeSchema>;

/** Asset URLs are same-origin paths; protected ones need an asset session cookie. */
export const modelAssetsSchema = z.object({
  thumbnailUrl: z.string().nullable(),
  gallery: z.array(z.string()),
  lowGlbUrl: z.string().nullable(),
  highGlbUrl: z.string().nullable(),
  hasAr: z.boolean(),
});

export const catalogItemSchema = z.object({
  id: uuid,
  slug,
  sku: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  attributes: z.array(attributeSchema),
  assets: modelAssetsSchema,
  /** Manufacturer's list ("max") price of the base model. */
  listPriceMinor: minorUnits,
  /** Base model price after this reseller's discount (capped). */
  priceFromMinor: minorUnits,
  discount: discount.nullable(),
  sortOrder: z.number().int(),
});
export type CatalogItem = z.infer<typeof catalogItemSchema>;

/** GET /api/catalog?v= */
export const catalogSchema = z.object({
  catalogVersion: z.number().int().positive(),
  currency: currencyCode,
  items: z.array(catalogItemSchema),
});
export type Catalog = z.infer<typeof catalogSchema>;

export const optionSchema = z.object({
  id: uuid,
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  swatchColor: hexColor.nullable(),
  thumbnailUrl: z.string().nullable(),
  glbUrl: z.string().nullable(),
  priceDeltaMinor: minorUnits,
  isDefault: z.boolean(),
});
export type OptionDto = z.infer<typeof optionSchema>;

export const optionGroupSchema = z.object({
  id: uuid,
  code: z.string(),
  name: z.string(),
  selectionType: z.enum(['SINGLE', 'MULTI']),
  required: z.boolean(),
  options: z.array(optionSchema),
});
export type OptionGroupDto = z.infer<typeof optionGroupSchema>;

/** GET /api/catalog/saunas/:slug?v= */
export const saunaDetailSchema = catalogItemSchema.extend({
  groups: z.array(optionGroupSchema),
  rules: z.object({
    requires: z.array(z.object({ optionId: uuid, requiredOptionId: uuid })),
    excludes: z.array(z.object({ optionAId: uuid, optionBId: uuid })),
  }),
  maxDiscountBps: basisPoints,
});
export type SaunaDetail = z.infer<typeof saunaDetailSchema>;

export const roomPresetSchema = z.object({
  widthMm: z.number().int().positive(),
  depthMm: z.number().int().positive(),
  heightMm: z.number().int().positive(),
  floor: z.enum(['oak', 'concrete', 'tiles', 'stone', 'decking']),
  wallColor: hexColor,
  windowWall: z.enum(['north', 'east', 'south', 'west', 'none']).default('none'),
});
export type RoomPreset = z.infer<typeof roomPresetSchema>;

/** GET /api/rooms?v= */
export const roomSchema = z.object({
  id: uuid,
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  preset: roomPresetSchema.nullable(),
  thumbnailUrl: z.string().nullable(),
  lowGlbUrl: z.string().nullable(),
  highGlbUrl: z.string().nullable(),
});
export type Room = z.infer<typeof roomSchema>;
export const roomsSchema = z.object({ items: z.array(roomSchema) });

export const catalogVersionQuery = z.object({ v: z.coerce.number().int().positive().optional() });

/** POST /api/assets/session */
export const assetSessionRequest = z.object({ shareToken: z.string().max(100).optional() });
export const assetSessionResponse = z.object({ tier: z.enum(['LOW', 'FULL']), expiresAt: isoDateTime });

/** POST /api/assets/ar — short-lived signed URLs for the OS AR viewers (design 10.4). */
export const arRequest = z.object({ saunaModelId: uuid, shareToken: z.string().max(100).optional() });
export const arResponse = z.object({
  glbUrl: z.string().nullable(),
  usdzUrl: z.string().nullable(),
  expiresAt: isoDateTime,
});
