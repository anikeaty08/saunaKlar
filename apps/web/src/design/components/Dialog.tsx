import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { gsap } from '../../motion/gsap.ts';
import { prefersReducedMotion } from '../../motion/preferences.ts';
import { useT } from '../../i18n/i18n.ts';
import { IconButton } from './Button.tsx';
import './Dialog.css';

interface Props {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** `dialog` centred, `drawer` slides from the side (right; bottom sheet on phones). */
  variant?: 'dialog' | 'drawer';
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Built on the native <dialog>: showModal() gives a real focus trap, makes the
 * page inert and closes on Esc. Focus returns to the opener on close.
 */
export function Dialog({ open, onClose, title, description, children, footer, variant = 'dialog', size = 'md' }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();
  const descId = useId();
  const { t } = useT();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement;
      d.showModal();
      document.documentElement.classList.add('has-modal');
      if (!prefersReducedMotion()) {
        const panel = d.querySelector('.dialog__panel');
        const isDrawer = variant === 'drawer';
        const mobile = window.matchMedia('(max-width: 640px)').matches;
        gsap.fromTo(d, { '--backdrop': 0 }, { '--backdrop': 1, duration: 0.4, ease: 'power2.out' });
        gsap.fromTo(
          panel,
          isDrawer ? (mobile ? { yPercent: 100 } : { xPercent: 100 }) : { y: 24, autoAlpha: 0, scale: 0.98 },
          isDrawer ? { xPercent: 0, yPercent: 0, duration: 0.6, ease: 'sk.out' } : { y: 0, autoAlpha: 1, scale: 1, duration: 0.5, ease: 'sk.out' },
        );
      }
    } else if (!open && d.open) {
      d.close();
    }
  }, [open, variant]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onNativeClose = () => {
      document.documentElement.classList.remove('has-modal');
      (opener.current as HTMLElement | null)?.focus?.();
      if (open) onClose();
    };
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    d.addEventListener('close', onNativeClose);
    d.addEventListener('cancel', onCancel);
    return () => {
      d.removeEventListener('close', onNativeClose);
      d.removeEventListener('cancel', onCancel);
    };
  }, [open, onClose]);

  useEffect(() => () => document.documentElement.classList.remove('has-modal'), []);

  return (
    <dialog
      ref={ref}
      className={`dialog dialog--${variant} dialog--${size}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClick={e => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="dialog__panel">
        <header className="dialog__header">
          <div>
            <h2 id={titleId} className="dialog__title">
              {title}
            </h2>
            {description && (
              <p id={descId} className="dialog__desc">
                {description}
              </p>
            )}
          </div>
          <IconButton icon={X} label={t('common.close')} onClick={onClose} />
        </header>
        {open && <div className="dialog__body">{children}</div>}
        {footer && <footer className="dialog__footer">{footer}</footer>}
      </div>
    </dialog>
  );
}

/** Side drawer: the same dialog, sliding in from the edge. */
export function Drawer(props: Omit<Props, 'variant'>) {
  return <Dialog {...props} variant="drawer" />;
}
