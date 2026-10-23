/** Same format as the `resellers.slug` CHECK constraint. */
export function assertSlug(slug: string): string {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(slug)) throw new Error('Invalid tenant slug');
  return slug;
}
