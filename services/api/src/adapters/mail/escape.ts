const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text for HTML element content and quoted attribute values. */
export const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);

/** Only http(s) URLs may become links; anything else (javascript:, data:) renders as `#`. */
export function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '#';
  } catch {
    return '#';
  }
}

/** Strips CR/LF so values cannot inject lines into headers or the subject. */
export const singleLine = (value: unknown): string => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
