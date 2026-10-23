import { describe, expect, it } from 'vitest';
import { isSesNotification, normaliseAddress, parseSesFeedback, unwrapSnsBody } from '../../src/worker/ses-events.ts';

const mail = { timestamp: '2026-10-01T10:00:00.000Z', messageId: 'm-1', source: 'no-reply@mail.example.com', destination: ['x@example.com'] };

const sns = (message: unknown) =>
  JSON.stringify({
    Type: 'Notification',
    MessageId: 'sns-1',
    TopicArn: 'arn:aws:sns:eu-central-1:123456789012:ses-feedback',
    Message: JSON.stringify(message),
    Timestamp: '2026-10-01T10:00:01.000Z',
  });

describe('parseSesFeedback', () => {
  it('suppresses permanent bounces (identity notification in an SNS envelope)', () => {
    const body = sns({
      notificationType: 'Bounce',
      bounce: {
        bounceType: 'Permanent',
        bounceSubType: 'General',
        bouncedRecipients: [{ emailAddress: 'Gone@Example.com' }, { emailAddress: '"Jo" <gone@example.com>' }, { emailAddress: 'two@example.org' }],
      },
      mail,
    });
    expect(parseSesFeedback(body)).toEqual({
      kind: 'suppress',
      feedbackType: 'Bounce/Permanent',
      suppressions: [
        { email: 'gone@example.com', reason: 'BOUNCE' },
        { email: 'two@example.org', reason: 'BOUNCE' },
      ],
    });
  });

  it('ignores transient and undetermined bounces', () => {
    for (const bounceType of ['Transient', 'Undetermined']) {
      const body = sns({ notificationType: 'Bounce', bounce: { bounceType, bouncedRecipients: [{ emailAddress: 'a@b.c' }] }, mail });
      expect(parseSesFeedback(body)).toEqual({ kind: 'ignore', feedbackType: `Bounce/${bounceType}` });
    }
  });

  it('suppresses complaints from configuration-set event publishing (raw delivery)', () => {
    const body = JSON.stringify({
      eventType: 'Complaint',
      complaint: { complainedRecipients: [{ emailAddress: 'Angry@Example.com' }], complaintFeedbackType: 'abuse' },
      mail,
    });
    expect(parseSesFeedback(body)).toEqual({
      kind: 'suppress',
      feedbackType: 'Complaint',
      suppressions: [{ email: 'angry@example.com', reason: 'COMPLAINT' }],
    });
  });

  it('ignores not-spam complaint retractions and deliveries', () => {
    const notSpam = sns({ notificationType: 'Complaint', complaint: { complaintFeedbackType: 'not-spam', complainedRecipients: [{ emailAddress: 'a@b.c' }] }, mail });
    expect(parseSesFeedback(notSpam).kind).toBe('ignore');
    expect(parseSesFeedback(sns({ notificationType: 'Delivery', delivery: {}, mail }))).toEqual({ kind: 'ignore', feedbackType: 'Delivery' });
  });

  it('recognises non-SES bodies', () => {
    for (const body of ['', 'not json', '[]', JSON.stringify({ type: 'OUTBOX_NUDGE' }), sns({ hello: 1 }), JSON.stringify({ Type: 'Notification', Message: '{bad' })]) {
      expect(parseSesFeedback(body)).toEqual({ kind: 'not_ses' });
      expect(isSesNotification(body)).toBe(false);
    }
  });

  it('drops malformed recipient addresses', () => {
    const body = sns({ notificationType: 'Bounce', bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'nope' }, { emailAddress: 42 }, {}] }, mail });
    expect(parseSesFeedback(body)).toEqual({ kind: 'ignore', feedbackType: 'Bounce/Permanent' });
  });
});

describe('helpers', () => {
  it('unwraps SNS envelopes and raw messages', () => {
    expect(unwrapSnsBody(sns({ a: 1 }))).toEqual({ a: 1 });
    expect(unwrapSnsBody(JSON.stringify({ a: 2 }))).toEqual({ a: 2 });
  });

  it('normalises addresses', () => {
    expect(normaliseAddress(' A@B.C ')).toBe('a@b.c');
    expect(normaliseAddress('Name <X@Y.Z>')).toBe('x@y.z');
    expect(normaliseAddress('x y@z')).toBeNull();
  });
});
