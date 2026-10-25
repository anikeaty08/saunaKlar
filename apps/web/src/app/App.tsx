import { StrictMode, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { RouterProvider, type createBrowserRouter } from 'react-router';
import { persistOptions, queryClient } from '../api/persist.ts';
import { ErrorBoundary } from '../design/components/ErrorBoundary.tsx';

type Router = ReturnType<typeof createBrowserRouter>;

function Providers({ children }: { children: ReactNode }) {
  const persist = persistOptions();
  return persist ? (
    <PersistQueryClientProvider client={queryClient} persistOptions={persist}>
      {children}
    </PersistQueryClientProvider>
  ) : (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

export function App({ router }: { router: Router }) {
  return (
    <StrictMode>
      <ErrorBoundary>
        <Providers>
          <RouterProvider router={router} />
        </Providers>
      </ErrorBoundary>
    </StrictMode>
  );
}
