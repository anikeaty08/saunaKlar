import type { Pool } from 'pg';
import { roleTx } from '../adapters/index.ts';
import { escapeHtml } from '../adapters/mail/escape.ts';

interface MailRow {
  id: string;
  to_address: string;
  subject: string;
  html: string | null;
  text: string | null;
  created_at: Date;
}

const page = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; --ink:#1a1a1a; --paper:#fafaf8; --rule:#e2e2de; --muted:#6b6b66; }
  @media (prefers-color-scheme: dark) { :root { --ink:#ecece8; --paper:#151515; --rule:#2c2c2a; --muted:#9a9a94; } }
  body { margin:0; padding:24px 16px; background:var(--paper); color:var(--ink); font:15px/1.5 system-ui,sans-serif; }
  main { max-width:960px; margin:0 auto; }
  h1 { font-weight:600; letter-spacing:-.01em; }
  table { width:100%; border-collapse:collapse; }
  td, th { text-align:left; padding:10px 8px; border-top:1px solid var(--rule); vertical-align:top; }
  th, .muted { color:var(--muted); font-weight:400; font-size:13px; }
  a { color:inherit; }
  iframe { width:100%; height:70vh; border:1px solid var(--rule); background:#fff; }
  pre { white-space:pre-wrap; border-top:1px solid var(--rule); padding-top:16px; }
</style></head><body><main>${body}</main></body></html>`;

/** Lists the local dev mailbox (newest first). Development only. */
export async function renderMailList(pool: Pool, to?: string | null): Promise<string> {
  const rows = await roleTx(pool, 'idp_local')(async db =>
    (await db.query<MailRow & Record<string, unknown>>(
      `SELECT id::text, to_address, subject, created_at, NULL::text AS html, NULL::text AS text
         FROM devtools.mailbox
        WHERE $1::text IS NULL OR lower(to_address) = lower($1)
        ORDER BY id DESC LIMIT 100`,
      [to ?? null],
    )).rows,
  );
  const items = rows
    .map(
      r => `<tr><td class="muted">${escapeHtml(r.id)}</td><td>${escapeHtml(new Date(r.created_at).toISOString().replace('T', ' ').slice(0, 19))}</td>
<td><a href="/dev/mail?to=${encodeURIComponent(r.to_address)}">${escapeHtml(r.to_address)}</a></td>
<td><a href="/dev/mail/${encodeURIComponent(r.id)}">${escapeHtml(r.subject)}</a></td></tr>`,
    )
    .join('');
  const filter = to ? `<p class="muted">Filtered by ${escapeHtml(to)} · <a href="/dev/mail">show all</a></p>` : '';
  return page(
    'Dev mailbox',
    `<h1>Dev mailbox</h1>${filter}${rows.length ? `<table><thead><tr><th>#</th><th>Sent (UTC)</th><th>To</th><th>Subject</th></tr></thead><tbody>${items}</tbody></table>` : '<p class="muted">No mail yet.</p>'}`,
  );
}

/** One mail: its HTML in a sandboxed frame (no scripts, no same-origin) and the text part. */
export async function renderMail(pool: Pool, id: string): Promise<string | null> {
  if (!/^\d{1,18}$/.test(id)) return null;
  const row = await roleTx(pool, 'idp_local')(async db =>
    (await db.query<MailRow & Record<string, unknown>>('SELECT id::text, to_address, subject, html, text, created_at FROM devtools.mailbox WHERE id = $1', [id])).rows[0],
  );
  if (!row) return null;
  const frame = row.html ? `<iframe sandbox title="HTML part" srcdoc="${escapeHtml(row.html)}"></iframe>` : '';
  return page(
    row.subject,
    `<p><a href="/dev/mail">← All mail</a></p><h1>${escapeHtml(row.subject)}</h1>
<p class="muted">To ${escapeHtml(row.to_address)} · ${escapeHtml(new Date(row.created_at).toISOString())}</p>${frame}<pre>${escapeHtml(row.text ?? '')}</pre>`,
  );
}
