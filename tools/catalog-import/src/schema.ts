/**
 * Manifest file formats (YAML). One sauna per file in `saunas/*.yaml`, one room per file in
 * `rooms/*.yaml`, and one shared `attributes.yaml` declaring every attribute code in use.
 * See README.md for a full example.
 */
import { z } from 'zod';

// These mirror the CHECK constraints in packages/db/migrations/0003_catalog.sql.
export const CODE_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const GROUP_CODE_RE = /^[a-z][a-z0-9-]{0,62}$/;
export const ATTRIBUTE_CODE_RE = /^[a-z][a-z0-9_]{0,62}$/;
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export const SKU_RE = /^[A-Z0-9][A-Z0-9-]{1,39}$/;
export const LOCALE_RE = /^[a-z]{2}(?:-[A-Z]{2})?$/;
export const CURRENCY_RE = /^[A-Z]{3}$/;

const code = z.string().regex(CODE_RE, 'lowercase letters, digits and "-" (max 63)');
const groupCode = z.string().regex(GROUP_CODE_RE, 'a lowercase letter, then lowercase letters, digits and "-" (max 63)');
const attributeCode = z.string().regex(ATTRIBUTE_CODE_RE, 'a lowercase letter, then lowercase letters, digits and "_" (max 63)');
const nonEmpty = z.string().trim().min(1);
/** Money is written as a decimal string ("12900.00"); bare YAML numbers are accepted and normalised. */
export const money = z.union([z.string(), z.number()]).transform((v) => (typeof v === 'number' ? String(v) : v.trim()));
/** Percent with up to two decimals ("15", 12.5, "7.25"). Converted to basis points exactly later. */
export const percent = z.union([z.string(), z.number()]).transform((v) => (typeof v === 'number' ? String(v) : v.trim()));
const localePath = nonEmpty.refine((p) => !p.startsWith('/') && !/^[a-z]+:\/\//i.test(p), 'must be a path relative to the manifest');

const translation = z.strictObject({ name: nonEmpty, description: z.string().optional() });
const translations = z.record(z.string().regex(LOCALE_RE, 'locale like "fi" or "sv-FI"'), translation);
const nameTranslations = z.record(
  z.string().regex(LOCALE_RE, 'locale like "fi" or "sv-FI"'),
  z.union([nonEmpty.transform((name) => ({ name, description: undefined as string | undefined })), translation]),
);

export const STATUSES = ['DRAFT', 'ACTIVE', 'RETIRED'] as const;
export const FLOORS = ['oak', 'concrete', 'tiles', 'stone', 'decking'] as const;
export const WALLS = ['north', 'east', 'south', 'west', 'none'] as const;

export const optionSchema = z.strictObject({
  code,
  name: nonEmpty,
  description: z.string().optional(),
  swatch: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'hex colour like "#a0522d"').transform((s) => s.toLowerCase()).optional(),
  default: z.boolean().default(false),
  translations: nameTranslations.optional(),
});

export const optionGroupSchema = z.strictObject({
  name: nonEmpty,
  selection: z.enum(['SINGLE', 'MULTI']),
  required: z.boolean().default(false),
  sort: z.number().int().min(0).max(32767).optional(),
  /** Group translations carry a name only: `{ fi: Puulaji }`. */
  translations: z.record(z.string().regex(LOCALE_RE, 'locale like "fi" or "sv-FI"'), nonEmpty)
    .transform((t) => Object.fromEntries(Object.entries(t).map(([k, name]) => [k, { name }])))
    .optional(),
  options: z.array(optionSchema).min(1, 'an option group needs at least one option'),
});

const requiresRule = z.record(code, code).refine((r) => Object.keys(r).length > 0, 'empty rule');
const excludesRule = z.union([
  z.tuple([code, code]),
  z.record(code, code).refine((r) => Object.keys(r).length === 1, 'write exclusions as [a, b]'),
]).transform((r): [string, string] => (Array.isArray(r) ? r : (Object.entries(r)[0] as [string, string])));

export const assetsSchema = z.strictObject({
  model_high: localePath.optional(),
  model_low: localePath.optional(),
  ar_glb: localePath.optional(),
  ar_usdz: localePath.optional(),
  thumbnail: localePath.optional(),
  gallery: z.array(localePath).max(20).default([]),
});

export const saunaSchema = z.strictObject({
  sku: z.string().regex(SKU_RE, 'upper-case letters, digits and "-" (2-40 characters)'),
  slug: z.string().regex(SLUG_RE, 'lowercase letters, digits and "-"'),
  status: z.enum(STATUSES).default('DRAFT'),
  name: nonEmpty,
  description: z.string().default(''),
  sort: z.number().int().min(0).max(32767).default(0),
  translations: translations.default({}),
  attributes: z.record(attributeCode, z.union([z.number(), z.string(), z.boolean()])).default({}),
  prices: z.record(
    z.string().regex(CURRENCY_RE, 'ISO 4217 code like "EUR"'),
    z.strictObject({ list_price: money, max_discount_pct: percent }),
  ).refine((p) => Object.keys(p).length > 0, 'at least one currency is required'),
  option_groups: z.record(groupCode, optionGroupSchema).default({}),
  option_prices: z.record(z.string().regex(CURRENCY_RE, 'ISO 4217 code like "EUR"'), z.record(code, money)).default({}),
  rules: z.strictObject({
    requires: z.array(requiresRule).default([]),
    excludes: z.array(excludesRule).default([]),
  }).default({ requires: [], excludes: [] }),
  assets: assetsSchema.default({ gallery: [] }),
});

export const saunaFileSchema = z.strictObject({ sauna: saunaSchema });

export const roomSchema = z.strictObject({
  code,
  name: nonEmpty,
  description: z.string().default(''),
  sort: z.number().int().min(0).max(32767).default(0),
  translations: translations.default({}),
  status: z.enum(STATUSES).default('DRAFT'),
  preset: z.strictObject({
    widthMm: z.number().int().min(1000).max(30000),
    depthMm: z.number().int().min(1000).max(30000),
    heightMm: z.number().int().min(2000).max(6000),
    floor: z.enum(FLOORS),
    wallColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'hex colour like "#f4f1ea"').transform((s) => s.toLowerCase()),
    windowWall: z.enum(WALLS).default('none'),
  }),
  assets: z.strictObject({ scene: localePath.optional(), scene_low: localePath.optional(), thumbnail: localePath.optional() }).default({}),
});

export const roomFileSchema = z.strictObject({ room: roomSchema });

export const attributeDefSchema = z.strictObject({
  label: nonEmpty,
  unit: z.string().nullable().optional(),
  type: z.enum(['number', 'text', 'boolean']),
  sort: z.number().int().min(0).max(32767).default(0),
});

export const attributesFileSchema = z.strictObject({ attributes: z.record(attributeCode, attributeDefSchema) });

export type SaunaManifest = z.output<typeof saunaSchema>;
export type RoomManifest = z.output<typeof roomSchema>;
export type AttributeDef = z.output<typeof attributeDefSchema>;
export type OptionManifest = z.output<typeof optionSchema>;
export type OptionGroupManifest = z.output<typeof optionGroupSchema>;
