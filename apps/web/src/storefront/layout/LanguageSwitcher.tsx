import { Languages } from 'lucide-react';
import { Menu } from '../../design/components/Menu.tsx';
import { Icon } from '../../design/components/Icon.tsx';
import { LOCALES, LOCALE_NAMES, setLocale, useT } from '../../i18n/i18n.ts';
import { ScrambleText } from '../../motion/ScrambleText.tsx';

/** Header/footer language picker; choosing a language triggers the page flip. */
export function LanguageSwitcher({ align = 'end', compact }: { align?: 'start' | 'end'; compact?: boolean }) {
  const { t, locale } = useT();
  return (
    <Menu
      label={`${t('nav.language')}: ${LOCALE_NAMES[locale]}`}
      align={align}
      trigger={
        <>
          <Icon icon={Languages} size="sm" />
          <ScrambleText key={locale} text={compact ? locale.toUpperCase() : LOCALE_NAMES[locale]} className="mono" style={{ fontSize: 'var(--step--2)', letterSpacing: '0.08em', textTransform: compact ? 'uppercase' : undefined }} chars="ABCDEFGHIJKLMNOPQRSTUVWXYZ" />
        </>
      }
      items={LOCALES.map(l => ({
        key: l,
        label: <span lang={l}>{LOCALE_NAMES[l]}</span>,
        hint: l,
        checked: l === locale,
        onSelect: () => void setLocale(l),
      }))}
    />
  );
}
