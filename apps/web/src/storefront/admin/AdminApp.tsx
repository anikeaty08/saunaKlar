import { Link, Route, Routes } from 'react-router';
import { BarChart3, Boxes, Inbox, Palette, Settings2, SlidersHorizontal, Users, ExternalLink as ExternalIcon } from 'lucide-react';
import { useTenantData } from '../../api/queries.ts';
import { useT } from '../../i18n/i18n.ts';
import { Icon } from '../../design/components/Icon.tsx';
import { EmptyState } from '../../design/components/EmptyState.tsx';
import { ButtonLink } from '../../design/components/Button.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { AdminShell } from '../../staff/AdminShell.tsx';
import { RequireStaff } from '../../staff/RequireStaff.tsx';
import { Dashboard } from './Dashboard.tsx';
import { RequestDetail, RequestsList } from './Requests.tsx';
import { CustomerDetail, CustomersList } from './Customers.tsx';
import { ConfigurationDetail, ConfigurationsList, NewConfiguration } from './Configurations.tsx';
import { SaunasAdmin } from './Saunas.tsx';
import { BrandingAdmin } from './Branding.tsx';
import { SettingsAdmin } from './Settings.tsx';
import './admin.css';

function Brand() {
  const tenant = useTenantData();
  const b = tenant.branding;
  return (
    <Link to="/admin" className="staff-shell__logo">
      {b.logoUrl ? <img src={b.logoUrl} alt={b.displayName} height={32} /> : b.displayName}
    </Link>
  );
}

function AdminNotFound() {
  const { t } = useT();
  useDocumentTitle(t('notFound.title'));
  return <EmptyState title={t('notFound.title')} body={t('notFound.body')} action={<ButtonLink to="/admin">{t('admin.nav.dashboard')}</ButtonLink>} />;
}

/** Reseller admin at /admin/* on the storefront host, in the reseller's own colours. */
export default function AdminApp() {
  const { t } = useT();
  return (
    <RequireStaff scope="RESELLER" title={t('admin.title')} brand={<Brand />}>
      {session => (
        <AdminShell
          brand={<Brand />}
          area={t('admin.title')}
          session={session}
          nav={[
            { to: '/admin', label: t('admin.nav.dashboard'), icon: BarChart3, end: true },
            { to: '/admin/requests', label: t('admin.nav.requests'), icon: Inbox },
            { to: '/admin/customers', label: t('admin.nav.customers'), icon: Users },
            { to: '/admin/configurations', label: t('admin.nav.configurations'), icon: SlidersHorizontal },
            { to: '/admin/saunas', label: t('admin.nav.saunas'), icon: Boxes },
            { to: '/admin/branding', label: t('admin.nav.branding'), icon: Palette },
            { to: '/admin/settings', label: t('admin.nav.settings'), icon: Settings2 },
          ]}
          extra={
            <a href="/" className="staff-shell__extra staff-shell__link" target="_blank" rel="noreferrer">
              <Icon icon={ExternalIcon} size="sm" />
              {t('staff.viewStorefront')}
            </a>
          }
        >
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="requests" element={<RequestsList />} />
            <Route path="requests/:id" element={<RequestDetail />} />
            <Route path="customers" element={<CustomersList />} />
            <Route path="customers/:id" element={<CustomerDetail />} />
            <Route path="configurations" element={<ConfigurationsList />} />
            <Route path="configurations/new" element={<NewConfiguration />} />
            <Route path="configurations/:id" element={<ConfigurationDetail />} />
            <Route path="saunas" element={<SaunasAdmin />} />
            <Route path="branding" element={<BrandingAdmin />} />
            <Route path="settings" element={<SettingsAdmin />} />
            <Route path="*" element={<AdminNotFound />} />
          </Routes>
        </AdminShell>
      )}
    </RequireStaff>
  );
}
