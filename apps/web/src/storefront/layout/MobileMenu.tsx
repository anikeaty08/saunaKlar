import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { X } from 'lucide-react';
import { gsap } from '../../motion/gsap.ts';
import { prefersReducedMotion } from '../../motion/preferences.ts';
import { FlipText } from '../../motion/FlipText.tsx';
import { TextLink } from '../../design/components/TextLink.tsx';
import { IconButton } from '../../design/components/Button.tsx';
import { LOCALES, LOCALE_NAMES, setLocale, useT } from '../../i18n/i18n.ts';
import { useSession } from '../../api/queries.ts';
import type { Tenant } from '../../api/types.ts';
import { PRIMARY_NAV, SECONDARY_NAV } from './nav.ts';

/**
 * Full-screen menu on a native modal <dialog> (focus trap, Esc). The ink panel
 * wipes down, then the large links rise out of their masks one after another;
 * each link flips vertically on hover like everywhere else.
 */
export function MobileMenu({ open, onClose, tenant }: { open: boolean; onClose: () => void; tenant: Tenant }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t, locale } = useT();
  const session = useSession().data;
  const { pathname } = useLocation();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      document.documentElement.classList.add('has-modal');
      if (!prefersReducedMotion()) {
        const tl = gsap.timeline();
        tl.fromTo(d, { clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)', duration: 0.7, ease: 'sk.inOut' })
          .fromTo(d.querySelectorAll('.mmenu__link-inner'), { yPercent: 110 }, { yPercent: 0, duration: 0.9, stagger: 0.06, ease: 'sk.out' }, 0.25)
          .fromTo(d.querySelectorAll('.mmenu__fade'), { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.6, stagger: 0.05 }, 0.5);
      }
    } else if (!open && d.open) {
      const finish = () => {
        d.close();
        document.documentElement.classList.remove('has-modal');
      };
      if (prefersReducedMotion()) finish();
      else gsap.to(d, { clipPath: 'inset(100% 0 0% 0)', duration: 0.55, ease: 'sk.inOut', onComplete: finish });
    }
  }, [open]);

  // Navigating closes the menu.
  useEffect(() => {
    if (open) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const links = [...PRIMARY_NAV, ...SECONDARY_NAV];
  return (
    <dialog
      ref={ref}
      className="mmenu"
      aria-label={t('nav.menu')}
      onCancel={e => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="mmenu__top container">
        <span className="mmenu__fade eyebrow mmenu__eyebrow">{tenant.branding.displayName}</span>
        <IconButton icon={X} label={t('nav.closeMenu')} onClick={onClose} className="mmenu__close" />
      </div>
      <nav className="mmenu__nav container" aria-label={t('nav.primary')}>
        <ol>
          {links.map((l, i) => (
            <li key={l.to} className="mmenu__item">
              <span className="mmenu__num mono mmenu__fade">{String(i + 1).padStart(2, '0')}</span>
              <span className="mmenu__mask">
                <span className="mmenu__link-inner">
                  <TextLink to={l.to} className="mmenu__link" aria-current={pathname.startsWith(l.to) ? 'page' : undefined}>
                    {t(l.key)}
                  </TextLink>
                </span>
              </span>
            </li>
          ))}
        </ol>
      </nav>
      <div className="mmenu__bottom container">
        <div className="mmenu__fade">
          <TextLink to={session?.kind === 'customer' ? '/account' : '/account/login'} tone="underline">
            {session?.kind === 'customer' ? t('nav.account') : t('nav.login')}
          </TextLink>
        </div>
        <div className="mmenu__langs mmenu__fade" role="group" aria-label={t('nav.language')}>
          {LOCALES.map(l => (
            <button key={l} type="button" lang={l} aria-pressed={l === locale} className="mmenu__lang" onClick={() => void setLocale(l)} title={LOCALE_NAMES[l]}>
              <FlipText text={l.toUpperCase()} />
            </button>
          ))}
        </div>
      </div>
    </dialog>
  );
}
