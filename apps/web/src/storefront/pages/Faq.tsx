import { useT } from '../../i18n/i18n.ts';
import { useTenantData } from '../../api/queries.ts';
import { Accordion } from '../../design/components/Accordion.tsx';
import { TextLink } from '../../design/components/TextLink.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { PageHero } from '../components/PageHero.tsx';

export default function Faq() {
  const { t, m, f } = useT();
  const name = useTenantData().branding.displayName;
  useDocumentTitle(t('faq.eyebrow'));
  return (
    <div className="page container">
      <PageHero eyebrow={t('faq.eyebrow')} title={t('faq.title')} />
      <Accordion items={m.faq.items.map((it, i) => ({ id: String(i), title: it.q, body: <p>{f(it.a, { name })}</p> }))} />
      <p style={{ marginTop: 'var(--space-7)', fontSize: 'var(--step-1)' }}>
        <TextLink to="/contact" tone="underline">
          {t('faq.more')}
        </TextLink>
      </p>
    </div>
  );
}
