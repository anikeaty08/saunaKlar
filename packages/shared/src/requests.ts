import { z } from 'zod';
import { currencyCode, isoDateTime, minorUnits, priceSnapshot, uuid } from './common.ts';

export const REQUEST_STATUSES = ['SUBMITTED', 'IN_REVIEW', 'QUOTED', 'ACCEPTED', 'CLOSED', 'REJECTED', 'CANCELLED'] as const;
export const requestStatus = z.enum(REQUEST_STATUSES);
export type RequestStatus = z.infer<typeof requestStatus>;
export const TERMINAL_STATUSES: readonly RequestStatus[] = ['CLOSED', 'REJECTED', 'CANCELLED'];

/** Allowed transitions per actor (design 9.4); the database table is the authority. */
export const STAFF_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  SUBMITTED: ['IN_REVIEW', 'REJECTED', 'CANCELLED'],
  IN_REVIEW: ['QUOTED', 'REJECTED', 'CANCELLED'],
  QUOTED: ['IN_REVIEW', 'REJECTED', 'CANCELLED'],
  ACCEPTED: ['CLOSED', 'CANCELLED'],
  CLOSED: [],
  REJECTED: [],
  CANCELLED: [],
};
export const CUSTOMER_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  SUBMITTED: ['CANCELLED'],
  IN_REVIEW: ['CANCELLED'],
  QUOTED: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: [],
  CLOSED: [],
  REJECTED: [],
  CANCELLED: [],
};

export const quoteSchema = z.object({
  id: uuid,
  amountMinor: minorUnits,
  currency: currencyCode,
  validUntil: isoDateTime,
  note: z.string().nullable(),
  createdAt: isoDateTime,
  supersededAt: isoDateTime.nullable(),
});
export type Quote = z.infer<typeof quoteSchema>;

export const historyEntrySchema = z.object({
  fromStatus: requestStatus.nullable(),
  toStatus: requestStatus,
  actor: z.enum(['CUSTOMER', 'STAFF', 'SYSTEM']),
  actorName: z.string().nullable(),
  note: z.string().nullable(),
  at: isoDateTime,
});

export const requestSchema = z.object({
  id: uuid,
  status: requestStatus,
  message: z.string().nullable(),
  configuration: z.object({ id: uuid, name: z.string(), sauna: z.object({ id: uuid, slug: z.string(), name: z.string() }), selections: z.array(z.object({ optionId: uuid, groupName: z.string(), optionName: z.string(), priceDeltaMinor: minorUnits })) }),
  snapshot: priceSnapshot,
  activeQuote: quoteSchema.nullable(),
  history: z.array(historyEntrySchema),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type RequestDto = z.infer<typeof requestSchema>;

export const requestSummarySchema = z.object({
  id: uuid,
  status: requestStatus,
  saunaName: z.string(),
  configurationName: z.string(),
  finalPriceMinor: minorUnits,
  currency: currencyCode,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type RequestSummary = z.infer<typeof requestSummarySchema>;

/** Staff view adds the customer, internal notes and quote history. */
export const adminRequestSchema = requestSchema.extend({
  customer: z.object({ id: uuid, email: z.string(), firstName: z.string(), lastName: z.string(), phone: z.string().nullable() }),
  notes: z.array(z.object({ id: uuid, body: z.string(), authorName: z.string(), createdAt: isoDateTime })),
  quotes: z.array(quoteSchema),
  allowedTransitions: z.array(requestStatus),
});
export type AdminRequestDto = z.infer<typeof adminRequestSchema>;

export const adminRequestSummarySchema = requestSummarySchema.extend({
  customerName: z.string(),
  customerEmail: z.string(),
});

export const adminRequestListQuery = z.object({
  status: requestStatus.optional(),
  q: z.string().trim().max(200).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const transitionRequest = z.object({ toStatus: requestStatus, note: z.string().trim().max(2000).optional() });
/**
 * POST /api/me/requests/:id/accept. `quoteId` is the quote the customer saw; when it is no
 * longer the active one (staff re-quoted meanwhile) the API answers 409. The body is optional.
 */
export const acceptRequestBody = z.object({ quoteId: uuid.optional() }).optional();
export const noteRequest = z.object({ body: z.string().trim().min(1).max(4000) });
export const quoteRequest = z.object({
  amountMinor: minorUnits,
  validUntil: isoDateTime,
  note: z.string().trim().max(2000).optional(),
});
