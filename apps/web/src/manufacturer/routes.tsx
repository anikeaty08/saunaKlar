import { createBrowserRouter } from 'react-router';
import { RouteErrorPage } from '../design/components/ErrorBoundary.tsx';

/**
 * Manufacturer admin (admin host). Placeholder screens; the admin-panel work
 * replaces `ManufacturerApp.tsx` with the real panels.
 */
export function createManufacturerRouter() {
  return createBrowserRouter([
    {
      path: '/',
      errorElement: <RouteErrorPage />,
      lazy: async () => ({ Component: (await import('./ManufacturerApp.tsx')).ManufacturerLayout }),
      children: [
        { index: true, lazy: async () => ({ Component: (await import('./ManufacturerApp.tsx')).Placeholder }) },
        { path: 'resellers', lazy: async () => ({ Component: (await import('./ManufacturerApp.tsx')).Placeholder }) },
        { path: 'resellers/:id', lazy: async () => ({ Component: (await import('./ManufacturerApp.tsx')).Placeholder }) },
        { path: 'saunas', lazy: async () => ({ Component: (await import('./ManufacturerApp.tsx')).Placeholder }) },
        { path: 'saunas/:id', lazy: async () => ({ Component: (await import('./ManufacturerApp.tsx')).Placeholder }) },
        { path: 'audit', lazy: async () => ({ Component: (await import('./ManufacturerApp.tsx')).Placeholder }) },
        { path: 'login', lazy: async () => ({ Component: (await import('./ManufacturerApp.tsx')).Placeholder }) },
        { path: '*', lazy: async () => ({ Component: (await import('./ManufacturerApp.tsx')).Placeholder }) },
      ],
    },
  ]);
}
