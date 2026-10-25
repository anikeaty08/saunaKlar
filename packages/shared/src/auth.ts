import { z } from 'zod';
import { email, locale, password, uuid } from './common.ts';

export const signupRequest = z.object({
  email,
  password,
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(40).optional(),
  locale: locale.default('en'),
  consents: z.object({
    terms: z.literal(true, 'You must accept the terms.'),
    privacy: z.literal(true, 'You must accept the privacy notice.'),
    marketing: z.boolean().default(false),
  }),
});
export type SignupRequest = z.infer<typeof signupRequest>;

export const confirmRequest = z.object({ email, code: z.string().trim().regex(/^\d{6}$/, 'A 6-digit code.') });
export const emailOnlyRequest = z.object({ email });
export const loginRequest = z.object({ email, password: z.string().min(1).max(256) });
export const resetPasswordRequest = z.object({ email, code: z.string().trim().regex(/^\d{6}$/), newPassword: password });

/** Generic answer for sign-up, resend and forgot-password: never reveals whether an account exists. */
export const acceptedResponse = z.object({ accepted: z.literal(true) });

export const staffScope = z.enum(['RESELLER', 'MANUFACTURER']);

export const sessionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('anonymous'), csrfToken: z.string() }),
  z.object({
    kind: z.literal('customer'),
    csrfToken: z.string(),
    customer: z.object({ id: uuid, email: z.string(), firstName: z.string(), lastName: z.string(), locale: z.string() }),
  }),
  z.object({
    kind: z.literal('staff'),
    csrfToken: z.string(),
    staff: z.object({
      id: uuid,
      email: z.string(),
      displayName: z.string(),
      scope: staffScope,
      role: z.enum(['OWNER', 'ADMIN', 'MANUFACTURER_ADMIN']),
    }),
  }),
]);
export type Session = z.infer<typeof sessionSchema>;

/** Staff sign-in follows Cognito's challenge model: password, then TOTP (or its setup). */
export const staffLoginRequest = z.object({ email, password: z.string().min(1).max(256) });
export const staffChallengeResponse = z.discriminatedUnion('status', [
  z.object({ status: z.literal('OK') }),
  z.object({ status: z.literal('MFA_REQUIRED'), challengeId: z.string() }),
  z.object({ status: z.literal('MFA_SETUP'), challengeId: z.string(), secret: z.string(), otpauthUri: z.string() }),
  z.object({ status: z.literal('NEW_PASSWORD_REQUIRED'), challengeId: z.string() }),
]);
export type StaffChallengeResponse = z.infer<typeof staffChallengeResponse>;
export const staffMfaRequest = z.object({ challengeId: z.string().max(200), code: z.string().trim().regex(/^\d{6}$/) });
export const staffNewPasswordRequest = z.object({ challengeId: z.string().max(200), newPassword: password });
