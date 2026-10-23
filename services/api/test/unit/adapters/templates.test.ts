import { describe, expect, it } from 'vitest';
import { escapeHtml, safeUrl, singleLine } from '../../../src/adapters/mail/escape.ts';
import { formatFromAddress } from '../../../src/adapters/mail/from-address.ts';
import { MAIL_LOCALES, formatDate, formatMoney, resolveMailLocale, statusLabel, templates } from '../../../src/adapters/mail/templates.ts';
import { MAIL_STRINGS } from '../../../src/adapters/mail/i18n.ts';

const brand = { brandName: 'Alpha Spa', primaryColor: '#2a6f4e', storefrontUrl: 'https://alpha.example.com', supportEmail: 'help@alpha.example.com' };
const evil = '<script>alert("x")</script>&\'';

const samples = {
  signupCode: { code: '123456', firstName: 'Anna' },
  resetCode: { code: '654321' },
  staffInvite: { email: 'staff@example.com', temporaryPassword: 'Temp-Pass-42x', adminUrl: 'https://alpha.example.com/admin' },
  requestSubmittedCustomer: { firstName: 'Anna', reference: 'R-1001', saunaName: 'Nordic 200', price: { amountMinor: 1234550, currency: 'CHF' }, requestUrl: 'https://alpha.example.com/account/requests/1' },
  requestSubmittedStaff: { reference: 'R-1001', customerName: 'Anna Muster', saunaName: 'Nordic 200', price: { amountMinor: 1234550, currency: 'EUR' }, message: 'Please call me.', adminUrl: 'https://alpha.example.com/admin/requests/1' },
  requestStatusChanged: { reference: 'R-1001', status: 'IN_REVIEW', note: 'Looking at it.', requestUrl: 'https://alpha.example.com/account/requests/1' },
  quoteAdded: { reference: 'R-1001', amount: { amountMinor: 999900, currency: 'CHF' }, validUntil: '2026-12-31T12:00:00Z', requestUrl: 'https://alpha.example.com/account/requests/1' },
  shareLinkCreated: { saunaName: 'Nordic 200', shareUrl: 'https://alpha.example.com/s/abc', expiresAt: '2026-11-30T12:00:00Z' },
  accountExists: { firstName: 'Anna', loginUrl: 'https://alpha.example.com/login', resetUrl: 'https://alpha.example.com/forgot' },
  accountDeleted: { firstName: 'Anna' },
} as const;

type Name = keyof typeof templates;
const render = (name: Name, b = brand, locale?: string) =>
  (templates[name] as (b: typeof brand, d: unknown, l?: string) => { subject: string; html: string; text: string })(b, samples[name], locale);

