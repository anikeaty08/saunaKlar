import { createAppRouter } from '../app/router.ts';
import type { HostKind } from '../host.ts';
import { RouteErrorPage } from '../design/components/ErrorBoundary.tsx';
import { PlatformRoot } from './PlatformPage.tsx';

export function createPlatformRouter(host: Extract<HostKind, { kind: 'platform' }>) {
  return createAppRouter([{ path: '*', element: <PlatformRoot host={host} />, errorElement: <RouteErrorPage /> }]);
}
