'use client';

// Temporary page to verify the Sentry integration end-to-end. Throws inside
// a real client component (not the browser devtools console, which some
// browsers don't route through window.onerror) and inside a real route
// handler, so both the client and server SDKs get exercised.
// Safe to delete once verified.
export default function SentryTestPage() {
  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'center' }}>
      <button
        onClick={() => {
          throw new Error('Sentry client test error');
        }}
        style={{ padding: '10px 20px', border: '1px solid currentColor', borderRadius: 6, cursor: 'pointer' }}
      >
        Throw client error
      </button>
      <button
        onClick={() => fetch('/api/sentry-test')}
        style={{ padding: '10px 20px', border: '1px solid currentColor', borderRadius: 6, cursor: 'pointer' }}
      >
        Throw server error
      </button>
    </main>
  );
}
