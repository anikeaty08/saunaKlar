import type { Queue } from '../types.ts';

export type QueueHandler = (message: unknown) => Promise<void> | void;

/**
 * Local queue: delivers each message to the handler on a later tick (after the sender's
 * transaction has had a chance to commit), like SQS would. Failures go to `onError`.
 */
export class InProcessQueue implements Queue {
  private pending = new Set<Promise<void>>();

  constructor(
    private readonly handler: QueueHandler,
    private readonly onError: (error: unknown) => void = (e) => console.error('[queue] handler failed', e),
  ) {}

  async send(message: unknown, options: { delaySeconds?: number } = {}): Promise<void> {
    // Round-trip through JSON so handlers see what SQS would deliver, not shared references.
    const body: unknown = typeof message === 'string' ? message : JSON.parse(JSON.stringify(message));
    const delay = Math.max(0, options.delaySeconds ?? 0) * 1000;
    const run = new Promise<void>((resolve) => {
      const deliver = () => {
        Promise.resolve()
          .then(() => this.handler(body))
          .catch(this.onError)
          .finally(resolve);
      };
      if (delay > 0) setTimeout(deliver, delay);
      else setImmediate(deliver);
    });
    this.pending.add(run);
    void run.finally(() => this.pending.delete(run));
  }

  /** Resolves when every message sent so far has been handled (tests, graceful shutdown). */
  async drain(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }
}
