import { escapeHtml, safeUrl } from './escape.ts';
import { palette } from './color.ts';

/** Reseller branding for a mail. Every value is untrusted and escaped on output. */
export interface MailBrand {
  brandName: string;
  primaryColor?: string;
  /** Storefront or admin origin; the brand name in the header links here. */
  storefrontUrl: string;
  supportEmail?: string;
  legalName?: string;
  legalAddress?: string;
}

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

/** Building blocks of a mail body, rendered both to HTML and plain text. */
export type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; code: string }
  | { kind: 'button'; label: string; url: string }
  | { kind: 'facts'; rows: [label: string, value: string][] }
  | { kind: 'quote'; text: string }
  | { kind: 'note'; text: string };

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

function blockHtml(block: Block, c: ReturnType<typeof palette>): string {
  switch (block.kind) {
    case 'heading':
      return `<h1 style="margin:0 0 20px;font-family:${FONT};font-size:26px;line-height:32px;font-weight:600;letter-spacing:-0.3px;color:${c.ink};">${escapeHtml(block.text)}</h1>`;
    case 'paragraph':
      return `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:24px;color:${c.ink};">${escapeHtml(block.text)}</p>`;
    case 'note':
      return `<p style="margin:0 0 16px;font-family:${FONT};font-size:13px;line-height:20px;color:${c.muted};">${escapeHtml(block.text)}</p>`;
    case 'quote':
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px;"><tr><td style="border-left:2px solid ${c.accent};padding:4px 0 4px 16px;font-family:${FONT};font-size:15px;line-height:22px;color:${c.ink};white-space:pre-line;">${escapeHtml(block.text)}</td></tr></table>`;
    case 'code':
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr><td style="border:1px solid ${c.rule};padding:16px 24px;font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:32px;line-height:36px;letter-spacing:8px;font-weight:600;color:${c.accent};">${escapeHtml(block.code)}</td></tr></table>`;
    case 'button':
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr><td style="background:${c.accent};"><a href="${escapeHtml(safeUrl(block.url))}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;font-weight:600;letter-spacing:0.2px;color:${c.onAccent};text-decoration:none;">${escapeHtml(block.label)}</a></td></tr></table>`;
    case 'facts': {
      const rows = block.rows
        .map(
          ([label, value]) =>
            `<tr><td style="padding:10px 0;border-top:1px solid ${c.rule};font-family:${FONT};font-size:14px;line-height:20px;color:${c.muted};">${escapeHtml(label)}</td><td align="right" style="padding:10px 0;border-top:1px solid ${c.rule};font-family:${FONT};font-size:14px;line-height:20px;font-weight:600;color:${c.ink};">${escapeHtml(value)}</td></tr>`,
        )
        .join('');
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px;border-bottom:1px solid ${c.rule};">${rows}</table>`;
    }
  }
}

function blockText(block: Block): string {
  switch (block.kind) {
    case 'heading':
      return `${block.text}\n${'='.repeat(Math.min(block.text.length, 60))}`;
    case 'paragraph':
    case 'note':
      return block.text;
    case 'quote':
      return block.text
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n');
    case 'code':
      return `    ${block.code}`;
    case 'button':
      return `${block.label}: ${safeUrl(block.url)}`;
    case 'facts':
      return block.rows.map(([l, v]) => `${l}: ${v}`).join('\n');
  }
}

/**
 * Single-colour, table-based layout with inline styles (the only thing mail clients render
 * reliably). Dark text on light paper; the reseller's primary colour is the only hue.
 */
export function renderMail(brand: MailBrand, input: { subject: string; preheader: string; blocks: Block[] }): RenderedMail {
  const c = palette(brand.primaryColor);
  const home = safeUrl(brand.storefrontUrl);
  const footerLines = [brand.legalName, brand.legalAddress].filter((v): v is string => Boolean(v));
  const support = brand.supportEmail
    ? `Questions? Reply to this e-mail or write to <a href="mailto:${escapeHtml(brand.supportEmail)}" style="color:${c.accent};">${escapeHtml(brand.supportEmail)}</a>.`
    : 'Questions? Reply to this e-mail.';

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(input.subject)}</title></head>
<body style="margin:0;padding:0;background:${c.canvas};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(input.preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${c.canvas};"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background:${c.paper};border-top:4px solid ${c.accent};">
<tr><td style="padding:28px 40px 20px;border-bottom:1px solid ${c.rule};"><a href="${escapeHtml(home)}" style="font-family:${FONT};font-size:18px;font-weight:700;letter-spacing:-0.2px;color:${c.accent};text-decoration:none;">${escapeHtml(brand.brandName)}</a></td></tr>
<tr><td style="padding:36px 40px 20px;">
${input.blocks.map((b) => blockHtml(b, c)).join('\n')}
</td></tr>
<tr><td style="padding:20px 40px 32px;border-top:1px solid ${c.rule};font-family:${FONT};font-size:12px;line-height:18px;color:${c.muted};">
<p style="margin:0 0 8px;">${support}</p>
${footerLines.map((l) => `<p style="margin:0;white-space:pre-line;">${escapeHtml(l)}</p>`).join('\n')}
<p style="margin:8px 0 0;"><a href="${escapeHtml(home)}" style="color:${c.muted};">${escapeHtml(home)}</a></p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = [
    brand.brandName,
    '',
    ...input.blocks.flatMap((b) => [blockText(b), '']),
    '--',
    brand.supportEmail ? `Questions? Write to ${brand.supportEmail}.` : 'Questions? Reply to this e-mail.',
    ...footerLines,
    home,
    '',
  ].join('\n');

  return { subject: input.subject, html, text };
}
