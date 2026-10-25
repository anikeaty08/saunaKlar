import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { X } from 'lucide-react';
import { gsap, useGSAP } from '../../motion/gsap.ts';
import { prefersReducedMotion } from '../../motion/preferences.ts';
import { useT } from '../../i18n/i18n.ts';
import { Icon } from './Icon.tsx';
import './Toast.css';

export interface ToastItem {
  id: number;
  title: string;
  body?: string;
  tone?: 'default' | 'error';
  duration?: number;
}

interface ToastState {
  items: ToastItem[];
  push: (t: Omit<ToastItem, 'id'>) => number;
  dismiss: (id: number) => void;
}

let seq = 0;
export const useToasts = create<ToastState>(set => ({
  items: [],
  push: t => {
    const id = ++seq;
    set(s => ({ items: [...s.items.slice(-3), { ...t, id }] }));
    return id;
  },
  dismiss: id => set(s => ({ items: s.items.filter(i => i.id !== id) })),
}));

/** Imperative helper: `toast('Saved')`, `toast.error('Failed', detail)`. */
export const toast = Object.assign((title: string, body?: string) => useToasts.getState().push(body ? { title, body } : { title }), {
  error: (title: string, body?: string) => useToasts.getState().push(body ? { title, body, tone: 'error', duration: 8000 } : { title, tone: 'error', duration: 8000 }),
});

function ToastView({ item }: { item: ToastItem }) {
  const ref = useRef<HTMLLIElement>(null);
  const dismiss = useToasts(s => s.dismiss);
  const { t } = useT();
  useGSAP(() => {
    if (!prefersReducedMotion()) gsap.from(ref.current, { y: 24, autoAlpha: 0, duration: 0.5, ease: 'sk.out' });
  });
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(item.id), item.duration ?? 4500);
    return () => window.clearTimeout(timer);
  }, [item, dismiss]);
  return (
    <li ref={ref} className={`toast toast--${item.tone ?? 'default'}`} role={item.tone === 'error' ? 'alert' : 'status'}>
      <div>
        <p className="toast__title">{item.title}</p>
        {item.body && <p className="toast__body">{item.body}</p>}
      </div>
      <button type="button" className="toast__close" onClick={() => dismiss(item.id)} aria-label={t('common.dismiss')}>
        <Icon icon={X} size="sm" />
      </button>
    </li>
  );
}

/** Mount once near the root. */
export function Toaster() {
  const items = useToasts(s => s.items);
  const { t } = useT();
  return (
    <section aria-label={t('common.notifications')} className="toaster">
      <ol>
        {items.map(i => (
          <ToastView key={i.id} item={i} />
        ))}
      </ol>
    </section>
  );
}
