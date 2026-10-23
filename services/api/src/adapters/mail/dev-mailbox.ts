import type { MailMessage, Mailer, TxRunner } from '../types.ts';
import { isPlausibleEmail } from './from-address.ts';
import { singleLine } from './escape.ts';

/** Local mailer: stores every mail in `devtools.mailbox`, shown by the dev mailbox UI. */
export class DevMailboxMailer implements Mailer {
  constructor(
    private readonly tx: TxRunner,
    private readonly fromDomain = 'mail.localhost',
  ) {}

  async send(message: MailMessage): Promise<{ messageId: string }> {
    if (!isPlausibleEmail(message.to)) throw new Error('Invalid recipient address');
    const fromName = message.fromName ? singleLine(message.fromName) : null;
    const { rows } = await this.tx((db) =>
      db.query<{ id: string | number }>(
        `INSERT INTO devtools.mailbox (reseller_id, to_address, from_address, from_name, reply_to, subject, html, text)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          message.resellerId ?? null,
          message.to,
          `no-reply@${this.fromDomain}`,
          fromName,
          message.replyTo ?? null,
          singleLine(message.subject),
          message.html,
          message.text,
        ],
      ),
    );
    return { messageId: String(rows[0]?.id) };
  }
}
