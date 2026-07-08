'use client';

import { useRef, useState } from 'react';

const SWIPE_THRESHOLD = 90;
const MAX_DRAG = 140;

// A touch-only swipe affordance (approve right, reject left) wrapping a
// pending-item card. Mouse/pen input is ignored entirely — desktop mods keep
// using the Approve/Reject buttons — so this never fights with drag-select,
// text selection, or normal clicking on a non-touch device. A vertical
// finger movement is treated as a page scroll, not a swipe, decided from the
// first few pixels of movement so a slightly-off-axis scroll doesn't get
// hijacked.
export function SwipeRow({
  children,
  onApprove,
  onReject,
  disabled,
}: {
  children: React.ReactNode;
  onApprove: () => void;
  onReject: () => void;
  disabled?: boolean;
}) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const axisRef = useRef<'x' | 'y' | null>(null);

  const reset = () => {
    setDragX(0);
    setDragging(false);
    startRef.current = null;
    axisRef.current = null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || e.pointerType !== 'touch') return;
    startRef.current = { x: e.clientX, y: e.clientY };
    axisRef.current = null;
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!startRef.current) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    if (!axisRef.current) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return; // dead zone before committing to an axis
      axisRef.current = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (axisRef.current === 'y') { reset(); return; } // let the page scroll instead
    }
    e.preventDefault();
    const clamped = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, dx));
    setDragX(clamped);
  };

  const onPointerUp = () => {
    if (axisRef.current === 'x' && Math.abs(dragX) > SWIPE_THRESHOLD) {
      if (dragX > 0) onApprove();
      else onReject();
    }
    reset();
  };

  const stampOpacity = Math.min(Math.abs(dragX) / SWIPE_THRESHOLD, 1);

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={reset}
      className="relative touch-pan-y select-none"
      style={{
        transform: `translateX(${dragX}px)`,
        transition: dragging ? 'none' : 'transform 200ms ease',
      }}
    >
      {children}
      {dragX !== 0 && (
        <div
          className={`absolute inset-0 flex items-center pointer-events-none font-mono text-sm font-bold uppercase tracking-widest ${
            dragX > 0 ? 'justify-end pr-6 text-moss' : 'justify-start pl-6 text-rust'
          }`}
          style={{ opacity: stampOpacity }}
        >
          {dragX > 0 ? '✓ Approve' : '✕ Reject'}
        </div>
      )}
    </div>
  );
}
