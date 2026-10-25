import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '../../src/lib/log.ts';
import { handleWorkerEvent, scheduledJob, type WorkerDeps } from '../../src/worker/handler.ts';
import { errorKind, safeErrorMessage } from '../../src/worker/sanitize.ts';

/** A pg pool double that records statements and fails INSERTs on demand. */
function fakePool(opts: { failInsert?: boolean } = {}) {
  const statements: string[] = [];
  const client = {
    query: vi.fn(async (text: string) => {
      statements.push(text);
      if (opts.failInsert && text.includes('INSERT INTO email_suppressions')) throw new Error('db down');
      return { rows: [], rowCount: 1 };
    }),
    release: vi.fn(),
  };
  return { pool: { connect: async () => client } as unknown as Pool, statements };
}

function deps(pool: Pool, extra: Partial<WorkerDeps> = {}): WorkerDeps {
  return {
    pool,
    log: silentLogger,
    mailer: { send: vi.fn(async () => ({ messageId: 'x' })) },
    edge: { put: vi.fn(async () => {}), delete: vi.fn(async () => {}) },
    links: slug => `https://${slug}.example.com`,
    ...extra,
  };
}

const bounce = JSON.stringify({
  Type: 'Notification',
  Message: JSON.stringify({ notificationType: 'Bounce', bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'a@b.c' }] }, mail: {} }),
});

describe('scheduledJob', () => {
  it('maps rule names by suffix', () => {
    const ev = (name: string) => ({ source: 'aws.events' as const, 'detail-type': 'Scheduled Event' as const, resources: [`arn:aws:events:eu-central-1:1:rule/${name}`] });
    expect(scheduledJob(ev('saunaklar-prod-outbox-sweep'))).toBe('outbox-sweep');
    expect(scheduledJob(ev('saunaklar-prod-retention'))).toBe('retention');
    expect(scheduledJob(ev('something-else'))).toBeNull();
  });
});

describe('handleWorkerEvent', () => {
  it('writes SES suppressions and reports failed records only', async () => {
    const ok = fakePool();
    await expect(handleWorkerEvent({ Records: [{ messageId: 'm1', body: bounce }] }, deps(ok.pool))).resolves.toEqual({ batchItemFailures: [] });
    expect(ok.statements.some(s => s.includes('INSERT INTO email_suppressions'))).toBe(true);
    expect(ok.statements).toContain('SET LOCAL ROLE app_worker');

    const bad = fakePool({ failInsert: true });
    await expect(handleWorkerEvent({ Records: [{ messageId: 'm2', body: bounce }] }, deps(bad.pool))).resolves.toEqual({
      batchItemFailures: [{ itemIdentifier: 'm2' }],
    });
  });

  it('runs the migrate hook on a direct invoke', async () => {
    const migrate = vi.fn(async () => {});
    await expect(handleWorkerEvent({ task: 'migrate' }, deps(fakePool().pool, { migrate }))).resolves.toEqual({ ok: true });
    expect(migrate).toHaveBeenCalledOnce();
    await expect(handleWorkerEvent({ task: 'migrate' }, deps(fakePool().pool))).rejects.toThrow(/not configured/);
  });

  it('rejects unknown events and ignores unknown schedules', async () => {
    await expect(handleWorkerEvent({ hello: 1 }, deps(fakePool().pool))).rejects.toThrow();
    await expect(
      handleWorkerEvent({ source: 'aws.events', 'detail-type': 'Scheduled Event', resources: ['arn:x:rule/other'] }, deps(fakePool().pool)),
    ).resolves.toEqual({ ignored: true });
  });
});

describe('sanitize', () => {
  it('masks addresses and caps length', () => {
    const msg = safeErrorMessage(new Error('Email address is not verified: Jane.Doe@Example.com\nline2'));
    expect(msg).toBe('Error: Email address is not verified: [email] line2');
    expect(safeErrorMessage('x'.repeat(2000)).length).toBe(500);
    expect(errorKind(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe('ECONNRESET');
  });
});
