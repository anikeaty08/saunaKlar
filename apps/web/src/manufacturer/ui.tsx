import { Skeleton } from '../design/components/Skeleton.tsx';

/** Placeholder rows under a table header while its first page loads. */
export function TableSkeletonRows({ rows = 4 }: { rows?: number }) {
  return <Skeleton lines={rows} height="2.6rem" className="mfr-skeleton-rows" />;
}

/** Page placeholder in the shape of a staff page: crumbs, title, two panels. */
export function PageSkeleton() {
  return (
    <div className="mfr-page-skeleton" aria-hidden="true">
      <Skeleton width="20%" height="0.8rem" />
      <Skeleton width="45%" height="3rem" />
      <Skeleton lines={5} height="2.2rem" />
      <Skeleton lines={3} height="2.2rem" />
    </div>
  );
}

/** "12.50" → 1250; empty or malformed input → null. Accepts a comma as the decimal mark and ignores group separators. */
export function parseMajor(input: string): number | null {
  const s = input.trim().replace(/[\s'’]/g, '');
  if (!s) return null;
  const normalised = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(normalised)) return null;
  const [int, frac = ''] = normalised.split('.');
  const minor = Number(int) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(minor) ? minor : null;
}

/** 1250 → "12.50" for an editable field (no grouping, dot decimal). */
export const toMajor = (minor: number) => (minor / 100).toFixed(2);

/** "15" or "12.5" percent → basis points; null when outside 0–100. */
export function parsePercent(input: string): number | null {
  const s = input.trim().replace(',', '.').replace('%', '');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const bps = Math.round(Number(s) * 100);
  return bps >= 0 && bps <= 10_000 ? bps : null;
}

/** Badge tone per catalogue model status (one hue: weight carries the meaning). */
export const MODEL_TONE = { ACTIVE: 'solid', DRAFT: 'outline', RETIRED: 'muted' } as const;
