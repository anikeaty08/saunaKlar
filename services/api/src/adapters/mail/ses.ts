import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { MailMessage, Mailer } from '../types.ts';
import { formatFromAddress, isPlausibleEmail } from './from-address.ts';
import { singleLine } from './escape.ts';

export interface SesMailerConfig {
  /** Verified platform domain; From is always `no-reply@<domain>` (never a reseller domain). */
  fromDomain: string;
  configurationSet?: string;
  defaultFromName: string;
  region?: string;
  client?: SESv2Client;
}

export class SesMailer implements Mailer {
  private readonly client: SESv2Client;

  constructor(private readonly config: SesMailerConfig) {
    this.client = config.client ?? new SESv2Client(config.region ? { region: config.region } : {});
  }

  async send(message: MailMessage): Promise<{ messageId: string }> {
    if (!isPlausibleEmail(message.to)) throw new Error('Invalid recipient address');
    const replyTo = message.replyTo && isPlausibleEmail(message.replyTo) ? [message.replyTo] : undefined;
    const out = await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: formatFromAddress(message.fromName ?? this.config.defaultFromName, `no-reply@${this.config.fromDomain}`),
        Destination: { ToAddresses: [message.to] },
        ReplyToAddresses: replyTo,
        ConfigurationSetName: this.config.configurationSet,
        Content: {
          Simple: {
            Subject: { Data: singleLine(message.subject), Charset: 'UTF-8' },
            Body: {
              Html: { Data: message.html, Charset: 'UTF-8' },
              Text: { Data: message.text, Charset: 'UTF-8' },
            },
          },
        },
        // Tags travel with bounce/complaint events so suppressions can be attributed.
        EmailTags: message.resellerId && /^[\w.@-]{1,256}$/.test(message.resellerId) ? [{ Name: 'reseller', Value: message.resellerId }] : undefined,
      }),
    );
    return { messageId: out.MessageId ?? '' };
  }
}
