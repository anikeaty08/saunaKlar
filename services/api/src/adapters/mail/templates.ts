import { renderMail, type Block, type MailBrand, type RenderedMail } from './layout.ts';
import { singleLine } from './escape.ts';
import { INTL_LOCALE, MAIL_STRINGS, REQUEST_STATUSES, resolveMailLocale, type MailLocale, type MailStrings, type RequestStatusCode } from './i18n.ts';

export type { MailBrand, RenderedMail } from './layout.ts';
export { MAIL_LOCALES, resolveMailLocale, type MailLocale } from './i18n.ts';

/** Formats integer minor units with the currency's own fraction digits, Swiss conventions. */
export function formatMoney(amountMinor: number | bigint, currency: string, locale?: string | null): string {
  const fmt = new Intl.NumberFormat(INTL_LOCALE[resolveMailLocale(locale)], { style: 'currency', currency });
  const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
  return fmt.format(Number(amountMinor) / 10 ** digits);
}

export function formatDate(value: Date | string, locale?: string | null): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[resolveMailLocale(locale)], { dateStyle: 'long', timeZone: 'Europe/Zurich' }).format(new Date(value));
}

/** Localised label of a request status code; unknown values are shown as given. */
export function statusLabel(status: string, locale?: string | null): string {
  return (REQUEST_STATUSES as readonly string[]).includes(status)
    ? MAIL_STRINGS[resolveMailLocale(locale)].status[status as RequestStatusCode]
    : status;
}

export interface Money {
  amountMinor: number;
  currency: string;
}

type Ctx = { t: MailStrings; locale: MailLocale };

function build(
  brand: MailBrand,
  locale: string | null | undefined,
  compose: (ctx: Ctx) => { subject: string; preheader: string; blocks: Block[] },
): RenderedMail {
  const resolved = resolveMailLocale(locale);
  const out = compose({ t: MAIL_STRINGS[resolved], locale: resolved });
  return renderMail(brand, { locale: resolved, subject: singleLine(out.subject), preheader: singleLine(out.preheader), blocks: out.blocks });
}

const greet = (t: MailStrings, firstName?: string | null): Block => ({ kind: 'paragraph', text: t.greeting(firstName) });
const optionalQuote = (text?: string | null): Block[] => (text ? [{ kind: 'quote', text }] : []);

/**
 * Every template: `(brand, data, locale?)` → `{subject, html, text}`. `locale` is one of
 * en/de/fr/it/rm (region suffixes accepted); anything else falls back to English.
 */
