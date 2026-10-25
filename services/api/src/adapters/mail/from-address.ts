/**
 * `"Display Name" <local@domain>` with the display name sanitised. Non-ASCII names use an
 * RFC 2047 encoded word, which SES requires for anything outside 7-bit ASCII.
 */
export function formatFromAddress(displayName: string | undefined, address: string): string {
  const name = (displayName ?? '').replace(/[\r\n]+/g, ' ').replace(/["\\<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!name) return address;
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(name)) return `"${name}" <${address}>`;
  return `=?utf-8?B?${Buffer.from(name, 'utf8').toString('base64')}?= <${address}>`;
}

/** Basic shape check used before handing an address to a transport. */
export const isPlausibleEmail = (value: string): boolean =>
  value.length <= 254 && /^[^\s@<>"(),;:\\]+@[^\s@<>"(),;:\\]+\.[^\s@<>"(),;:\\]+$/.test(value);
