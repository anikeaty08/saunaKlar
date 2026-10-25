import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleWorkerEvent } from '../../src/worker/handler.ts';
import { createHarness, type Harness } from './fixtures.ts';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h?.close();
});

const sns = (message: unknown) => JSON.stringify({ Type: 'Notification', Message: JSON.stringify(message) });
const mail = { messageId: 'm', destination: [] };

describe('SES feedback via SQS', () => {
  it('upserts suppressions; complaints upgrade bounces; manual entries stay', async () => {
    await h.owner.query(`INSERT INTO email_suppressions (email_lower, reason) VALUES ('manual@x.test', 'MANUAL')`);
    const records = [
      { messageId: '1', body: sns({ notificationType: 'Bounce', bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'Bounced@X.test' }] }, mail }) },
      { messageId: '2', body: sns({ notificationType: 'Bounce', bounce: { bounceType: 'Transient', bouncedRecipients: [{ emailAddress: 'soft@x.test' }] }, mail }) },
      { messageId: '3', body: sns({ notificationType: 'Complaint', complaint: { complainedRecipients: [{ emailAddress: 'bounced@x.test' }, { emailAddress: 'manual@x.test' }] }, mail }) },
    ];
    const res = await handleWorkerEvent({ Records: records }, h.deps());
    expect(res).toEqual({ batchItemFailures: [] });
    const { rows } = await h.owner.query<{ email_lower: string; reason: string }>('SELECT email_lower, reason FROM email_suppressions ORDER BY 1');
    expect(rows).toEqual([
      { email_lower: 'bounced@x.test', reason: 'COMPLAINT' },
      { email_lower: 'manual@x.test', reason: 'MANUAL' },
    ]);
  });
});
