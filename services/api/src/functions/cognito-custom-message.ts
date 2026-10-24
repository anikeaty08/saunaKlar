/**
 * Cognito CustomMessage trigger (both pools): renders the branded verification, reset and
 * staff-invitation mails with the shared mail templates, in the user's locale.
 *
 * Branding comes from `request.clientMetadata`, which the API passes on SignUp,
 * ResendConfirmationCode, ForgotPassword and AdminCreateUser (see adapters/idp/cognito.ts).
 * The customer pool's app client has no secret, so anyone holding the client id can call
 * those APIs with their own metadata: every field is validated, and links may only point
 * at platform hosts (`*.PLATFORM_DOMAIN` or `ADMIN_HOST`). When metadata is missing or
 * fails validation the platform brand is used instead. The function needs no DB access.
 *
 * Cognito requires the message to contain `codeParameter` (and `usernameParameter` for
 * invitations); if a rendered mail ever lacks them, or exceeds Cognito's 20,000-character
 * limit, the event is returned unchanged and Cognito sends its default message.
 */
import { templates, type MailBrand, type RenderedMail } from '../adapters/mail/templates.ts';
import { singleLine } from '../adapters/mail/escape.ts';

export type CustomMessageTriggerSource =
  | 'CustomMessage_SignUp'
  | 'CustomMessage_ResendCode'
  | 'CustomMessage_ForgotPassword'
  | 'CustomMessage_AdminCreateUser'
  | 'CustomMessage_UpdateUserAttribute'
  | 'CustomMessage_VerifyUserAttribute'
  | 'CustomMessage_Authentication';

/** The subset of the Cognito CustomMessage event this trigger reads and writes. */
export interface CognitoCustomMessageEvent {
  version?: string;
  region?: string;
  userPoolId?: string;
  userName?: string;
  callerContext?: { awsSdkVersion?: string; clientId?: string };
  triggerSource: CustomMessageTriggerSource | (string & {});
  request: {
    userAttributes: Record<string, string>;
    codeParameter?: string;
    linkParameter?: string;
    usernameParameter?: string | null;
    clientMetadata?: Record<string, string> | null;
  };
  response: {
    smsMessage?: string | null;
    emailMessage?: string | null;
    emailSubject?: string | null;
  };
}

export interface CustomMessageEnv {
  PLATFORM_DOMAIN?: string;
  ADMIN_HOST?: string;
  MAIL_DEFAULT_FROM_NAME?: string;
}

/** Cognito rejects longer email messages. */
export const MAX_EMAIL_MESSAGE = 20_000;
const MAX_BRAND_NAME = 80;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const EMAIL = /^[^\s@<>"',;:()[\]\\]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

const lower = (v?: string) => (v ?? '').trim().toLowerCase();

/** True when `host` is the platform domain, a tenant subdomain of it, or the admin host. */
function platformHost(host: string, env: CustomMessageEnv): boolean {
  const domain = lower(env.PLATFORM_DOMAIN);
  const admin = lower(env.ADMIN_HOST);
  return (admin !== '' && host === admin) || (domain !== '' && (host === domain || host.endsWith(`.${domain}`)));
}

/** https URL on a platform host, normalised to origin + path (no query, fragment or credentials). */
function trustedUrl(value: string | undefined, env: CustomMessageEnv): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined;
    if (!platformHost(url.hostname.toLowerCase(), env)) return undefined;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return undefined;
  }
}

function platformBrand(env: CustomMessageEnv, invite: boolean): MailBrand {
  const host = invite ? lower(env.ADMIN_HOST) || lower(env.PLATFORM_DOMAIN) : lower(env.PLATFORM_DOMAIN) || lower(env.ADMIN_HOST);
  return {
    brandName: singleLine(env.MAIL_DEFAULT_FROM_NAME).slice(0, MAX_BRAND_NAME) || 'Saunaklar',
    storefrontUrl: host ? `https://${host}` : '#',
  };
}

/**
 * Reseller brand from clientMetadata, or the platform brand when it is absent or its
 * storefrontUrl is not a platform URL. Optional fields that fail validation are dropped.
 */
export function brandFromMetadata(meta: Record<string, string> | null | undefined, env: CustomMessageEnv, invite = false): { brand: MailBrand; branded: boolean } {
  const fallback = { brand: platformBrand(env, invite), branded: false };
  if (!meta) return fallback;
  const storefrontUrl = trustedUrl(meta.storefrontUrl, env);
  const brandName = singleLine(meta.brandName).slice(0, MAX_BRAND_NAME).trim();
  if (!storefrontUrl || !brandName) return fallback;
  const supportEmail = singleLine(meta.supportEmail);
  return {
    branded: true,
    brand: {
      brandName,
      storefrontUrl,
      ...(meta.primaryColor && COLOR.test(meta.primaryColor) ? { primaryColor: meta.primaryColor.toLowerCase() } : {}),
      ...(supportEmail.length <= 254 && EMAIL.test(supportEmail) ? { supportEmail } : {}),
    },
  };
}

function render(event: CognitoCustomMessageEvent, env: CustomMessageEnv): { mail: RenderedMail; required: string[] } | undefined {
  const { request } = event;
  const code = request.codeParameter;
  if (!code) return undefined;
  const attrs = request.userAttributes ?? {};
  const meta = request.clientMetadata ?? undefined;
  const locale = meta?.locale || attrs.locale;
  const firstName = attrs.given_name || null;

  switch (event.triggerSource) {
    case 'CustomMessage_SignUp':
    case 'CustomMessage_ResendCode':
    case 'CustomMessage_UpdateUserAttribute':
    case 'CustomMessage_VerifyUserAttribute': {
      const { brand } = brandFromMetadata(meta, env);
      return { mail: templates.signupCode(brand, { code, firstName }, locale), required: [code] };
    }
    case 'CustomMessage_ForgotPassword': {
      const { brand } = brandFromMetadata(meta, env);
      return { mail: templates.resetCode(brand, { code, firstName }, locale), required: [code] };
    }
    case 'CustomMessage_AdminCreateUser': {
      const username = request.usernameParameter;
      if (!username) return undefined;
      const { brand } = brandFromMetadata(meta, env, true);
      const mail = templates.staffInvite(
        brand,
        { email: username, temporaryPassword: code, adminUrl: brand.storefrontUrl, displayName: attrs.name || null },
        locale,
      );
      return { mail, required: [code, username] };
    }
    default:
      // CustomMessage_Authentication (email MFA/OTP) and future sources keep Cognito's default.
      return undefined;
  }
}

/** Pure core of the trigger: fills `response.emailSubject`/`emailMessage` or leaves the event as is. */
export function handleCustomMessage(event: CognitoCustomMessageEvent, env: CustomMessageEnv = process.env): CognitoCustomMessageEvent {
  let rendered: ReturnType<typeof render>;
  try {
    rendered = render(event, env);
  } catch (err) {
    console.error(JSON.stringify({ msg: 'custom message render failed', triggerSource: event.triggerSource, error: String(err) }));
    return event;
  }
  if (!rendered) return event;
  const { mail, required } = rendered;
  if (!required.every((p) => mail.html.includes(p)) || mail.html.length > MAX_EMAIL_MESSAGE) {
    console.warn(JSON.stringify({ msg: 'custom message rejected, using Cognito default', triggerSource: event.triggerSource, length: mail.html.length }));
    return event;
  }
  event.response = { ...event.response, emailSubject: mail.subject, emailMessage: mail.html };
  return event;
}

export const handler = async (event: CognitoCustomMessageEvent): Promise<CognitoCustomMessageEvent> => handleCustomMessage(event, process.env);
