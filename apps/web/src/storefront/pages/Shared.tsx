import { useParams, useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Clock, Download } from 'lucide-react';
import { api, isApiError } from '../../api/client.ts';
import { useSession, useTenantData } from '../../api/queries.ts';
import { useT } from '../../i18n/i18n.ts';
import { useFormat } from '../../i18n/format.ts';
import { ScrambleText } from '../../motion/ScrambleText.tsx';
import { Button, ButtonLink } from '../../design/components/Button.tsx';
import { Price } from '../../design/components/Price.tsx';
import { Skeleton } from '../../design/components/Skeleton.tsx';
import { EmptyState } from '../../design/components/EmptyState.tsx';
import { ErrorPage } from '../../design/components/ErrorBoundary.tsx';
import { toast } from '../../design/components/Toast.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { ViewerSlot } from '../../three/ViewerSlot.tsx';
import { ArButton } from '../../three/ArButton.tsx';
import { specsOf } from '../components/specs.ts';
import { viewerOptionsOf } from '../components/sauna-helpers.ts';
import './SaunaDetail.css';

export default function Shared() {
  const { token = '' } = useParams();
  const { t } = useT();
  const fmt = useFormat();
  const tenant = useTenantData();
  const session = useSession().data;
  const navigate = useNavigate();
  const shared = useQuery({ queryKey: ['shared', token], queryFn: () => api('shared', { params: { token } }), retry: false });
  useDocumentTitle(shared.data?.configuration.name ?? t('shared.eyebrow'));
  const claim = useMutation({
    mutationFn: () => api('claimShared', { params: { token } }),
    onSuccess: r => {
      toast(t('shared.claimed'));
      navigate(`/account/configurations/${r.configurationId}`);
    },
  });

  if (shared.isPending)
    return (
      <div className="page container detail" aria-hidden="true">
        <Skeleton height="auto" style={{ aspectRatio: '4 / 3.2' }} />
        <Skeleton lines={6} />
      </div>
    );
  if (shared.error) {
    if (isApiError(shared.error, 'SHARE_LINK_EXPIRED') || isApiError(shared.error, 'SHARE_LINK_REVOKED') || isApiError(shared.error, 'NOT_FOUND') || isApiError(shared.error, 'GONE')) {
      return (
        <div className="page container">
          <EmptyState
            icon={Clock}
            title={t('shared.expiredTitle')}
            body={t('shared.expiredBody', { name: tenant.branding.displayName })}
            action={<ButtonLink to="/contact">{t('shared.contact', { name: tenant.branding.displayName })}</ButtonLink>}
          />
        </div>
      );
    }
    return <ErrorPage error={shared.error} />;
  }

  const d = shared.data;
  const specs = specsOf(d.sauna);
  const chosen = d.sauna.groups.flatMap(g => g.options.filter(o => d.configuration.selections.includes(o.id)).map(o => ({ g: g.name, o })));
  const signedIn = session?.kind === 'customer';
  return (
    <div className="page container">
      <p className="eyebrow">{t('shared.eyebrow')}</p>
      <div className="detail">
        <div className="detail__stage">
          <ViewerSlot name={d.sauna.name} specs={specs} options={viewerOptionsOf(d.sauna, d.configuration.selections)} lowUrl={d.sauna.assets.lowGlbUrl} highUrl={d.sauna.assets.highGlbUrl} allowHigh thumbnailUrl={d.sauna.assets.thumbnailUrl} />
          {d.sauna.assets.hasAr && (
            <div className="detail__ar">
              <ArButton saunaModelId={d.sauna.id} name={d.sauna.name} enabled shareToken={token} />
            </div>
          )}
        </div>
        <aside className="detail__aside">
          <div className="detail__sticky">
            <ScrambleText as="h1" className="detail__title" text={d.configuration.name} />
            <p className="detail__desc">{d.sauna.name}</p>
            <dl className="kv">
              {chosen.map(c => (
                <div key={c.o.id} style={{ display: 'contents' }}>
                  <dt>{c.g}</dt>
                  <dd>{c.o.name}</dd>
                </div>
              ))}
            </dl>
            <div className="pricecard">
              <Price minor={d.snapshot.finalPriceMinor} currency={d.snapshot.currency} listMinor={d.snapshot.discountMinor > 0 ? d.snapshot.subtotalMinor : null} size="lg" />
              <p className="pricecard__vat">{t('shared.priceAsOf', { date: fmt.date(d.snapshot.computedAt) })} · {t('shared.validUntil', { date: fmt.date(d.snapshot.priceValidUntil) })}</p>
              <p className="pricecard__vat">{t('shared.expires', { date: fmt.date(d.expiresAt) })}</p>
              {signedIn ? (
                <Button icon={Download} size="lg" block onClick={() => claim.mutate()} loading={claim.isPending}>
                  {t('shared.claim')}
                </Button>
              ) : (
                <>
                  <ButtonLink to={`/account/login?next=${encodeURIComponent(`/s/${token}`)}`} size="lg" block>
                    {t('nav.login')}
                  </ButtonLink>
                  <p className="pricecard__hint">{t('shared.claimHint')}</p>
                </>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
