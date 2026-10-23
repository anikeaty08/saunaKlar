import { useNavigate } from 'react-router';
import { UserRound } from 'lucide-react';
import { Menu } from '../../design/components/Menu.tsx';
import { Icon } from '../../design/components/Icon.tsx';
import { TextLink } from '../../design/components/TextLink.tsx';
import { toast } from '../../design/components/Toast.tsx';
import { useLogout, useSession } from '../../api/queries.ts';
import { useT } from '../../i18n/i18n.ts';

export function AccountMenu() {
  const { t } = useT();
  const session = useSession().data;
  const navigate = useNavigate();
  const logout = useLogout();
  if (session?.kind !== 'customer') {
    return (
      <TextLink to="/account/login" className="header__login">
        {t('nav.login')}
      </TextLink>
    );
  }
  const c = session.customer;
  return (
    <Menu
      label={t('nav.accountMenu')}
      trigger={
        <>
          <span className="header__avatar" aria-hidden="true">
            {c.firstName.charAt(0).toUpperCase()}
          </span>
          <span className="header__account-name">{c.firstName}</span>
        </>
      }
      header={t('nav.signedInAs', { name: `${c.firstName} ${c.lastName}` })}
      items={[
        { key: 'overview', label: t('nav.account'), onSelect: () => navigate('/account') },
        { key: 'configs', label: t('nav.configurations'), onSelect: () => navigate('/account/configurations') },
        { key: 'requests', label: t('nav.requests'), onSelect: () => navigate('/account/requests') },
        { key: 'profile', label: t('nav.profile'), onSelect: () => navigate('/account/profile') },
        {
          key: 'logout',
          label: t('nav.logout'),
          onSelect: () =>
            logout.mutate(undefined, {
              onSettled: () => {
                toast(t('auth.loggedOut'));
                navigate('/');
              },
            }),
        },
      ]}
    />
  );
}

export function AccountIcon() {
  return <Icon icon={UserRound} size="sm" />;
}
