import { useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, ShieldCheck } from 'lucide-react';
import type { StaffChallengeResponse } from '@saunaklar/shared';
import { api, isApiError } from '../api/client.ts';
import { sessionQuery } from '../api/queries.ts';
import { useT } from '../i18n/i18n.ts';
import { errorText } from '../i18n/errorText.ts';
import { ScrambleText } from '../motion/ScrambleText.tsx';
import { Button } from '../design/components/Button.tsx';
import { Input } from '../design/components/Field.tsx';
import { Icon } from '../design/components/Icon.tsx';
import { useDocumentTitle } from '../app/useDocumentTitle.ts';
import { Credit } from '../design/components/Credit.tsx';
import { qrMatrix } from './qr.ts';
import './staff.css';

/** The otpauth URI as a crisp SVG QR code (4-module quiet zone). */
function QrCode({ text, label }: { text: string; label: string }) {
  const m = qrMatrix(text);
  const n = m.length;
  let d = '';
  m.forEach((row, y) => row.forEach((dark, x) => dark && (d += `M${x} ${y}h1v1h-1z`)));
  return (
    <svg className="staff-login__qr" viewBox={`-4 -4 ${n + 8} ${n + 8}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect x={-4} y={-4} width={n + 8} height={n + 8} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

type Step =
  | { kind: 'password' }
  | { kind: 'mfa'; challengeId: string }
  | { kind: 'setup'; challengeId: string; secret: string; otpauthUri: string }
  | { kind: 'newPassword'; challengeId: string };

/**
 * Staff sign-in for both admin areas. Follows the API's challenge model:
 * password → (new password) → TOTP code or TOTP setup → session cookie.
 */
export function StaffLogin({ title, brand, notice, onSignedIn }: { title: string; brand: ReactNode; notice?: string | null; onSignedIn?: () => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useDocumentTitle(title);

  const handle = async (call: () => Promise<StaffChallengeResponse>) => {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const r = await call();
      setCode('');
      switch (r.status) {
        case 'OK': {
          const s = await api('session');
          qc.setQueryData(sessionQuery.queryKey, s);
          onSignedIn?.();
          return;
        }
        case 'MFA_REQUIRED':
          return setStep({ kind: 'mfa', challengeId: r.challengeId });
        case 'MFA_SETUP':
          return setStep({ kind: 'setup', challengeId: r.challengeId, secret: r.secret, otpauthUri: r.otpauthUri });
        case 'NEW_PASSWORD_REQUIRED':
          return setStep({ kind: 'newPassword', challengeId: r.challengeId });
      }
    } catch (e) {
      if (isApiError(e, 'CHALLENGE_EXPIRED')) setStep({ kind: 'password' });
      if (isApiError(e)) setFieldErrors(Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k, v[0] ?? ''])));
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (step.kind === 'password') {
      if (!email.trim() || !password) return setFieldErrors({ ...(email.trim() ? {} : { email: t('validation.required') }), ...(password ? {} : { password: t('validation.required') }) });
      void handle(() => api('staffLogin', { body: { email: email.trim(), password } }));
    } else if (step.kind === 'newPassword') {
      void handle(() => api('staffNewPassword', { body: { challengeId: step.challengeId, newPassword } }));
    } else {
      if (!/^\d{6}$/.test(code.trim())) return setFieldErrors({ code: t('validation.code') });
      void handle(() => api('staffMfa', { body: { challengeId: step.challengeId, code: code.trim() } }));
    }
  };

  const heading =
    step.kind === 'password' ? title : step.kind === 'mfa' ? t('staff.mfaTitle') : step.kind === 'setup' ? t('staff.mfaSetupTitle') : t('staff.newPasswordTitle');
  const lede =
    step.kind === 'password' ? t('staff.loginLede') : step.kind === 'mfa' ? t('staff.mfaLede') : step.kind === 'setup' ? t('staff.mfaSetupLede') : t('staff.newPasswordLede');

  return (
    <div className="staff-login">
      <div className="staff-login__panel">
        <div className="staff-login__brand">{brand}</div>
        <ScrambleText key={step.kind} as="h1" className="staff-login__title" text={heading} />
        <p className="staff-login__lede">{lede}</p>
        {notice && step.kind === 'password' && (
          <p className="staff-login__notice" role="status">
            {notice}
          </p>
        )}
        <form className="staff-login__form" onSubmit={submit} noValidate>
          {error && (
            <p className="staff-login__error" role="alert">
              {error}
            </p>
          )}
          {step.kind === 'password' && (
            <>
              <Input label={t('auth.email')} type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} error={fieldErrors.email} autoFocus />
              <Input label={t('auth.password')} type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} error={fieldErrors.password} />
              <Button type="submit" size="lg" block loading={busy}>
                {t('auth.login')}
              </Button>
            </>
          )}
          {step.kind === 'newPassword' && (
            <>
              <Input label={t('auth.newPassword')} hint={t('auth.passwordHint')} type="password" autoComplete="new-password" required value={newPassword} onChange={e => setNewPassword(e.target.value)} error={fieldErrors.newPassword} autoFocus />
              <Button type="submit" size="lg" block loading={busy} icon={KeyRound}>
                {t('staff.continue')}
              </Button>
            </>
          )}
          {(step.kind === 'mfa' || step.kind === 'setup') && (
            <>
              {step.kind === 'setup' && (
                <div className="staff-login__secret">
                  <QrCode text={step.otpauthUri} label={t('staff.mfaSetupTitle')} />
                  <span className="eyebrow">{t('staff.secret')}</span>
                  <code className="mono">{step.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
                  <a href={step.otpauthUri} className="staff-login__otpauth">
                    <Icon icon={ShieldCheck} size="sm" /> {t('staff.openAuthenticator')}
                  </a>
                </div>
              )}
              <Input
                label={t('auth.code')}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                required
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                error={fieldErrors.code}
                className="staff-login__code"
                autoFocus
              />
              <Button type="submit" size="lg" block loading={busy} icon={ShieldCheck}>
                {t('auth.verify')}
              </Button>
            </>
          )}
          {step.kind !== 'password' && (
            <Button type="button" variant="link" onClick={() => setStep({ kind: 'password' })}>
              {t('staff.back')}
            </Button>
          )}
        </form>
        <Credit quiet copyright={false} className="staff-login__credit" />
      </div>
    </div>
  );
}
