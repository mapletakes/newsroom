'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

// Thin wrapper so the (client-only) QueryClient can be created once per
// browser session and wrap the app from the server-rendered root layout —
// same pattern as ThemeProvider. The client is built inside useState (not
// module scope) so it isn't shared across requests on the server and isn't
// recreated on every client re-render.
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // The realtime broadcast + visible-tab poll are the primary
            // "is this stale" signals in this app, not a timed staleTime —
            // treat fetched data as fresh until something explicitly
            // invalidates it, so a query doesn't silently refetch behind a
            // mid-edit optimistic update for reasons unrelated to writes.
            staleTime: Infinity,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      {children}
      {process.env.NODE_ENV === 'development' && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