describe('mail templates', () => {
  it('covers every template', () => {
    expect(Object.keys(samples).sort()).toEqual(Object.keys(templates).sort());
  });

  for (const name of Object.keys(templates) as Name[]) {
    it.each(MAIL_LOCALES)(`${name} renders in %s`, (locale) => {
      const mail = render(name, brand, locale);
      expect(mail.subject.length).toBeGreaterThan(5);
      expect(mail.subject).not.toMatch(/[\r\n]/);
      expect(mail.html).toContain('<!doctype html>');
      expect(mail.html).toContain(`lang="${locale}"`);
      expect(mail.html).toContain('Alpha Spa');
      expect(mail.html).not.toContain('undefined');
      expect(mail.text).toContain('Alpha Spa');
      expect(mail.text).not.toContain('<');
      expect(mail.text).not.toContain('undefined');
    });
  }

  it('really translates (subjects differ between locales)', () => {
    for (const name of Object.keys(templates) as Name[]) {
      const subjects = new Set(MAIL_LOCALES.map((l) => render(name, brand, l).subject));
      expect(subjects.size).toBe(MAIL_LOCALES.length);
    }
  });

  it('falls back to English for unknown locales and accepts region suffixes', () => {
    expect(render('resetCode', brand, 'xx').subject).toBe(render('resetCode', brand, 'en').subject);
    expect(render('resetCode', brand, 'de-CH').subject).toBe(render('resetCode', brand, 'de').subject);
    expect(resolveMailLocale(undefined)).toBe('en');
    expect(resolveMailLocale('RM_ch')).toBe('rm');
  });

  it('uses the single brand colour and only shades of it', () => {
    const html = render('signupCode').html;
    const colours = new Set(html.match(/#[0-9a-f]{6}\b/gi)?.map((c) => c.toLowerCase()));
    expect(colours.has('#2a6f4e')).toBe(true);
  });

  it('escapes every interpolated value', () => {
    const hostile = { ...brand, brandName: evil, supportEmail: `x"onmouseover="y@z.ch` };
    for (const name of Object.keys(templates) as Name[]) {
      const data = Object.fromEntries(
        Object.entries(samples[name]).map(([k, v]) => [k, typeof v === 'string' && !/Url$/.test(k) && k !== 'validUntil' && k !== 'expiresAt' ? evil : v]),
      );
      const mail = (templates[name] as (b: unknown, d: unknown) => { html: string; subject: string })(hostile, data);
      expect(mail.html).not.toContain('<script>');
      expect(mail.html).not.toContain('"onmouseover=');
      expect(mail.html).toContain('&lt;script&gt;');
    }
  });

  it('neutralises javascript: links and CSS injection through the colour', () => {
    const mail = templates.accountExists(
      { ...brand, primaryColor: 'red;background:url(x)', storefrontUrl: 'javascript:alert(1)' },
      { loginUrl: 'javascript:alert(1)', resetUrl: 'data:text/html,x' },
    );
    expect(mail.html).not.toContain('javascript:');
    expect(mail.html).not.toContain('data:text');
    expect(mail.html).not.toContain('url(x)');
  });

  it('localises request status labels', () => {
    expect(statusLabel('IN_REVIEW', 'de')).toBe('In Prüfung');
    expect(statusLabel('QUOTED', 'fr')).toBe(MAIL_STRINGS.fr.status.QUOTED);
    expect(statusLabel('SOMETHING', 'it')).toBe('SOMETHING');
    expect(render('requestStatusChanged', brand, 'de').subject).toContain('In Prüfung');
  });
});

describe('formatting', () => {
  it('formats money from minor units with Swiss conventions', () => {
    expect(formatMoney(1234550, 'CHF', 'de')).toMatch(/^CHF\s12’345\.50$/);
    expect(formatMoney(1234550, 'CHF', 'fr')).toMatch(/^12\s345\.50\sCHF$/);
    expect(formatMoney(1234550, 'EUR', 'it')).toMatch(/12’345\.50/);
    expect(formatMoney(1234550, 'CHF', 'rm')).toMatch(/12’345\.50\sCHF/);
    expect(formatMoney(12345, 'JPY', 'en')).toMatch(/12’345$/); // zero-decimal currency: minor = major
  });

  it('formats dates per locale', () => {
    expect(formatDate('2026-03-05T12:00:00Z', 'de')).toBe('5. März 2026');
    expect(formatDate('2026-03-05T12:00:00Z', 'fr')).toBe('5 mars 2026');
    expect(formatDate('2026-03-05T12:00:00Z', 'it')).toBe('5 marzo 2026');
    expect(formatDate('2026-03-05T12:00:00Z', 'rm')).toBe('5 da mars 2026');
  });
});

describe('escaping helpers', () => {
  it('escapes HTML metacharacters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
  it('only allows http(s) URLs', () => {
    expect(safeUrl('https://a.ch/x?y=1')).toBe('https://a.ch/x?y=1');
    expect(safeUrl('javascript:alert(1)')).toBe('#');
    expect(safeUrl('not a url')).toBe('#');
  });
  it('flattens header values', () => {
    expect(singleLine('a\r\nBcc: x@y.ch')).toBe('a Bcc: x@y.ch');
  });
  it('formats From addresses safely', () => {
    expect(formatFromAddress('Alpha "Spa"\r\nBcc:', 'no-reply@mail.example.com')).toBe('"Alpha Spa Bcc:" <no-reply@mail.example.com>');
    expect(formatFromAddress('Zürich Saunas', 'no-reply@m.ch')).toBe(`=?utf-8?B?${Buffer.from('Zürich Saunas').toString('base64')}?= <no-reply@m.ch>`);
    expect(formatFromAddress('', 'no-reply@m.ch')).toBe('no-reply@m.ch');
  });
});
