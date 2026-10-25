import { z } from 'zod';
import * as account from './account.ts';
import * as admin from './admin.ts';
import * as auth from './auth.ts';
import * as catalog from './catalog.ts';
import { ok, page, pageQuery } from './common.ts';
import * as cfg from './configurations.ts';
import * as mfr from './manufacturer.ts';
import * as req from './requests.ts';
import * as share from './sharing.ts';

/**
 * Every API route in one table: the API mounts handlers against it and the
 * web client derives its typed calls from it, so the two cannot drift.
 * `fn` is the Lambda function that serves the route (design 4.2).
 */
export type LambdaFunction = 'public-catalog' | 'customer' | 'reseller-admin' | 'manufacturer-admin' | 'asset-signer';
export type Access = 'public' | 'customer' | 'reseller-staff' | 'manufacturer-staff' | 'any-session';
export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RouteDef {
  method: Method;
  path: string;
  fn: LambdaFunction;
  access: Access;
  host: 'storefront' | 'manufacturer' | 'any';
  query?: z.ZodType;
  body?: z.ZodType;
  response: z.ZodType;
  /** 201 for creations, 202 for accepted async work. */
  status?: 200 | 201 | 202 | 204;
}

const r = <const T extends RouteDef>(d: T) => d;

export const routes = {
  // ---- public storefront ---------------------------------------------
  tenant: r({ method: 'GET', path: '/api/tenant', fn: 'public-catalog', access: 'public', host: 'storefront', response: catalog.tenantSchema }),
  catalog: r({ method: 'GET', path: '/api/catalog', fn: 'public-catalog', access: 'public', host: 'storefront', query: catalog.catalogVersionQuery, response: catalog.catalogSchema }),
  sauna: r({ method: 'GET', path: '/api/catalog/saunas/:slug', fn: 'public-catalog', access: 'public', host: 'storefront', query: catalog.catalogVersionQuery, response: catalog.saunaDetailSchema }),
  rooms: r({ method: 'GET', path: '/api/rooms', fn: 'public-catalog', access: 'public', host: 'storefront', query: catalog.catalogVersionQuery, response: catalog.roomsSchema }),
  shared: r({ method: 'GET', path: '/api/shared/:token', fn: 'public-catalog', access: 'public', host: 'storefront', response: share.sharedConfigurationSchema }),
  assetSession: r({ method: 'POST', path: '/api/assets/session', fn: 'asset-signer', access: 'public', host: 'storefront', body: catalog.assetSessionRequest, response: catalog.assetSessionResponse }),
  assetAr: r({ method: 'POST', path: '/api/assets/ar', fn: 'asset-signer', access: 'public', host: 'storefront', body: catalog.arRequest, response: catalog.arResponse }),

  // ---- session (both hosts) -------------------------------------------
  session: r({ method: 'GET', path: '/api/auth/session', fn: 'customer', access: 'public', host: 'any', response: auth.sessionSchema }),
  logout: r({ method: 'POST', path: '/api/auth/logout', fn: 'customer', access: 'public', host: 'any', response: ok }),
  refresh: r({ method: 'POST', path: '/api/auth/refresh', fn: 'customer', access: 'public', host: 'any', response: auth.sessionSchema }),

  // ---- customer auth ----------------------------------------------------
  signup: r({ method: 'POST', path: '/api/auth/signup', fn: 'customer', access: 'public', host: 'storefront', body: auth.signupRequest, response: auth.acceptedResponse, status: 202 }),
  confirm: r({ method: 'POST', path: '/api/auth/confirm', fn: 'customer', access: 'public', host: 'storefront', body: auth.confirmRequest, response: auth.sessionSchema }),
  resendCode: r({ method: 'POST', path: '/api/auth/resend-code', fn: 'customer', access: 'public', host: 'storefront', body: auth.emailOnlyRequest, response: auth.acceptedResponse, status: 202 }),
  login: r({ method: 'POST', path: '/api/auth/login', fn: 'customer', access: 'public', host: 'storefront', body: auth.loginRequest, response: auth.sessionSchema }),
  forgotPassword: r({ method: 'POST', path: '/api/auth/forgot-password', fn: 'customer', access: 'public', host: 'storefront', body: auth.emailOnlyRequest, response: auth.acceptedResponse, status: 202 }),
  resetPassword: r({ method: 'POST', path: '/api/auth/reset-password', fn: 'customer', access: 'public', host: 'storefront', body: auth.resetPasswordRequest, response: ok }),

  // ---- staff auth (reseller host and manufacturer host) ------------------
  staffLogin: r({ method: 'POST', path: '/api/auth/staff/login', fn: 'reseller-admin', access: 'public', host: 'any', body: auth.staffLoginRequest, response: auth.staffChallengeResponse }),
  staffMfa: r({ method: 'POST', path: '/api/auth/staff/mfa', fn: 'reseller-admin', access: 'public', host: 'any', body: auth.staffMfaRequest, response: auth.staffChallengeResponse }),
  staffNewPassword: r({ method: 'POST', path: '/api/auth/staff/new-password', fn: 'reseller-admin', access: 'public', host: 'any', body: auth.staffNewPasswordRequest, response: auth.staffChallengeResponse }),

  // ---- customer account --------------------------------------------------
  me: r({ method: 'GET', path: '/api/me', fn: 'customer', access: 'customer', host: 'storefront', response: account.profileSchema }),
  patchMe: r({ method: 'PATCH', path: '/api/me', fn: 'customer', access: 'customer', host: 'storefront', body: account.profilePatch, response: account.profileSchema }),
  deleteMe: r({ method: 'DELETE', path: '/api/me', fn: 'customer', access: 'customer', host: 'storefront', body: account.deleteAccountRequest, response: ok }),
  exportMe: r({ method: 'GET', path: '/api/me/export', fn: 'customer', access: 'customer', host: 'storefront', response: z.record(z.string(), z.unknown()) }),
  addresses: r({ method: 'GET', path: '/api/me/addresses', fn: 'customer', access: 'customer', host: 'storefront', response: account.addressesSchema }),
  createAddress: r({ method: 'POST', path: '/api/me/addresses', fn: 'customer', access: 'customer', host: 'storefront', body: account.addressInput, response: account.addressSchema, status: 201 }),
  updateAddress: r({ method: 'PATCH', path: '/api/me/addresses/:id', fn: 'customer', access: 'customer', host: 'storefront', body: account.addressInput.partial(), response: account.addressSchema }),
  deleteAddress: r({ method: 'DELETE', path: '/api/me/addresses/:id', fn: 'customer', access: 'customer', host: 'storefront', response: ok }),
  consents: r({ method: 'GET', path: '/api/me/consents', fn: 'customer', access: 'customer', host: 'storefront', response: account.consentsSchema }),
  putConsents: r({ method: 'PUT', path: '/api/me/consents', fn: 'customer', access: 'customer', host: 'storefront', body: account.consentsPut, response: account.consentsSchema }),

  // ---- customer configurations and requests -------------------------------
  configurations: r({ method: 'GET', path: '/api/configurations', fn: 'customer', access: 'customer', host: 'storefront', query: pageQuery, response: page(cfg.configurationSummarySchema) }),
  createConfiguration: r({ method: 'POST', path: '/api/configurations', fn: 'customer', access: 'customer', host: 'storefront', body: cfg.createConfigurationRequest, response: cfg.configurationSchema, status: 201 }),
  configuration: r({ method: 'GET', path: '/api/configurations/:id', fn: 'customer', access: 'customer', host: 'storefront', response: cfg.configurationSchema }),
  renameConfiguration: r({ method: 'PATCH', path: '/api/configurations/:id', fn: 'customer', access: 'customer', host: 'storefront', body: cfg.renameConfigurationRequest, response: cfg.configurationSchema }),
  deleteConfiguration: r({ method: 'DELETE', path: '/api/configurations/:id', fn: 'customer', access: 'customer', host: 'storefront', response: ok }),
  putSelections: r({ method: 'PUT', path: '/api/configurations/:id/selections', fn: 'customer', access: 'customer', host: 'storefront', body: cfg.putSelectionsRequest, response: cfg.configurationSchema }),
  putPlacement: r({ method: 'PUT', path: '/api/configurations/:id/room', fn: 'customer', access: 'customer', host: 'storefront', body: cfg.putPlacementRequest, response: cfg.configurationSchema }),
  price: r({ method: 'GET', path: '/api/configurations/:id/price', fn: 'customer', access: 'customer', host: 'storefront', response: cfg.configurationSchema.shape.price }),
  clone: r({ method: 'POST', path: '/api/configurations/:id/clone', fn: 'customer', access: 'customer', host: 'storefront', response: cfg.configurationSchema, status: 201 }),
  submitRequest: r({ method: 'POST', path: '/api/configurations/:id/requests', fn: 'customer', access: 'customer', host: 'storefront', body: cfg.submitRequestRequest, response: req.requestSchema, status: 201 }),
  claimShared: r({ method: 'POST', path: '/api/shared/:token/claim', fn: 'customer', access: 'customer', host: 'storefront', response: share.claimResponse, status: 201 }),
  myRequests: r({ method: 'GET', path: '/api/me/requests', fn: 'customer', access: 'customer', host: 'storefront', query: pageQuery, response: page(req.requestSummarySchema) }),
  myRequest: r({ method: 'GET', path: '/api/me/requests/:id', fn: 'customer', access: 'customer', host: 'storefront', response: req.requestSchema }),
  cancelRequest: r({ method: 'POST', path: '/api/me/requests/:id/cancel', fn: 'customer', access: 'customer', host: 'storefront', response: req.requestSchema }),
  acceptRequest: r({ method: 'POST', path: '/api/me/requests/:id/accept', fn: 'customer', access: 'customer', host: 'storefront', body: req.acceptRequestBody, response: req.requestSchema }),

  // ---- reseller admin -----------------------------------------------------
  adminBranding: r({ method: 'GET', path: '/api/admin/branding', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', response: admin.brandingSchema }),
  adminPatchBranding: r({ method: 'PATCH', path: '/api/admin/branding', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', body: admin.brandingPatch, response: admin.brandingSchema }),
  adminCreateUpload: r({ method: 'POST', path: '/api/admin/branding/uploads', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', body: admin.createUploadRequest, response: admin.createUploadResponse, status: 201 }),
  adminCompleteUpload: r({ method: 'POST', path: '/api/admin/branding/uploads/:uploadId/complete', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', response: admin.brandingSchema }),
  adminSettings: r({ method: 'GET', path: '/api/admin/settings', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', response: admin.settingsSchema }),
  adminPatchSettings: r({ method: 'PATCH', path: '/api/admin/settings', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', body: admin.settingsSchema, response: admin.settingsSchema }),
  adminSaunas: r({ method: 'GET', path: '/api/admin/saunas', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', response: admin.adminSaunasSchema }),
  adminPatchSauna: r({ method: 'PATCH', path: '/api/admin/saunas/:id', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', body: admin.adminSaunaPatch, response: admin.adminSaunaSchema }),
  adminSaunaOrder: r({ method: 'PUT', path: '/api/admin/saunas/order', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', body: admin.adminSaunaOrder, response: admin.adminSaunasSchema }),
  adminPutSaunaDiscount: r({ method: 'PUT', path: '/api/admin/saunas/:id/discount', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', body: admin.adminSaunaSchema.shape.discount.unwrap(), response: admin.adminSaunaSchema }),
  adminDeleteSaunaDiscount: r({ method: 'DELETE', path: '/api/admin/saunas/:id/discount', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', response: admin.adminSaunaSchema }),
  adminPutDefaultDiscount: r({ method: 'PUT', path: '/api/admin/discount', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', body: admin.adminSaunaSchema.shape.discount.unwrap(), response: admin.adminSaunasSchema }),
  adminDeleteDefaultDiscount: r({ method: 'DELETE', path: '/api/admin/discount', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', response: admin.adminSaunasSchema }),
  adminConfigurations: r({ method: 'GET', path: '/api/admin/configurations', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', query: pageQuery, response: page(cfg.configurationSummarySchema) }),
  adminCreateConfiguration: r({ method: 'POST', path: '/api/admin/configurations', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', body: cfg.adminCreateConfigurationRequest, response: cfg.configurationSchema, status: 201 }),
  adminConfiguration: r({ method: 'GET', path: '/api/admin/configurations/:id', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', response: cfg.configurationSchema }),
  adminPutSelections: r({ method: 'PUT', path: '/api/admin/configurations/:id/selections', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', body: cfg.putSelectionsRequest, response: cfg.configurationSchema }),
  adminPutPlacement: r({ method: 'PUT', path: '/api/admin/configurations/:id/room', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', body: cfg.putPlacementRequest, response: cfg.configurationSchema }),
  adminShareLinks: r({ method: 'GET', path: '/api/admin/configurations/:id/share-links', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', response: share.shareLinksSchema }),
  adminCreateShareLink: r({ method: 'POST', path: '/api/admin/configurations/:id/share-links', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', body: share.createShareLinkRequest, response: share.createdShareLinkSchema, status: 201 }),
  adminRevokeShareLink: r({ method: 'DELETE', path: '/api/admin/configurations/:id/share-links/:linkId', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', response: share.shareLinkSchema }),
  adminRequests: r({ method: 'GET', path: '/api/admin/requests', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', query: req.adminRequestListQuery, response: page(req.adminRequestSummarySchema) }),
  adminRequest: r({ method: 'GET', path: '/api/admin/requests/:id', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', response: req.adminRequestSchema }),
  adminTransition: r({ method: 'POST', path: '/api/admin/requests/:id/transition', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', body: req.transitionRequest, response: req.adminRequestSchema }),
  adminNote: r({ method: 'POST', path: '/api/admin/requests/:id/notes', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', body: req.noteRequest, response: req.adminRequestSchema, status: 201 }),
  adminQuote: r({ method: 'PUT', path: '/api/admin/requests/:id/quote', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', body: req.quoteRequest, response: req.adminRequestSchema }),
  adminCustomers: r({ method: 'GET', path: '/api/admin/customers', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', query: admin.adminCustomerListQuery, response: page(admin.adminCustomerSummarySchema) }),
  adminCustomer: r({ method: 'GET', path: '/api/admin/customers/:id', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', response: admin.adminCustomerSummarySchema.extend({ phone: z.string().nullable(), addresses: z.array(account.addressSchema), recentConfigurations: z.array(cfg.configurationSummarySchema), recentRequests: z.array(req.requestSummarySchema) }) }),
  adminAnalytics: r({ method: 'GET', path: '/api/admin/analytics', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', query: admin.analyticsQuery, response: admin.analyticsSchema }),

  // ---- manufacturer admin ---------------------------------------------------
  mResellers: r({ method: 'GET', path: '/api/manufacturer/resellers', fn: 'manufacturer-admin', access: 'manufacturer-staff', host: 'manufacturer', response: z.object({ items: z.array(mfr.resellerSummarySchema) }) }),
  mCreateReseller: r({ method: 'POST', path: '/api/manufacturer/resellers', fn: 'manufacturer-admin', access: 'manufacturer-staff', host: 'manufacturer', body: mfr.createResellerRequest, response: mfr.resellerDetailSchema, status: 201 }),
  mReseller: r({ method: 'GET', path: '/api/manufacturer/resellers/:id', fn: 'manufacturer-admin', access: 'manufacturer-staff', host: 'manufacturer', response: mfr.resellerDetailSchema }),
  mPatchReseller: r({ method: 'PATCH', path: '/api/manufacturer/resellers/:id', fn: 'manufacturer-admin', access: 'manufacturer-staff', host: 'manufacturer', body: mfr.resellerPatch, response: mfr.resellerDetailSchema }),
  mInviteAdmin: r({ method: 'POST', path: '/api/manufacturer/resellers/:id/admins', fn: 'manufacturer-admin', access: 'manufacturer-staff', host: 'manufacturer', body: mfr.inviteAdminRequest, response: mfr.resellerDetailSchema, status: 201 }),
  mAssignments: r({ method: 'GET', path: '/api/manufacturer/resellers/:id/saunas', fn: 'manufacturer-admin', access: 'manufacturer-staff', host: 'manufacturer', response: mfr.assignmentsSchema }),
  mAssign: r({ method: 'PUT', path: '/api/manufacturer/resellers/:id/saunas/:saunaId', fn: 'manufacturer-admin', access: 'manufacturer-staff', host: 'manufacturer', response: mfr.assignmentsSchema }),
  mUnassign: r({ method: 'DELETE', path: '/api/manufacturer/resellers/:id/saunas/:saunaId', fn: 'manufacturer-admin', access: 'manufacturer-staff', host: 'manufacturer', response: mfr.assignmentsSchema }),
  mPutRooms: r({ method: 'PUT', path: '/api/manufacturer/resellers/:id/rooms', fn: 'manufacturer-admin', access: 'manufacturer-staff', host: 'manufacturer', body: mfr.putRoomsRequest, response: mfr.resellerDetailSchema }),
  mSaunas: r({ method: 'GET', path: '/api/manufacturer/saunas', fn: 'manufacturer-admin', access: 'manufacturer-staff', host: 'manufacturer', response: z.object({ items: z.array(mfr.manufacturerSaunaSchema) }) }),
  mSauna: r({ method: 'GET', path: '/api/manufacturer/saunas/:id', fn: 'manufacturer-admin', access: 'manufacturer-staff', host: 'manufacturer', response: mfr.manufacturerSaunaDetailSchema }),
  mPutPrice: r({ method: 'PUT', path: '/api/manufacturer/saunas/:id/prices/:currency', fn: 'manufacturer-admin', access: 'manufacturer-staff', host: 'manufacturer', body: mfr.putPriceRequest, response: mfr.manufacturerSaunaDetailSchema }),
  mPutOptionPrice: r({ method: 'PUT', path: '/api/manufacturer/saunas/:id/options/:optionId/prices/:currency', fn: 'manufacturer-admin', access: 'manufacturer-staff', host: 'manufacturer', body: mfr.putOptionPriceRequest, response: mfr.manufacturerSaunaDetailSchema }),
  mAnalytics: r({ method: 'GET', path: '/api/manufacturer/analytics', fn: 'manufacturer-admin', access: 'manufacturer-staff', host: 'manufacturer', query: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), response: mfr.manufacturerAnalyticsSchema }),
  mAudit: r({ method: 'GET', path: '/api/manufacturer/audit', fn: 'manufacturer-admin', access: 'manufacturer-staff', host: 'manufacturer', query: mfr.auditQuery, response: page(mfr.auditEventSchema) }),
} as const satisfies Record<string, RouteDef>;

export type Routes = typeof routes;
export type RouteName = keyof Routes;
export type ResponseOf<N extends RouteName> = z.infer<Routes[N]['response']>;
export type BodyOf<N extends RouteName> = Routes[N] extends { body: infer B extends z.ZodType } ? z.input<B> : never;
export type QueryOf<N extends RouteName> = Routes[N] extends { query: infer Q extends z.ZodType } ? z.input<Q> : never;

/** Fills `:params` in a route path. */
export function buildPath(path: string, params: Record<string, string> = {}): string {
  return path.replace(/:([A-Za-z]+)/g, (_, k: string) => {
    const v = params[k];
    if (v === undefined) throw new Error(`missing path parameter ${k} for ${path}`);
    return encodeURIComponent(v);
  });
}
