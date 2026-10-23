import { renderMail, type Block, type MailBrand, type RenderedMail } from './layout.ts';
import { singleLine } from './escape.ts';

export type { MailBrand, RenderedMail } from './layout.ts';

/** Formats integer minor units with the currency's own fraction digits. */
export function formatMoney(amountMinor: number | bigint, currency: string, locale = 'en'): string {
  const fmt = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
  return fmt.format(Number(amountMinor) / 10 ** digits);
}

export function formatDate(value: Date | string, locale = 'en'): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(value));
}

const greeting = (firstName?: string | null) => (firstName ? `Hello ${firstName},` : 'Hello,');

const mail = (brand: MailBrand, subject: string, preheader: string, blocks: Block[]): RenderedMail =>
  renderMail(brand, { subject: singleLine(subject), preheader: singleLine(preheader), blocks });

export interface Money {
  amountMinor: number;
  currency: string;
}

export const templates = {
  signupCode(brand: MailBrand, data: { code: string; firstName?: string | null }): RenderedMail {
    return mail(brand, `Your ${brand.brandName} verification code`, `Your code is ${data.code}`, [
      { kind: 'heading', text: 'Confirm your e-mail address' },
      { kind: 'paragraph', text: greeting(data.firstName) },
      { kind: 'paragraph', text: `Enter this code to finish creating your ${brand.brandName} account:` },
      { kind: 'code', code: data.code },
      { kind: 'note', text: 'The code is valid for 24 hours. If you did not sign up, you can ignore this e-mail.' },
    ]);
  },

  resetCode(brand: MailBrand, data: { code: string; firstName?: string | null }): RenderedMail {
    return mail(brand, `Reset your ${brand.brandName} password`, `Your reset code is ${data.code}`, [
      { kind: 'heading', text: 'Reset your password' },
      { kind: 'paragraph', text: greeting(data.firstName) },
      { kind: 'paragraph', text: 'Enter this code together with your new password:' },
      { kind: 'code', code: data.code },
      { kind: 'note', text: 'The code is valid for 1 hour. If you did not ask for a reset, ignore this e-mail; your password stays unchanged.' },
    ]);
  },

  staffInvite(
    brand: MailBrand,
    data: { email: string; temporaryPassword: string; adminUrl: string; displayName?: string | null },
  ): RenderedMail {
    return mail(brand, `You have been invited to ${brand.brandName}`, 'Your administrator account is ready', [
      { kind: 'heading', text: `Welcome to ${brand.brandName}` },
      { kind: 'paragraph', text: greeting(data.displayName) },
      { kind: 'paragraph', text: 'An administrator account has been created for you. Sign in with these details:' },
      { kind: 'facts', rows: [['E-mail', data.email]] },
      { kind: 'code', code: data.temporaryPassword },
      { kind: 'button', label: 'Sign in', url: data.adminUrl },
      {
        kind: 'paragraph',
        text: 'You will choose your own password at the first sign-in and then set up two-factor authentication with an authenticator app (for example 1Password, Google Authenticator or Microsoft Authenticator). Two-factor authentication is mandatory for administrators.',
      },
      { kind: 'note', text: 'The temporary password expires after 7 days. Never share it; we will never ask you for it.' },
    ]);
  },

  requestSubmittedCustomer(
    brand: MailBrand,
    data: { firstName?: string | null; reference: string; saunaName: string; price: Money; locale?: string; requestUrl: string },
  ): RenderedMail {
    return mail(brand, `We received your request ${data.reference}`, `${data.saunaName}: request received`, [
      { kind: 'heading', text: 'Thank you for your request' },
      { kind: 'paragraph', text: greeting(data.firstName) },
      { kind: 'paragraph', text: `We have received your request for the configured ${data.saunaName}. Our team will review it and get back to you.` },
      {
        kind: 'facts',
        rows: [
          ['Reference', data.reference],
          ['Sauna', data.saunaName],
          ['Configured price', formatMoney(data.price.amountMinor, data.price.currency, data.locale)],
        ],
      },
      { kind: 'button', label: 'View your request', url: data.requestUrl },
    ]);
  },

  requestSubmittedStaff(
    brand: MailBrand,
    data: { reference: string; customerName: string; saunaName: string; price: Money; message?: string | null; locale?: string; adminUrl: string },
  ): RenderedMail {
    const blocks: Block[] = [
      { kind: 'heading', text: 'New configuration request' },
      { kind: 'paragraph', text: `${data.customerName} has sent a request for a configured ${data.saunaName}.` },
      {
        kind: 'facts',
        rows: [
          ['Reference', data.reference],
          ['Sauna', data.saunaName],
          ['Configured price', formatMoney(data.price.amountMinor, data.price.currency, data.locale)],
        ],
      },
    ];
    if (data.message) blocks.push({ kind: 'quote', text: data.message });
    blocks.push({ kind: 'button', label: 'Open in admin', url: data.adminUrl });
    return mail(brand, `New request ${data.reference}: ${data.saunaName}`, `From ${data.customerName}`, blocks);
  },

  requestStatusChanged(
    brand: MailBrand,
    data: { firstName?: string | null; reference: string; statusLabel: string; note?: string | null; requestUrl: string },
  ): RenderedMail {
    const blocks: Block[] = [
      { kind: 'heading', text: `Your request is now: ${data.statusLabel}` },
      { kind: 'paragraph', text: greeting(data.firstName) },
      { kind: 'paragraph', text: `The status of your request ${data.reference} has changed to “${data.statusLabel}”.` },
    ];
    if (data.note) blocks.push({ kind: 'quote', text: data.note });
    blocks.push({ kind: 'button', label: 'View your request', url: data.requestUrl });
    return mail(brand, `Request ${data.reference}: ${data.statusLabel}`, `New status: ${data.statusLabel}`, blocks);
  },

  quoteAdded(
    brand: MailBrand,
    data: { firstName?: string | null; reference: string; amount: Money; validUntil: Date | string; note?: string | null; locale?: string; requestUrl: string },
  ): RenderedMail {
    const amount = formatMoney(data.amount.amountMinor, data.amount.currency, data.locale);
    const blocks: Block[] = [
      { kind: 'heading', text: 'Your quote is ready' },
      { kind: 'paragraph', text: greeting(data.firstName) },
      { kind: 'paragraph', text: `We have prepared a quote for your request ${data.reference}.` },
      {
        kind: 'facts',
        rows: [
          ['Quoted price', amount],
          ['Valid until', formatDate(data.validUntil, data.locale)],
        ],
      },
    ];
    if (data.note) blocks.push({ kind: 'quote', text: data.note });
    blocks.push({ kind: 'button', label: 'Review and accept', url: data.requestUrl });
    return mail(brand, `Your quote for ${data.reference}: ${amount}`, `Valid until ${formatDate(data.validUntil, data.locale)}`, blocks);
  },

  shareLinkCreated(
    brand: MailBrand,
    data: { firstName?: string | null; saunaName: string; shareUrl: string; expiresAt: Date | string; locale?: string },
  ): RenderedMail {
    return mail(brand, `Your ${data.saunaName} configuration`, `View it until ${formatDate(data.expiresAt, data.locale)}`, [
      { kind: 'heading', text: 'A configuration for you' },
      { kind: 'paragraph', text: greeting(data.firstName) },
      { kind: 'paragraph', text: `${brand.brandName} has prepared a ${data.saunaName} configuration for you. You can view it in 3D and in your room, no account needed.` },
      { kind: 'button', label: 'Open the configuration', url: data.shareUrl },
      { kind: 'note', text: `The link is valid until ${formatDate(data.expiresAt, data.locale)}. Anyone with the link can view it, so only forward it to people you trust.` },
    ]);
  },

  accountExists(brand: MailBrand, data: { firstName?: string | null; loginUrl: string; resetUrl: string }): RenderedMail {
    return mail(brand, `Your ${brand.brandName} account`, 'Someone tried to sign up with your e-mail address', [
      { kind: 'heading', text: 'You already have an account' },
      { kind: 'paragraph', text: greeting(data.firstName) },
      { kind: 'paragraph', text: `Someone, probably you, tried to create a ${brand.brandName} account with this e-mail address. You already have one, so no new account was created.` },
      { kind: 'button', label: 'Sign in', url: data.loginUrl },
      { kind: 'paragraph', text: `Forgot your password? Reset it here: ${data.resetUrl}` },
      { kind: 'note', text: 'If this was not you, you can ignore this e-mail. Your account is unchanged.' },
    ]);
  },

  accountDeleted(brand: MailBrand, data: { firstName?: string | null }): RenderedMail {
    return mail(brand, `Your ${brand.brandName} account has been deleted`, 'Your personal data has been removed', [
      { kind: 'heading', text: 'Your account has been deleted' },
      { kind: 'paragraph', text: greeting(data.firstName) },
      {
        kind: 'paragraph',
        text: 'As requested, we have deleted your account and removed your personal data. Records we must keep for legal reasons (such as submitted requests) are no longer linked to you.',
      },
      { kind: 'note', text: 'If you did not ask for this, contact us right away by replying to this e-mail.' },
    ]);
  },
} satisfies Record<string, (brand: MailBrand, data: never) => RenderedMail>;

export type TemplateName = keyof typeof templates;
