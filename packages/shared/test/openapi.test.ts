import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildOpenApi, renderOpenApi } from '../scripts/openapi.ts';
import { ERROR_STATUS } from '../src/errors.ts';
import { routes } from '../src/routes.ts';

type Op = { operationId: string; parameters?: { name?: string; in?: string; $ref?: string }[]; requestBody?: unknown; responses: Record<string, unknown>; 'x-host': string };
const doc = buildOpenApi() as { openapi: string; paths: Record<string, Record<string, Op>>; components: { responses: Record<string, unknown> } };

describe('OpenAPI document', () => {
  it('contains every route of the route table exactly once', () => {
    const ops = Object.values(doc.paths).flatMap((p) => Object.values(p));
    expect(ops.map((o) => o.operationId).sort()).toEqual(Object.keys(routes).sort());
    for (const [name, r] of Object.entries(routes)) {
      const op = doc.paths[r.path.replace(/:([A-Za-z]+)/g, '{$1}')]?.[r.method.toLowerCase()];
      expect(op?.operationId, name).toBe(name);
      expect(op!.responses[String('status' in r ? r.status : 200)], name).toBeDefined();
      for (const p of r.path.match(/:([A-Za-z]+)/g) ?? []) {
        expect(op!.parameters?.some((x) => x.in === 'path' && x.name === p.slice(1)), `${name} ${p}`).toBe(true);
      }
      expect(!!op!.requestBody, name).toBe('body' in r);
      const csrf = op!.parameters?.some((x) => x.$ref === '#/components/parameters/CsrfToken') ?? false;
      expect(csrf, name).toBe(r.method !== 'GET');
      expect(op!['x-host'], name).toBe(r.host === 'manufacturer' ? 'ADMIN_HOST' : r.host === 'storefront' ? '{slug}.{platformDomain}' : 'any');
    }
  });

  it('describes every error status as problem+json', () => {
    for (const status of new Set(Object.values(ERROR_STATUS))) expect(doc.components.responses[`Problem${status}`]).toBeDefined();
  });

  it('has only resolvable local references', () => {
    const text = JSON.stringify(doc);
    for (const m of text.matchAll(/"\$ref":"#\/([^"]+)"/g)) {
      const target = m[1]!.split('/').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], doc);
      expect(target, m[1]).toBeDefined();
    }
  });

  it('is deterministic and docs/openapi.json is up to date', () => {
    expect(renderOpenApi()).toBe(renderOpenApi());
    const committed = readFileSync(new URL('../../../docs/openapi.json', import.meta.url), 'utf8');
    expect(committed, 'docs/openapi.json is stale: run `npm run openapi`').toBe(renderOpenApi());
  });
});
