#!/usr/bin/env node
/**
 * Lists, per locale, the message keys missing compared to en.ts (the source of truth), keys that
 * en.ts no longer has, and strings whose {placeholders} differ from the English ones.
 * Exit code 1 when anything is missing, extra or mismatched.
 *
 *   npm run i18n:check -w @saunaklar/web            all locales
 *   npm run i18n:check -w @saunaklar/web -- fr rm   only these
 *
 * Needs Node ≥ 22.18 (imports the .ts locale files with built-in type stripping).
 */
const LOCALES = ['de', 'fr', 'it', 'rm'];
const dir = new URL('../src/i18n/locales/', import.meta.url);

/** Leaf paths → string. Arrays are indexed (`home.steps.0.title`); plural objects are leaves' parents. */
function flatten(node, prefix = '', out = new Map()) {
  if (typeof node === 'string') out.set(prefix, node);
  else if (Array.isArray(node)) node.forEach((v, i) => flatten(v, `${prefix}.${i}`, out));
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

const placeholders = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
/** Plural objects: other locales may use other categories (it has `many`), so compare only `other`. */
const isPluralLeaf = path => /\.(zero|one|two|few|many)$/.test(path);

const { en } = await import(new URL('en.ts', dir).href);
const source = flatten(en);
const wanted = process.argv.slice(2).filter(a => !a.startsWith('-'));
let failed = false;

for (const locale of wanted.length ? wanted : LOCALES) {
  let messages;
  try {
    messages = (await import(new URL(`${locale}.ts`, dir).href))[locale];
  } catch (err) {
    console.log(`${locale}: cannot load (${err.message})`);
    failed = true;
    continue;
  }
  const target = flatten(messages);
  const missing = [...source.keys()].filter(k => !target.has(k) && !isPluralLeaf(k));
  const extra = [...target.keys()].filter(k => !source.has(k) && !isPluralLeaf(k));
  const mismatched = [...source.keys()].filter(k => target.has(k) && !isPluralLeaf(k) && placeholders(source.get(k)) !== placeholders(target.get(k)));
  const stub = messages === en || [...source.keys()].every(k => target.get(k) === source.get(k));

  if (!missing.length && !extra.length && !mismatched.length && !stub) {
    console.log(`${locale}: complete (${target.size} strings)`);
    continue;
  }
  failed = true;
  console.log(`${locale}:${stub ? ' still identical to en (stub)' : ''}`);
  if (missing.length) console.log(`  missing (${missing.length}):\n${missing.map(k => `    ${k}`).join('\n')}`);
  if (extra.length) console.log(`  not in en (${extra.length}):\n${extra.map(k => `    ${k}`).join('\n')}`);
  for (const k of mismatched) console.log(`  placeholders differ: ${k}  en {${placeholders(source.get(k))}}  ${locale} {${placeholders(target.get(k))}}`);
}

if (failed) process.exitCode = 1;
