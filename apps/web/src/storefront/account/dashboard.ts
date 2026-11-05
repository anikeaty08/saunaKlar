import type { RequestStatus } from '@saunaklar/shared';

/** The happy path of a request, as the customer sees it. */
export const TRACKER_STEPS = ['SUBMITTED', 'IN_REVIEW', 'QUOTED', 'ACCEPTED'] as const satisfies readonly RequestStatus[];
export const END_STATES = ['REJECTED', 'CANCELLED', 'CLOSED'] as const satisfies readonly RequestStatus[];

export type StepState = 'done' | 'current' | 'todo';
export interface Tracker {
  steps: { status: (typeof TRACKER_STEPS)[number]; state: StepState }[];
  /** Set when the request ended (declined, cancelled or closed); that end is then the current step. */
  end: (typeof END_STATES)[number] | null;
}

/**
 * Where a request stands. CLOSED follows ACCEPTED, so every step is done. A declined or
 * cancelled request may have stopped at any step and the summary does not say which, so its
 * steps stay open and the end state is what is highlighted.
 */
export function trackerFor(status: RequestStatus): Tracker {
  const end = (END_STATES as readonly RequestStatus[]).includes(status) ? (status as Tracker['end']) : null;
  const at = status === 'CLOSED' ? TRACKER_STEPS.length : TRACKER_STEPS.indexOf(status as (typeof TRACKER_STEPS)[number]);
  return {
    steps: TRACKER_STEPS.map((s, i) => ({ status: s, state: at < 0 ? 'todo' : i < at ? 'done' : i === at ? 'current' : 'todo' })),
    end,
  };
}

interface DraftLike { locked: boolean; updatedAt: string; request: unknown }

/** The configuration to continue: the most recently edited one that is still a draft. */
export function latestDraft<T extends DraftLike>(configs: readonly T[]): T | null {
  return [...configs].filter(c => !c.locked && !c.request).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}

interface RequestLike { id: string; status: RequestStatus; updatedAt: string }

/** The most recently updated request waiting for the customer to accept a quote. */
export function awaitingDecision<T extends RequestLike>(requests: readonly T[]): T | null {
  return [...requests].filter(r => r.status === 'QUOTED').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}

/** Whether a quote can still be accepted at `now`. */
export const quoteIsOpen = (validUntil: string, now: Date): boolean => new Date(validUntil).getTime() > now.getTime();
