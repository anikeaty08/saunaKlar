import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Icon } from './Icon.tsx';
import { useT } from '../../i18n/i18n.ts';
import './Table.css';

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Plain-text column name for the sort button label. */
  label?: string;
  cell: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
  align?: 'start' | 'end';
  width?: string;
  /** Hidden below 640px. */
  hideOnMobile?: boolean;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption?: string;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  loading?: boolean;
}

/** Data table with sortable headers (aria-sort), an empty state and a stacked layout on phones. */
export function Table<T>({ columns, rows, rowKey, caption, empty, onRowClick, initialSort, loading }: Props<T>) {
  const { t } = useT();
  const [sort, setSort] = useState(initialSort ?? null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find(c => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const v = col.sortValue;
    return [...rows].sort((a, b) => {
      const x = v(a);
      const y = v(b);
      const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return sort.dir === 'asc' ? r : -r;
    });
  }, [rows, sort, columns]);

  const toggle = (key: string) => setSort(s => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  return (
    <div className="table-wrap" aria-busy={loading || undefined}>
      <table className="table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map(c => {
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  style={{ width: c.width }}
                  className={[c.align === 'end' && 'is-end', c.hideOnMobile && 'hide-sm'].filter(Boolean).join(' ') || undefined}
                  aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : c.sortValue ? 'none' : undefined}
                >
                  {c.sortValue ? (
                    <button type="button" className="table__sort" onClick={() => toggle(c.key)} aria-label={t('common.sortBy', { column: c.label ?? String(c.header) })}>
                      {c.header}
                      <Icon icon={active ? (sort!.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown} size="xs" className={active ? undefined : 'table__sort-idle'} />
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => (
            <tr
              key={rowKey(row)}
              className={onRowClick ? 'is-clickable' : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map(c => (
                <td key={c.key} data-label={c.label ?? (typeof c.header === 'string' ? c.header : '')} className={[c.align === 'end' && 'is-end', c.hideOnMobile && 'hide-sm'].filter(Boolean).join(' ') || undefined}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!loading && rows.length === 0 && <div className="table__empty">{empty}</div>}
    </div>
  );
}
