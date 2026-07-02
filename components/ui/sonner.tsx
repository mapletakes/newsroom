'use client';

import { Toaster as SonnerToaster } from 'sonner';

// Toast host, skinned to the broadsheet look: sharp bordered card on paper,
// hard offset shadow, mono/display type. The token classes (bg-paper, ink,
// rust) flip automatically in dark mode. `!` beats Sonner's inline defaults.
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            'font-mono text-sm !gap-3 !rounded-none !border-2 !border-ink !bg-paper !text-ink !shadow-[4px_4px_0_rgb(var(--ink))]',
          title: '!font-display !font-bold !text-base',
          description: '!text-ink/70',
          actionButton:
            '!rounded-none !bg-ink !text-paper !font-mono !text-xs !uppercase !tracking-widest',
          cancelButton: '!rounded-none !bg-transparent !text-ink',
          error: '!border-rust',
          success: '!border-moss',
        },
      }}
    />
  );
}
