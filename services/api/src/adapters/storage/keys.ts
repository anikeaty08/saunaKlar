/** Object keys: relative, safe characters, no empty/dot segments (they map onto file paths locally). */
export function assertObjectKey(key: string): string {
  if (
    key.length === 0 ||
    key.length > 512 ||
    !/^[A-Za-z0-9._\-/]+$/.test(key) ||
    key.startsWith('/') ||
    key.endsWith('/') ||
    key.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')
  ) {
    throw new Error('Invalid object key');
  }
  return key;
}
