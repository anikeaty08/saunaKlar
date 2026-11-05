import { Link, useLocation } from 'react-router';
import { Flame, FileText, SlidersHorizontal, UserRound, type LucideIcon } from 'lucide-react';
import { Icon } from '../../design/components/Icon.tsx';
import { useSession } from '../../api/queries.ts';
import { useT, type TKey } from '../../i18n/i18n.ts';
import './BottomNav.css';

interface Item {
  to: string;
  key: TKey;
  icon: LucideIcon;
  active: (path: string) => boolean;
}

/** Fixed tab bar for phones and small tablets (hidden on desktop, where the header nav shows). */
export function BottomNav() {
  const { t } = useT();
  const { pathname } = useLocation();
  const loggedIn = useSession().data?.kind === 'customer';

  const items: Item[] = [
    { to: '/saunas', key: 'nav.saunas', icon: Flame, active: p => p.startsWith('/saunas') && !p.endsWith('/configure') },
    { to: '/saunas', key: 'nav.configure', icon: SlidersHorizontal, active: p => p.startsWith('/saunas') && p.endsWith('/configure') },
    loggedIn
      ? { to: '/account/requests', key: 'nav.requests', icon: FileText, active: p => p.startsWith('/account/requests') }
      : { to: '/how-it-works', key: 'nav.howItWorks', icon: FileText, active: p => p.startsWith('/how-it-works') },
    loggedIn
      ? { to: '/account', key: 'nav.account', icon: UserRound, active: p => p.startsWith('/account') && !p.startsWith('/account/requests') }
      : { to: '/account/login', key: 'nav.login', icon: UserRound, active: p => p.startsWith('/account') },
  ];

  return (
    <nav className="bnav" aria-label={t('nav.bottom')}>
      <ul className="bnav__list">
        {items.map(i => {
          const on = i.active(pathname);
          return (
            <li key={i.key}>
              <Link to={i.to} className="bnav__link" aria-current={on ? 'page' : undefined}>
                <Icon icon={i.icon} size="md" />
                <span className="bnav__label">{t(i.key)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
