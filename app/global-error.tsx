'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

// Catches errors that escape the root layout itself, which is why this file
// has to render its own <html>/<body> rather than composing with layout.tsx.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
        <main
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            textAlign: 'center',
          }}
        >
          <div style={{ maxWidth: 380 }}>
            <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Something went wrong</h1>
            <p style={{ opacity: 0.6, marginBottom: 20 }}>
              The error has been reported. Try reloading the page.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 16px',
                border: '1px solid currentColor',
                borderRadius: 6,
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              Reload
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
