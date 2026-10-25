import { createBrowserRouter } from 'react-router';
import type { HostKind } from '../host.ts';
import { RouteErrorPage } from '../design/components/ErrorBoundary.tsx';
import { PlatformRoot } from './PlatformPage.tsx';

export function createPlatformRouter(host: Extract<HostKind, { kind: 'platform' }>) {
  return createBrowserRouter([{ path: '*', element: <PlatformRoot host={host} />, errorElement: <RouteErrorPage /> }]);
}
