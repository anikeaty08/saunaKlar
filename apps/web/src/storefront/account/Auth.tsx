import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { confirmRequest, emailOnlyRequest, loginRequest, resetPasswordRequest, signupRequest } from '@saunaklar/shared';
import type { z } from 'zod';
import { api, isApiError } from '../../api/client.ts';
import { sessionQuery, useTenantData } from '../../api/queries.ts';
import { useT, type TKey } from '../../i18n/i18n.ts';
import { ScrambleText } from '../../motion/ScrambleText.tsx';
import { Button } from '../../design/components/Button.tsx';
import { Checkbox, Input } from '../../design/components/Field.tsx';
import { TextLink } from '../../design/components/TextLink.tsx';
import { toast } from '../../design/components/Toast.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { SaunaGlyph } from '../components/SaunaGlyph.tsx';
import './Auth.css';

type Errors = Record<string, string>;

/** Only same-site relative paths are allowed as `?next=` (no open redirect). */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/account';
}

function useAuthForm<S extends z.ZodType>(schema: S, messages: Partial<Record<string, TKey>>) {
  const { t } = useT();
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (data: unknown, action: (body: z.output<S>) => Promise<void>) => {
    setFormError(null);
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      const e: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? '_');
        const sub = issue.path.join('.');
        const mk = messages[sub] ?? messages[key];
        e[sub] ??= mk ? t(mk) : issue.message;
        e[key] ??= e[sub];
      }
      setErrors(e);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await action(parsed.data);
    } catch (err) {
      if (isApiError(err)) {
        const fe: Errors = {};
        for (const [k, v] of Object.entries(err.fieldErrors)) fe[k] = v[0] ?? '';
        setErrors(fe);
        const key = `errors.codes.${err.code}` as TKey;
        const msg = t(key);
        setFormError(msg === key ? err.message : msg);
      } else setFormError(t('errors.body'));
    } finally {
      setBusy(false);
    }
  };
  return { errors, formError, busy, run };
}

function AuthFrame({ title, lede, children, foot }: { title: string; lede?: ReactNode; children: ReactNode; foot?: ReactNode }) {
  const tenant = useTenantData();
  useDocumentTitle(title);
  return (
    <div className="auth">
      <section className="auth__form container">
        <ScrambleText as="h1" className="auth__title" text={title} />
        {lede && <p className="auth__lede">{lede}</p>}
        {children}
        {foot && <div className="auth__foot">{foot}</div>}
      </section>
      <aside className="auth__art" aria-hidden="true">
        <p className="auth__brand">{tenant.branding.displayName}</p>
        <SaunaGlyph form="cabin" widthMm={3000} depthMm={2400} heightMm={2600} className="auth__glyph" strokeWidth={0.8} />
        <p className="auth__tag">{tenant.branding.tagline}</p>
      </aside>
    </div>
  );
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="auth__error" role="alert">
      {message}
    </p>
  );
}

