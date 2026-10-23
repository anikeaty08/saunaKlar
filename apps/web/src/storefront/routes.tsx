import { createBrowserRouter, type RouteObject } from 'react-router';
import { pages } from '../app/pages.ts';
import { RouteErrorPage } from '../design/components/ErrorBoundary.tsx';
import { StorefrontRoot, ShellSkeleton } from './StorefrontRoot.tsx';

type Mod = Record<string, unknown> & { default?: unknown };
const lazy = (load: () => Promise<Mod>, name = 'default') => async () => {
  const m = await load();
  return { Component: m[name] as React.ComponentType };
};

const routes: RouteObject[] = [
  {
    path: '/',
    element: <StorefrontRoot />,
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <ShellSkeleton />,
    children: [
      {
        errorElement: <RouteErrorPage />,
        children: [
          { index: true, lazy: lazy(pages.home) },
          { path: 'saunas', lazy: lazy(pages.saunas) },
          { path: 'saunas/:slug', lazy: lazy(pages.sauna) },
          { path: 'saunas/:slug/configure', lazy: lazy(pages.configure) },
          { path: 's/:token', lazy: lazy(pages.shared) },
          { path: 'showroom', lazy: lazy(pages.showroom) },
          { path: 'guide', lazy: lazy(pages.guide) },
          { path: 'how-it-works', lazy: lazy(pages.how) },
          { path: 'about', lazy: lazy(pages.about) },
          { path: 'faq', lazy: lazy(pages.faq) },
          { path: 'contact', lazy: lazy(pages.contact) },
          { path: 'legal/:doc', lazy: lazy(pages.legal) },
          { path: 'account/login', lazy: lazy(pages.auth, 'Login') },
          { path: 'account/signup', lazy: lazy(pages.auth, 'Signup') },
          { path: 'account/verify', lazy: lazy(pages.auth, 'Verify') },
          { path: 'account/forgot', lazy: lazy(pages.auth, 'Forgot') },
          { path: 'account/reset', lazy: lazy(pages.auth, 'Reset') },
          {
            path: 'account',
            lazy: lazy(pages.account, 'AccountLayout'),
            children: [
              { index: true, lazy: lazy(pages.account, 'Overview') },
              { path: 'configurations', lazy: lazy(pages.account, 'Configurations') },
              { path: 'configurations/:id', lazy: lazy(pages.account, 'ConfigurationDetail') },
              { path: 'requests', lazy: lazy(pages.account, 'Requests') },
              { path: 'requests/:id', lazy: lazy(pages.account, 'RequestDetail') },
              { path: 'profile', lazy: lazy(pages.account, 'Profile') },
            ],
          },
          { path: 'admin/*', lazy: lazy(pages.resellerAdmin) },
          { path: '*', lazy: lazy(pages.notFound) },
        ],
      },
    ],
  },
];

export function createStorefrontRouter() {
  return createBrowserRouter(routes);
}
