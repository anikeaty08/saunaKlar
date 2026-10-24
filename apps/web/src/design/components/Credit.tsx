import { useT } from '../../i18n/i18n.ts';
import './Credit.css';

const MARK = `${import.meta.env.BASE_URL}brand/klardatalabs-mark.png`;

/**
 * "Designed and maintained by Klardatalabs" credit. `tone="on-ink"` for dark
 * bands (storefront footer); `quiet` is the single-line form for admin frames.
 */
export function Credit({ tone = 'paper', quiet = false, copyright = true, className }: { tone?: 'paper' | 'on-ink'; quiet?: boolean; copyright?: boolean; className?: string }) {
  const { t } = useT();
  return (
    <div className={['credit', `credit--${tone}`, quiet && 'credit--quiet', className].filter(Boolean).join(' ')}>
      <a className="credit__link" href="https://klardatalabs.com" target="_blank" rel="noopener noreferrer">
        <img src={MARK} alt="" className="credit__mark" width={43} height={15} decoding="async" />
        <span>
          {t('footer.credit')} <b>Klardatalabs</b>
        </span>
      </a>
      {copyright && <span className="credit__copy">© {new Date().getFullYear()} Klardatalabs.com</span>}
    </div>
  );
}
