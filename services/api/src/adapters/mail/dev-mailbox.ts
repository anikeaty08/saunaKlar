import type { MailMessage, Mailer, TxRunner } from '../types.ts';
import { formatFromAddress, isPlausibleEmail } from './from-address.ts';
import { singleLine } from './escape.ts';

/** Local mailer: stores every mail in `devtools.mailbox`, shown by the dev mailbox UI. */
export class DevMailboxMailer implements Mailer {
  constructor(
    private readonly tx: TxRunner,
    private readonly fromDomain = 'mail.localhost',
  ) {}

  async send(message: MailMessage): Promise<{ messageId: string }> {
    if (!isPlausibleEmail(message.to)) throw new Error('Invalid recipient address');
    const from = formatFromAddress(message.fromName, `no-reply@${this.fromDomain}`);
    const { rows } = await this.tx((db) =>
      db.query<{ id: string | number }>(
        `INSERT INTO devtools.mailbox (reseller_id, to_address, subject, html, text)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [message.resellerId ?? null, message.to, singleLine(message.subject), message.html, withEnvelope(message.text, from, message.replyTo)],
      ),
    );
    return { messageId: String(rows[0]?.id) };
  }
}

/** The mailbox table has no envelope columns; show From/Reply-To on top of the text part. */
const withEnvelope = (text: string, from: string, replyTo?: string): string =>
  `From: ${from}\n${replyTo ? `Reply-To: ${replyTo}\n` : ''}\n${text}`;
