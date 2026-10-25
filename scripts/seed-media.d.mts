/** Types for scripts/seed-media.mjs (imported by e2e/global-setup.ts). */
export interface SeedMediaOptions {
  /** Database to read the asset rows from (default $DATABASE_URL, then the dev database). */
  databaseUrl?: string;
  /** Rewrite objects that already exist (default: only when run with --force). */
  force?: boolean;
  /** Object store root (default $LOCAL_OBJECTS_DIR, then <repo>/var/objects). */
  objectsDir?: string;
  /** Bucket folder (default $S3_ASSETS_BUCKET, then assets). */
  bucket?: string;
  /** Progress line sink (default console.log with a [seed-media] prefix). */
  log?: (line: string) => void;
}
export interface SeedMediaCounts {
  written: number;
  kept: number;
  skipped: number;
}
export function seedMedia(options?: SeedMediaOptions): Promise<SeedMediaCounts>;
