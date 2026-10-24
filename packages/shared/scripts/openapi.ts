/**
 * Builds the OpenAPI 3.1 document for the whole API from the route table (src/routes.ts), so the
 * document cannot drift from what the API mounts and the web client calls.
 *
 *   npm run openapi            → writes docs/openapi.json
 *
 * Request bodies and query strings are described as the client sends them (Zod input types),
 * responses as the server returns them (Zod output types). Errors are RFC 9457 problem+json.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ERROR_STATUS, problemSchema } from '../src/errors.ts';
import { routes, type Access, type RouteDef } from '../src/routes.ts';

type Json = Record<string, unknown>;

const ACCESS_TEXT: Record<Access, string> = {
  public: 'Public. No session needed (a session is used when present).',
  customer: 'Signed-in customer of the tenant resolved from the host (customer session cookie).',
  'reseller-staff': 'Staff user who is an active admin of the tenant resolved from the host (staff session cookie, MFA as configured).',
  'manufacturer-staff': 'Manufacturer staff on ADMIN_HOST (staff session cookie). Never returns customer personal data.',
  'any-session': 'Any signed-in session (customer or staff) on this host.',
};

const HOST_TEXT: Record<RouteDef['host'], string> = {
  storefront: 'Reseller storefront host `{slug}.{platformDomain}`; the tenant is resolved from the subdomain.',
  manufacturer: 'Manufacturer admin host `ADMIN_HOST` only; 404 on storefront hosts.',
  any: 'Any host (storefront or ADMIN_HOST); the session is bound to the host it was created on.',
};

const SERVERS = {
  storefront: { url: 'https://{slug}.{platformDomain}', description: 'Reseller storefront', variables: { slug: { default: 'alpha', description: 'Reseller subdomain' }, platformDomain: { default: 'saunaklar.example', description: 'PLATFORM_DOMAIN' } } },
  manufacturer: { url: 'https://{adminHost}', description: 'Manufacturer admin (ADMIN_HOST)', variables: { adminHost: { default: 'admin.saunaklar.example', description: 'ADMIN_HOST' } } },
};

/** Error statuses grouped from ERROR_STATUS, e.g. { 409: ['CONFLICT', 'SLUG_TAKEN', ...] }. */
function codesByStatus(): Map<number, string[]> {
  const m = new Map<number, string[]>();
  for (const [code, status] of Object.entries(ERROR_STATUS)) m.set(status, [...(m.get(status) ?? []), code]);
  for (const list of m.values()) list.sort();
  return new Map([...m].sort((a, b) => a[0] - b[0]));
}

/** Zod → JSON Schema; nested `$defs` are hoisted into components.schemas with a unique prefix. */
function schemaOf(s: z.ZodType, io: 'input' | 'output', prefix: string, components: Json): Json {
  const js = z.toJSONSchema(s, { io, unrepresentable: 'any', target: 'draft-2020-12' }) as Json;
  delete js.$schema;
  const defs = js.$defs as Record<string, Json> | undefined;
  if (!defs) return js;
  delete js.$defs;
  let text = JSON.stringify(js);
  let defsText = JSON.stringify(defs);
  for (const name of Object.keys(defs)) {
    const from = `"#/$defs/${name}"`;
    const to = `"#/components/schemas/${prefix}_${name}"`;
    text = text.split(from).join(to);
    defsText = defsText.split(from).join(to);
  }
  for (const [name, def] of Object.entries(JSON.parse(defsText) as Record<string, Json>)) components[`${prefix}_${name}`] = def;
  return JSON.parse(text) as Json;
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
const toOpenApiPath = (p: string) => p.replace(/:([A-Za-z]+)/g, '{$1}');
const pathParams = (p: string) => [...p.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]!);

