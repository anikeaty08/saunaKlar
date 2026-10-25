import type { CSSProperties } from 'react';
import './Skeleton.css';

interface Props {
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
  /** Text lines; the last one is shorter. */
  lines?: number;
  radius?: CSSProperties['borderRadius'];
  className?: string;
  style?: CSSProperties;
}

/** Shimmering placeholder in the page's own shape (never a spinner on a blank page). */
export function Skeleton({ width, height = '1em', lines, radius, className, style }: Props) {
  if (lines && lines > 1) {
    return (
      <span className={['skel-lines', className].filter(Boolean).join(' ')} aria-hidden="true" style={style}>
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className="skel" style={{ width: i === lines - 1 ? '62%' : '100%', height }} />
        ))}
      </span>
    );
  }
  return <span className={['skel', className].filter(Boolean).join(' ')} aria-hidden="true" style={{ width, height, borderRadius: radius, ...style }} />;
}
