import { createBrowserRouter } from 'react-router';
import { RouteErrorPage } from '../design/components/ErrorBoundary.tsx';

/**
 * Manufacturer admin (admin host). The shell and each screen are their own
 * lazy chunks; the storefront never downloads any of them.
 */
export function createManufacturerRouter() {
  return createBrowserRouter([
    {
      path: '/',
      errorElement: <RouteErrorPage />,
      lazy: async () => ({ Component: (await import('./ManufacturerApp.tsx')).ManufacturerLayout }),
      children: [
        { index: true, lazy: async () => ({ Component: (await import('./ManufacturerApp.tsx')).Home }) },
        { path: 'login', lazy: async () => ({ Component: (await import('./ManufacturerApp.tsx')).Home }) },
        { path: 'resellers', lazy: async () => ({ Component: (await import('./Resellers.tsx')).Resellers }) },
        { path: 'resellers/:id', lazy: async () => ({ Component: (await import('./ResellerDetail.tsx')).ResellerDetail }) },
        { path: 'saunas', lazy: async () => ({ Component: (await import('./Saunas.tsx')).Saunas }) },
        { path: 'saunas/:id', lazy: async () => ({ Component: (await import('./SaunaDetail.tsx')).SaunaDetail }) },
        { path: 'analytics', lazy: async () => ({ Component: (await import('./Analytics.tsx')).Analytics }) },
        { path: 'audit', lazy: async () => ({ Component: (await import('./Audit.tsx')).Audit }) },
        { path: '*', lazy: async () => ({ Component: (await import('./ManufacturerApp.tsx')).NotFound }) },
      ],
    },
  ]);
}
