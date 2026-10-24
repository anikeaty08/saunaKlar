import { ArrowLeft } from 'lucide-react';
import { useT } from '../../i18n/i18n.ts';
import { ScrambleText } from '../../motion/ScrambleText.tsx';
import { ButtonLink } from '../../design/components/Button.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';

export default function NotFound() {
  const { t } = useT();
  useDocumentTitle(t('notFound.title'));
  return (
    <div className="page container error-page">
      <ScrambleText as="p" className="eyebrow" text={t('notFound.eyebrow')} />
      <ScrambleText as="h1" className="error-page__title" text="404" chars="0123456789" />
      <h2 style={{ fontSize: 'var(--step-3)' }}>{t('notFound.title')}</h2>
      <p className="lede">{t('notFound.body')}</p>
      <div style={{ marginTop: 'var(--space-5)' }}>
        <ButtonLink to="/" icon={ArrowLeft}>
          {t('notFound.home')}
        </ButtonLink>
      </div>
    </div>
  );
}
