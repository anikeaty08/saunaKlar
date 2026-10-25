import { ExternalLink } from 'lucide-react';
import { useT, type TKey } from '../../i18n/i18n.ts';
import { deriveTheme } from '../../design/theme.ts';
import { Icon } from '../../design/components/Icon.tsx';
import { LAYOUT_IDS, LAYOUT_META, type LayoutId } from '../layouts/registry.ts';

/** Schematic of each layout's home page, drawn in that layout's own derived colours. */
function Thumb({ id, color }: { id: LayoutId; color: string }) {
  const theme = deriveTheme(color, LAYOUT_META[id].flavour).light;
  const paper = theme['--paper']!;
  const ink = theme['--ink']!;
  const soft = theme['--ink-5']!;
  const card = theme['--paper-3']!;
  const accent = theme['--accent']!;
  const r = (x: number, y: number, w: number, h: number, fill: string, rx = 1.5) => <rect x={x} y={y} width={w} height={h} rx={rx} fill={fill} />;
  return (
    <svg viewBox="0 0 120 80" className="lpick__thumb" aria-hidden="true">
      <rect width="120" height="80" fill={paper} />
      {id === 'atelier' && (
        <>
          {r(46, 10, 28, 2, soft)}
          {r(30, 16, 60, 6, ink)}
          {r(38, 25, 44, 6, ink)}
          {r(48, 35, 24, 4, ink, 2)}
          {r(10, 45, 100, 18, card, 3)}
          {r(10, 67, 30, 9, card)}
          {r(45, 67, 30, 9, card)}
          {r(80, 67, 30, 9, card)}
        </>
      )}
      {id === 'showroom' && (
        <>
          {r(0, 0, 120, 52, card, 0)}
          <rect width="120" height="52" fill={`url(#sw-${color.slice(1)})`} />
          <defs>
            <linearGradient id={`sw-${color.slice(1)}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0.4" stopColor={paper} stopOpacity="0" />
              <stop offset="1" stopColor={paper} />
            </linearGradient>
          </defs>
          {r(28, 26, 64, 7, ink)}
          {r(40, 36, 40, 4, ink, 2)}
          {r(8, 58, 34, 20, card, 2)}
          {r(46, 58, 34, 20, card, 2)}
          {r(84, 58, 36, 20, card, 2)}
        </>
      )}
      {id === 'nordic' && (
        <>
          {r(6, 8, 52, 44, card, 6)}
          {r(64, 16, 46, 6, ink)}
          {r(64, 25, 36, 6, ink)}
          {r(64, 36, 30, 4, accent, 2)}
          {r(6, 58, 34, 18, card, 6)}
          {r(43, 58, 34, 18, card, 6)}
          {r(80, 58, 34, 18, card, 6)}
        </>
      )}
      {id === 'catalogue' && (
        <>
          {r(8, 6, 60, 5, ink)}
          {r(8, 15, 104, 5, card)}
          {[0, 1, 2, 3].map(c =>
            [0, 1].map(row => <g key={`${c}${row}`}>{r(8 + c * 26.5, 25 + row * 27, 23, 15, card, 1.5)}{r(8 + c * 26.5, 42 + row * 27, 14, 3, ink, 1)}</g>),
          )}
        </>
      )}
      {id === 'journal' && (
        <>
          {r(8, 8, 104, 14, ink, 1)}
          {r(8, 25, 70, 14, ink, 1)}
          {r(8, 46, 50, 28, card, 2)}
          {r(64, 50, 46, 3, soft)}
          {r(64, 56, 40, 3, soft)}
          {r(64, 62, 44, 3, soft)}
        </>
      )}
    </svg>
  );
}

export function LayoutPicker({ value, color, onChange }: { value: LayoutId; color: string; onChange: (id: LayoutId) => void }) {
  const { t } = useT();
  return (
    <div className="lpick" role="radiogroup" aria-label={t('admin.branding.layout')}>
      {LAYOUT_IDS.map(id => (
        <div key={id} className={['lpick__item', id === value && 'is-on'].filter(Boolean).join(' ')}>
          <label className="lpick__card">
            <input type="radio" name="storefrontLayout" value={id} checked={id === value} onChange={() => onChange(id)} className="sr-only" />
            <Thumb id={id} color={color} />
            <span className="lpick__name">{t(`admin.branding.layouts.${id}.name` as TKey)}</span>
            <span className="lpick__body">{t(`admin.branding.layouts.${id}.body` as TKey)}</span>
          </label>
          <a className="lpick__preview" href={`/?layout=${id}`} target="_blank" rel="noopener" title={t('admin.branding.layoutPreviewHint')}>
            {t('admin.branding.layoutPreview')}
            <Icon icon={ExternalLink} size="xs" />
          </a>
        </div>
      ))}
    </div>
  );
}
