import { useRef, useState } from 'react';
import { gsap, ScrollTrigger, useGSAP } from '../../motion/gsap.ts';
import { prefersReducedMotion } from '../../motion/preferences.ts';
import { TextNavLink } from '../../design/components/TextLink.tsx';
import { FlipText } from '../../motion/FlipText.tsx';
import { useT } from '../../i18n/i18n.ts';
import type { Tenant } from '../../api/types.ts';
import { Brand } from './Brand.tsx';
import { LanguageSwitcher } from './LanguageSwitcher.tsx';
import { AccountMenu } from './AccountMenu.tsx';
import { MobileMenu } from './MobileMenu.tsx';
import { PRIMARY_NAV } from './nav.ts';
import './Header.css';

/**
 * Sticky header: compact after the first 40 px, slides away while scrolling
 * down and returns on the slightest scroll up. Never hides near the top or
 * while keyboard focus is inside it.
 */
export function Header({ tenant }: { tenant: Tenant }) {
  const { t } = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      let hidden = false;
      const show = (v: boolean) => {
        if (hidden === !v) return;
        hidden = !v;
        gsap.to(el, { yPercent: v ? 0 : -100, duration: prefersReducedMotion() ? 0 : 0.5, ease: 'sk.out', overwrite: 'auto' });
      };
      const st = ScrollTrigger.create({
        start: 0,
        end: 'max',
        onUpdate: self => {
          const y = self.scroll();
          el.classList.toggle('is-compact', y > 40);
          if (y < 160 || el.contains(document.activeElement)) show(true);
          else if (self.direction === 1 && Math.abs(self.getVelocity()) > 20) show(false);
          else if (self.direction === -1) show(true);
        },
      });
      return () => st.kill();
    },
    { scope: ref },
  );

  return (
    <>
      <header ref={ref} className="header" onFocus={() => gsap.to(ref.current, { yPercent: 0, duration: 0.3 })}>
        <div className="header__inner container">
          <Brand tenant={tenant} />
          <nav className="header__nav" aria-label={t('nav.primary')}>
            <ul>
              {PRIMARY_NAV.map(l => (
                <li key={l.to}>
                  <TextNavLink to={l.to} end={l.end}>
                    {t(l.key)}
                  </TextNavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div className="header__tools">
            <div className="header__lang">
              <LanguageSwitcher compact />
            </div>
            <div className="header__account">
              <AccountMenu />
            </div>
            <button type="button" className="header__burger" aria-label={t('nav.openMenu')} aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
              <FlipText text={t('nav.menu')} />
              <span className="sixdots" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </span>
            </button>
          </div>
        </div>
      </header>
      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} tenant={tenant} />
    </>
  );
}