export function Login() {
  const { t } = useT();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const next = safeNext(params.get('next'));
  const { errors, formError, busy, run } = useAuthForm(loginRequest, { email: 'validation.email', password: 'validation.required' });
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run({ email, password }, async body => {
      try {
        const s = await api('login', { body });
        qc.setQueryData(sessionQuery.queryKey, s);
        if (s.kind === 'customer') toast(t('auth.welcome', { name: s.customer.firstName }));
        navigate(next, { replace: true });
      } catch (err) {
        if (isApiError(err, 'EMAIL_NOT_VERIFIED')) {
          navigate(`/account/verify?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
          return;
        }
        throw err;
      }
    });
  };

  return (
    <AuthFrame
      title={t('auth.loginTitle')}
      lede={t('auth.loginLede')}
      foot={
        <>
          {t('auth.noAccount')}{' '}
          <TextLink to={`/account/signup?next=${encodeURIComponent(next)}`} tone="underline">
            {t('nav.signup')}
          </TextLink>
        </>
      }
    >
      <form className="auth__fields" onSubmit={submit} noValidate>
        <FormError message={formError} />
        <Input label={t('auth.email')} type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} error={errors.email} />
        <Input label={t('auth.password')} type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} error={errors.password} />
        <div className="auth__row">
          <Link to={`/account/forgot?email=${encodeURIComponent(email)}`} className="auth__small">
            {t('auth.forgot')}
          </Link>
        </div>
        <Button type="submit" size="lg" block loading={busy} iconAfter={ArrowRight}>
          {t('auth.login')}
        </Button>
      </form>
    </AuthFrame>
  );
}

export function Signup() {
  const { t, locale } = useT();
  const tenant = useTenantData();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get('next'));
  const { errors, formError, busy, run } = useAuthForm(signupRequest, {
    email: 'validation.email',
    password: 'validation.password',
    firstName: 'validation.required',
    lastName: 'validation.required',
    'consents.terms': 'validation.consent',
    'consents.privacy': 'validation.consent',
  });
  const [f, setF] = useState({ email: '', password: '', firstName: '', lastName: '', phone: '', terms: false, privacy: false, marketing: false });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF(s => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(
      {
        email: f.email,
        password: f.password,
        firstName: f.firstName,
        lastName: f.lastName,
        ...(f.phone ? { phone: f.phone } : {}),
        locale,
        consents: { terms: f.terms, privacy: f.privacy, marketing: f.marketing },
      },
      async body => {
        await api('signup', { body });
        navigate(`/account/verify?email=${encodeURIComponent(f.email)}&next=${encodeURIComponent(next)}`);
      },
    );
  };

  const [termsA, termsB] = t('auth.acceptTerms').split('{terms}');
  const [privA, privB] = t('auth.acceptPrivacy').split('{privacy}');
  return (
    <AuthFrame
      title={t('auth.signupTitle')}
      lede={t('auth.signupLede', { name: tenant.branding.displayName })}
      foot={
        <>
          {t('auth.haveAccount')}{' '}
          <TextLink to={`/account/login?next=${encodeURIComponent(next)}`} tone="underline">
            {t('nav.login')}
          </TextLink>
        </>
      }
    >
      <form className="auth__fields" onSubmit={submit} noValidate>
        <FormError message={formError} />
        <div className="auth__pair">
          <Input label={t('auth.firstName')} autoComplete="given-name" required value={f.firstName} onChange={set('firstName')} error={errors.firstName} />
          <Input label={t('auth.lastName')} autoComplete="family-name" required value={f.lastName} onChange={set('lastName')} error={errors.lastName} />
        </div>
        <Input label={t('auth.email')} type="email" autoComplete="email" required value={f.email} onChange={set('email')} error={errors.email} />
        <Input label={t('auth.phone')} type="tel" autoComplete="tel" value={f.phone} onChange={set('phone')} error={errors.phone} />
        <Input label={t('auth.password')} type="password" autoComplete="new-password" required value={f.password} onChange={set('password')} error={errors.password} hint={t('auth.passwordHint')} />
        <div className="auth__checks">
          <Checkbox
            checked={f.terms}
            onChange={set('terms')}
            error={errors['consents.terms'] ?? null}
            label={
              <>
                {termsA}
                <Link to="/legal/terms" target="_blank">
                  {t('auth.termsLink')}
                </Link>
                {termsB}
              </>
            }
          />
          <Checkbox
            checked={f.privacy}
            onChange={set('privacy')}
            error={errors['consents.privacy'] ?? null}
            label={
              <>
                {privA}
                <Link to="/legal/privacy" target="_blank">
                  {t('auth.privacyLink')}
                </Link>
                {privB}
              </>
            }
          />
          <Checkbox checked={f.marketing} onChange={set('marketing')} label={t('auth.marketing')} />
        </div>
        <Button type="submit" size="lg" block loading={busy} iconAfter={ArrowRight}>
          {t('auth.signup')}
        </Button>
      </form>
    </AuthFrame>
  );
}

export function Verify() {
  const { t } = useT();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const email = params.get('email') ?? '';
  const next = safeNext(params.get('next'));
  const [code, setCode] = useState('');
  const { errors, formError, busy, run } = useAuthForm(confirmRequest, { code: 'validation.code', email: 'validation.email' });
  const [resending, setResending] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run({ email, code }, async body => {
      const s = await api('confirm', { body });
      qc.setQueryData(sessionQuery.queryKey, s);
      if (s.kind === 'customer') toast(t('auth.welcome', { name: s.customer.firstName }));
      navigate(next, { replace: true });
    });
  };
  const resend = async () => {
    setResending(true);
    try {
      await api('resendCode', { body: { email } });
      toast(t('auth.resent'));
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthFrame title={t('auth.verifyTitle')} lede={t('auth.verifyLede', { email })}>
      <form className="auth__fields" onSubmit={submit} noValidate>
        <FormError message={formError} />
        <Input label={t('auth.code')} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} error={errors.code} className="auth__code" />
        <Button type="submit" size="lg" block loading={busy}>
          {t('auth.verify')}
        </Button>
        <Button variant="link" onClick={() => void resend()} loading={resending}>
          {t('auth.resend')}
        </Button>
      </form>
    </AuthFrame>
  );
}

export function Forgot() {
  const { t } = useT();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const { errors, formError, busy, run } = useAuthForm(emailOnlyRequest, { email: 'validation.email' });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run({ email }, async body => {
      await api('forgotPassword', { body });
      toast(t('auth.forgotSent', { email }));
      navigate(`/account/reset?email=${encodeURIComponent(email)}`);
    });
  };
  return (
    <AuthFrame title={t('auth.forgotTitle')} lede={t('auth.forgotLede')} foot={<TextLink to="/account/login" tone="underline">{t('nav.login')}</TextLink>}>
      <form className="auth__fields" onSubmit={submit} noValidate>
        <FormError message={formError} />
        <Input label={t('auth.email')} type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} error={errors.email} />
        <Button type="submit" size="lg" block loading={busy}>
          {t('auth.sendCode')}
        </Button>
      </form>
    </AuthFrame>
  );
}

export function Reset() {
  const { t } = useT();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [f, setF] = useState({ email: params.get('email') ?? '', code: '', newPassword: '' });
  const { errors, formError, busy, run } = useAuthForm(resetPasswordRequest, { email: 'validation.email', code: 'validation.code', newPassword: 'validation.password' });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(f, async body => {
      await api('resetPassword', { body });
      toast(t('auth.resetDone'));
      navigate(`/account/login?email=${encodeURIComponent(f.email)}`);
    });
  };
  return (
    <AuthFrame title={t('auth.resetTitle')}>
      <form className="auth__fields" onSubmit={submit} noValidate>
        <FormError message={formError} />
        <Input label={t('auth.email')} type="email" autoComplete="email" required value={f.email} onChange={e => setF({ ...f, email: e.target.value })} error={errors.email} />
        <Input label={t('auth.code')} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={f.code} onChange={e => setF({ ...f, code: e.target.value.replace(/\D/g, '') })} error={errors.code} />
        <Input label={t('auth.newPassword')} type="password" autoComplete="new-password" required value={f.newPassword} onChange={e => setF({ ...f, newPassword: e.target.value })} error={errors.newPassword} hint={t('auth.passwordHint')} />
        <Button type="submit" size="lg" block loading={busy}>
          {t('auth.reset')}
        </Button>
      </form>
    </AuthFrame>
  );
}