export function buildOpenApi(): Json {
  const schemas: Json = {};
  // Identical request/response schemas (e.g. the admin request DTO returned by five routes) are
  // stored once under components.schemas and referenced.
  const shared = new Map<string, string>();
  const named = (s: z.ZodType, io: 'input' | 'output', componentName: string): Json => {
    const js = schemaOf(s, io, componentName, schemas);
    if (js.type !== 'object') return js;
    const key = JSON.stringify(js);
    let target = shared.get(key);
    if (!target) {
      target = componentName;
      shared.set(key, target);
      schemas[target] = js;
    }
    return { $ref: `#/components/schemas/${target}` };
  };
  const byStatus = codesByStatus();
  const problem = schemaOf(problemSchema, 'output', 'Problem', schemas);
  schemas.Problem = problem;

  const responses: Json = {};
  for (const [status, codes] of byStatus) {
    responses[`Problem${status}`] = {
      description: `Problem details. Possible codes: ${codes.join(', ')}.`,
      content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
    };
  }

  const paths: Record<string, Json> = {};
  for (const [name, route] of Object.entries(routes) as [string, RouteDef][]) {
    const isWrite = route.method !== 'GET';
    const parameters: Json[] = pathParams(route.path).map((p) => ({
      name: p, in: 'path', required: true,
      schema: p === 'id' || p.endsWith('Id') ? { type: 'string', format: 'uuid' } : { type: 'string' },
    }));
    if (route.query) {
      const q = schemaOf(route.query, 'input', `${name}Query`, schemas);
      const required = new Set((q.required as string[] | undefined) ?? []);
      for (const [prop, schema] of Object.entries((q.properties as Record<string, Json> | undefined) ?? {})) {
        parameters.push({ name: prop, in: 'query', required: required.has(prop), schema });
      }
    }
    if (isWrite) parameters.push({ $ref: '#/components/parameters/CsrfToken' });

    const status = route.status ?? 200;
    const opResponses: Json = {
      [String(status)]: status === 204
        ? { description: 'No content' }
        : { description: 'Success', content: { 'application/json': { schema: named(route.response, 'output', `${cap(name)}Response`) } } },
    };
    for (const s of byStatus.keys()) {
      if (route.access === 'public' && (s === 403)) continue;
      if (!isWrite && (s === 413 || s === 415)) continue;
      opResponses[String(s)] = { $ref: `#/components/responses/Problem${s}` };
    }

    const security = route.access === 'public' ? [{}, { session: [] }] : [{ session: [] }];
    const op: Json = {
      operationId: name,
      summary: `${route.method} ${route.path}`,
      description: `${ACCESS_TEXT[route.access]}\n\n${HOST_TEXT[route.host]}${isWrite ? '\n\nRequires the `X-CSRF-Token` header (from GET /api/auth/session).' : ''}`,
      tags: [route.fn],
      'x-host': route.host === 'manufacturer' ? 'ADMIN_HOST' : route.host === 'storefront' ? '{slug}.{platformDomain}' : 'any',
      'x-access': route.access,
      'x-lambda': route.fn,
      servers: route.host === 'any' ? [SERVERS.storefront, SERVERS.manufacturer] : [route.host === 'manufacturer' ? SERVERS.manufacturer : SERVERS.storefront],
      security,
      ...(parameters.length ? { parameters } : {}),
      ...(route.body ? { requestBody: { required: true, content: { 'application/json': { schema: named(route.body, 'input', `${cap(name)}Body`) } } } } : {}),
      responses: opResponses,
    };
    const key = toOpenApiPath(route.path);
    paths[key] ??= {};
    paths[key][route.method.toLowerCase()] = op;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Saunaklar API',
      version: '0.1.0',
      description: 'Multi-tenant sauna configurator API. Generated from packages/shared/src/routes.ts by `npm run openapi`; do not edit by hand. See docs/api.md for sessions, CSRF, hosts, errors, pagination and catalog versioning.',
    },
    servers: [SERVERS.storefront, SERVERS.manufacturer],
    tags: ['public-catalog', 'customer', 'reseller-admin', 'manufacturer-admin', 'asset-signer'].map((t) => ({ name: t, description: `Served by the ${t} function.` })),
    paths,
    components: {
      schemas: Object.fromEntries(Object.entries(schemas).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
      responses,
      parameters: {
        CsrfToken: {
          name: 'X-CSRF-Token', in: 'header', required: true,
          description: 'CSRF token for every non-GET request: the `csrfToken` returned by GET /api/auth/session on the same host.',
          schema: { type: 'string' },
        },
      },
      securitySchemes: {
        session: {
          type: 'apiKey', in: 'cookie', name: '__Host-sk_at',
          description: 'HttpOnly, host-bound session cookie set by the API (BFF). Refreshed via POST /api/auth/refresh with the `__Host-sk_rt` cookie.',
        },
      },
    },
    'x-error-codes': Object.fromEntries(Object.entries(ERROR_STATUS).sort(([a], [b]) => (a < b ? -1 : 1))),
  };
}

export function renderOpenApi(): string {
  return `${JSON.stringify(buildOpenApi(), null, 2)}\n`;
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
  const out = resolve(dirname(self), '../../../docs/openapi.json');
  writeFileSync(out, renderOpenApi());
  console.log(`wrote ${out} (${Object.keys(routes).length} operations)`);
}
