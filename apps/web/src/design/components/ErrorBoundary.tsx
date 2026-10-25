import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router';
import { RotateCcw } from 'lucide-react';
import { useT } from '../../i18n/i18n.ts';
import { isApiError } from '../../api/client.ts';
import { Button, ButtonLink } from './Button.tsx';
import './ErrorPage.css';

/** Full-page error state, used by the boundary and by router errorElements. */
export function ErrorPage({ error, onRetry }: { error?: unknown; onRetry?: () => void }) {
  const { t } = useT();
  const notFound = (isRouteErrorResponse(error) && error.status === 404) || isApiError(error, 'NOT_FOUND');
  const requestId = isApiError(error) ? error.requestId : null;
  return (
    <main id="main" className="error-page container">
      <p className="eyebrow">{notFound ? t('notFound.eyebrow') : t('errors.eyebrow')}</p>
      <h1 className="error-page__title">{notFound ? t('notFound.title') : t('errors.title')}</h1>
      <p className="lede">{notFound ? t('notFound.body') : isApiError(error, 'NETWORK') ? t('errors.network') : t('errors.body')}</p>
      {requestId && <p className="mono muted" style={{ fontSize: 'var(--step--2)' }}>{t('errors.reference', { id: requestId })}</p>}
      <div className="cluster" style={{ marginTop: 'var(--space-6)' }}>
        {!notFound && (
          <Button icon={RotateCcw} onClick={onRetry ?? (() => window.location.reload())}>
            {onRetry ? t('common.retry') : t('errors.reload')}
          </Button>
        )}
        <ButtonLink to="/" variant={notFound ? 'primary' : 'ghost'} reloadDocument>
          {t('notFound.home')}
        </ButtonLink>
      </div>
    </main>
  );
}

/** For `errorElement` on routes. */
export function RouteErrorPage() {
  const error = useRouteError();
  if (import.meta.env.DEV) console.error(error);
  return <ErrorPage error={error} />;
}

interface State {
  error: unknown;
}

/** Catches render errors outside the router (and in widgets such as the 3D canvas). */
export class ErrorBoundary extends Component<{ children: ReactNode; fallback?: (error: unknown, reset: () => void) => ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  override render() {
    if (this.state.error) return this.props.fallback ? this.props.fallback(this.state.error, this.reset) : <ErrorPage error={this.state.error} onRetry={this.reset} />;
    return this.props.children;
  }
}
