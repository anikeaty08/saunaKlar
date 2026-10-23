// CloudFront Function (viewer-request, cloudfront-js-2.0). Attached to every behaviour.
//
// 1. Resolves the tenant from the Host header only (never from client-supplied data):
//      {slug}.<platform-domain>  → slug must match the DB slug pattern and be ACTIVE in the
//                                  KeyValueStore (written by the worker on create/suspend/rename).
//      <admin-host>              → manufacturer admin (no tenant).
//      anything else             → 404.
//    Unknown or suspended tenants get a 404 straight from the edge (JSON for /api/*).
// 2. Copies the host into `x-tenant-host` (API Gateway needs its own Host, so the API reads the
//    tenant from this header; any client-supplied value is overwritten).
// 3. Rewrites /favicon.ico and /branding/favicon-*.png to the tenant's branding files.
// 4. Rewrites SPA routes (no file extension, outside /api, /assets, /media, /branding) to /index.html.
//    Asset and media URIs are never rewritten (S3 key = URL path without the leading slash).
//
// Placeholders (__PLATFORM_DOMAIN__, __ADMIN_HOST__, __KVS_ID__) are substituted by Terraform.
// Size limit for CloudFront Functions is 10 KB: keep this file small.

import cf from 'cloudfront';

const PLATFORM_DOMAIN = '__PLATFORM_DOMAIN__';
const ADMIN_HOST = '__ADMIN_HOST__';
const SUFFIX = '.' + PLATFORM_DOMAIN;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const BRAND_FAVICON_RE = /^\/branding\/(favicon-[a-z0-9-]+\.png)$/;
const ADMIN_BRAND_DIR = '_platform';

const kvs = cf.kvs('__KVS_ID__');

function notFound(uri) {
  if (uri.startsWith('/api/')) {
    return {
      statusCode: 404,
      statusDescription: 'Not Found',
      headers: {
        'content-type': { value: 'application/problem+json' },
        'cache-control': { value: 'no-store' },
      },
      body: JSON.stringify({
        type: 'about:blank',
        title: 'Unknown storefront',
        status: 404,
        code: 'TENANT_NOT_FOUND',
      }),
    };
  }
  return {
    statusCode: 404,
    statusDescription: 'Not Found',
    headers: {
      'content-type': { value: 'text/html; charset=utf-8' },
      'cache-control': { value: 'no-store' },
    },
    body:
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Not found</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;' +
      'font:16px/1.5 system-ui,sans-serif;background:#f6f5f2;color:#151412}main{max-width:32rem;padding:2rem}' +
      'h1{font-size:2.5rem;font-weight:500;letter-spacing:-.02em;margin:0 0 .5rem}p{margin:0;opacity:.7}</style>' +
      '</head><body><main><h1>Storefront not found</h1>' +
      '<p>This address does not belong to an active store. Please check the link you were given.</p>' +
      '</main></body></html>',
  };
}

function hasExtension(uri) {
  const last = uri.substring(uri.lastIndexOf('/') + 1);
  return last.indexOf('.') !== -1;
}

async function handler(event) {
  const request = event.request;
  const uri = request.uri;
  const host = request.headers.host ? request.headers.host.value.toLowerCase() : '';

  let brandDir;
  if (host === ADMIN_HOST) {
    brandDir = ADMIN_BRAND_DIR;
  } else if (host.endsWith(SUFFIX)) {
    const slug = host.substring(0, host.length - SUFFIX.length);
    if (!SLUG_RE.test(slug)) {
      return notFound(uri);
    }
    let status;
    try {
      status = await kvs.get(slug);
    } catch (e) {
      // Key not found (or KVS error): fail closed.
      return notFound(uri);
    }
    if (status !== 'ACTIVE') {
      return notFound(uri);
    }
    brandDir = slug;
  } else {
    return notFound(uri);
  }

  request.headers['x-tenant-host'] = { value: host };

  if (uri === '/favicon.ico') {
    request.uri = '/branding/' + brandDir + '/favicon.ico';
    return request;
  }

  const fav = uri.match(BRAND_FAVICON_RE);
  if (fav) {
    request.uri = '/branding/' + brandDir + '/' + fav[1];
    return request;
  }

  if (
    !uri.startsWith('/api/') &&
    !uri.startsWith('/assets/') &&
    !uri.startsWith('/media/') &&
    !uri.startsWith('/branding/') &&
    !hasExtension(uri)
  ) {
    request.uri = '/index.html';
  }

  return request;
}