export const templates = {
  signupCode(brand: MailBrand, data: { code: string; firstName?: string | null }, locale?: string | null): RenderedMail {
    return build(brand, locale, ({ t }) => ({
      subject: t.signupCode.subject(brand.brandName),
      preheader: t.signupCode.preheader(data.code),
      blocks: [
        { kind: 'heading', text: t.signupCode.heading },
        greet(t, data.firstName),
        { kind: 'paragraph', text: t.signupCode.body(brand.brandName) },
        { kind: 'code', code: data.code },
        { kind: 'note', text: t.signupCode.note },
      ],
    }));
  },

  resetCode(brand: MailBrand, data: { code: string; firstName?: string | null }, locale?: string | null): RenderedMail {
    return build(brand, locale, ({ t }) => ({
      subject: t.resetCode.subject(brand.brandName),
      preheader: t.resetCode.preheader(data.code),
      blocks: [
        { kind: 'heading', text: t.resetCode.heading },
        greet(t, data.firstName),
        { kind: 'paragraph', text: t.resetCode.body },
        { kind: 'code', code: data.code },
        { kind: 'note', text: t.resetCode.note },
      ],
    }));
  },

  staffInvite(
    brand: MailBrand,
    data: { email: string; temporaryPassword: string; adminUrl: string; displayName?: string | null },
    locale?: string | null,
  ): RenderedMail {
    return build(brand, locale, ({ t }) => ({
      subject: t.staffInvite.subject(brand.brandName),
      preheader: t.staffInvite.preheader,
      blocks: [
        { kind: 'heading', text: t.staffInvite.heading(brand.brandName) },
        greet(t, data.displayName),
        { kind: 'paragraph', text: t.staffInvite.body },
        { kind: 'facts', rows: [[t.labels.email, data.email]] },
        { kind: 'code', code: data.temporaryPassword },
        { kind: 'button', label: t.staffInvite.signIn, url: data.adminUrl },
        { kind: 'paragraph', text: t.staffInvite.mfa },
        { kind: 'note', text: t.staffInvite.note },
      ],
    }));
  },

  requestSubmittedCustomer(
    brand: MailBrand,
    data: { firstName?: string | null; reference: string; saunaName: string; price: Money; requestUrl: string },
    locale?: string | null,
  ): RenderedMail {
    return build(brand, locale, ({ t, locale: l }) => ({
      subject: t.requestSubmittedCustomer.subject(data.reference),
      preheader: t.requestSubmittedCustomer.preheader(data.saunaName),
      blocks: [
        { kind: 'heading', text: t.requestSubmittedCustomer.heading },
        greet(t, data.firstName),
        { kind: 'paragraph', text: t.requestSubmittedCustomer.body(data.saunaName) },
        {
          kind: 'facts',
          rows: [
            [t.labels.reference, data.reference],
            [t.labels.sauna, data.saunaName],
            [t.labels.configuredPrice, formatMoney(data.price.amountMinor, data.price.currency, l)],
          ],
        },
        { kind: 'button', label: t.requestSubmittedCustomer.view, url: data.requestUrl },
      ],
    }));
  },

  requestSubmittedStaff(
    brand: MailBrand,
    data: { reference: string; customerName: string; saunaName: string; price: Money; message?: string | null; adminUrl: string },
    locale?: string | null,
  ): RenderedMail {
    return build(brand, locale, ({ t, locale: l }) => ({
      subject: t.requestSubmittedStaff.subject(data.reference, data.saunaName),
      preheader: t.requestSubmittedStaff.preheader(data.customerName),
      blocks: [
        { kind: 'heading', text: t.requestSubmittedStaff.heading },
        { kind: 'paragraph', text: t.requestSubmittedStaff.body(data.customerName, data.saunaName) },
        {
          kind: 'facts',
          rows: [
            [t.labels.reference, data.reference],
            [t.labels.sauna, data.saunaName],
            [t.labels.configuredPrice, formatMoney(data.price.amountMinor, data.price.currency, l)],
          ],
        },
        ...optionalQuote(data.message),
        { kind: 'button', label: t.requestSubmittedStaff.open, url: data.adminUrl },
      ],
    }));
  },

  requestStatusChanged(
    brand: MailBrand,
    /** `status` is a request status code (SUBMITTED, IN_REVIEW, …), localised here. */
    data: { firstName?: string | null; reference: string; status: string; note?: string | null; requestUrl: string },
    locale?: string | null,
  ): RenderedMail {
    return build(brand, locale, ({ t, locale: l }) => {
      const label = statusLabel(data.status, l);
      return {
        subject: t.requestStatusChanged.subject(data.reference, label),
        preheader: t.requestStatusChanged.preheader(label),
        blocks: [
          { kind: 'heading', text: t.requestStatusChanged.heading(label) },
          greet(t, data.firstName),
          { kind: 'paragraph', text: t.requestStatusChanged.body(data.reference, label) },
          ...optionalQuote(data.note),
          { kind: 'button', label: t.requestStatusChanged.view, url: data.requestUrl },
        ],
      };
    });
  },

  quoteAdded(
    brand: MailBrand,
    data: { firstName?: string | null; reference: string; amount: Money; validUntil: Date | string; note?: string | null; requestUrl: string },
    locale?: string | null,
  ): RenderedMail {
    return build(brand, locale, ({ t, locale: l }) => {
      const amount = formatMoney(data.amount.amountMinor, data.amount.currency, l);
      const until = formatDate(data.validUntil, l);
      return {
        subject: t.quoteAdded.subject(data.reference, amount),
        preheader: t.quoteAdded.preheader(until),
        blocks: [
          { kind: 'heading', text: t.quoteAdded.heading },
          greet(t, data.firstName),
          { kind: 'paragraph', text: t.quoteAdded.body(data.reference) },
          {
            kind: 'facts',
            rows: [
              [t.labels.quotedPrice, amount],
              [t.labels.validUntil, until],
            ],
          },
          ...optionalQuote(data.note),
          { kind: 'button', label: t.quoteAdded.cta, url: data.requestUrl },
        ],
      };
    });
  },

  shareLinkCreated(
    brand: MailBrand,
    data: { firstName?: string | null; saunaName: string; shareUrl: string; expiresAt: Date | string },
    locale?: string | null,
  ): RenderedMail {
    return build(brand, locale, ({ t, locale: l }) => {
      const until = formatDate(data.expiresAt, l);
      return {
        subject: t.shareLinkCreated.subject(data.saunaName),
        preheader: t.shareLinkCreated.preheader(until),
        blocks: [
          { kind: 'heading', text: t.shareLinkCreated.heading },
          greet(t, data.firstName),
          { kind: 'paragraph', text: t.shareLinkCreated.body(brand.brandName, data.saunaName) },
          { kind: 'button', label: t.shareLinkCreated.open, url: data.shareUrl },
          { kind: 'note', text: t.shareLinkCreated.note(until) },
        ],
      };
    });
  },

  /** Sent instead of a code when someone signs up with an existing e-mail (anti-enumeration). */
  accountExists(brand: MailBrand, data: { firstName?: string | null; loginUrl: string; resetUrl: string }, locale?: string | null): RenderedMail {
    return build(brand, locale, ({ t }) => ({
      subject: t.accountExists.subject(brand.brandName),
      preheader: t.accountExists.preheader,
      blocks: [
        { kind: 'heading', text: t.accountExists.heading },
        greet(t, data.firstName),
        { kind: 'paragraph', text: t.accountExists.body(brand.brandName) },
        { kind: 'button', label: t.accountExists.signIn, url: data.loginUrl },
        { kind: 'link', text: t.accountExists.forgot, label: t.accountExists.reset, url: data.resetUrl },
        { kind: 'note', text: t.accountExists.note },
      ],
    }));
  },

  accountDeleted(brand: MailBrand, data: { firstName?: string | null }, locale?: string | null): RenderedMail {
    return build(brand, locale, ({ t }) => ({
      subject: t.accountDeleted.subject(brand.brandName),
      preheader: t.accountDeleted.preheader,
      blocks: [
        { kind: 'heading', text: t.accountDeleted.heading },
        greet(t, data.firstName),
        { kind: 'paragraph', text: t.accountDeleted.body },
        { kind: 'note', text: t.accountDeleted.note },
      ],
    }));
  },
};

export type TemplateName = keyof typeof templates;
