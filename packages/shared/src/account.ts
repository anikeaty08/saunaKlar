import { z } from 'zod';
import { countryCode, isoDateTime, locale, uuid } from './common.ts';

export const profileSchema = z.object({
  id: uuid,
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string().nullable(),
  locale: z.string(),
  emailVerifiedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});
export type Profile = z.infer<typeof profileSchema>;

export const profilePatch = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  locale: locale.optional(),
});

export const addressType = z.enum(['BILLING', 'SHIPPING', 'SITE']);
export const addressInput = z.object({
  addressType,
  recipient: z.string().trim().min(1).max(200),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).nullable().optional(),
  postalCode: z.string().trim().min(1).max(20),
  city: z.string().trim().min(1).max(100),
  region: z.string().trim().max(100).nullable().optional(),
  countryCode,
  isDefault: z.boolean().default(false),
});
export const addressSchema = addressInput.extend({ id: uuid, line2: z.string().nullable(), region: z.string().nullable() });
export type Address = z.infer<typeof addressSchema>;
export const addressesSchema = z.object({ items: z.array(addressSchema) });

export const consentType = z.enum(['TERMS', 'PRIVACY', 'MARKETING']);
export const consentsSchema = z.object({
  items: z.array(z.object({ type: consentType, version: z.string(), grantedAt: isoDateTime, withdrawnAt: isoDateTime.nullable() })),
});
/** PUT /api/me/consents — only marketing can be withdrawn while the account exists. */
export const consentsPut = z.object({ marketing: z.boolean() });

/** DELETE /api/me needs the password again. */
export const deleteAccountRequest = z.object({ password: z.string().min(1).max(256) });
