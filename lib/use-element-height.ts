'use client';

import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Live height of a DOM element via ResizeObserver — for UI that has to sit
 * below content whose height isn't a constant (a header that wraps
 * differently per page, viewport width, or stream/display-name length).
 * Returns null until the first measurement lands.
 */
export function useElementHeight<T extends HTMLElement>(ref: RefObject<T | null>): number | null {
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const apply = (next: number) => setHeight((prev) => (prev === next ? prev : next));

    // ResizeObserver's own first callback is tied to the browser's render/
    // compositor pipeline, so it can lag well behind mount in a backgrounded
    // or non-compositing tab. Measuring synchronously here means the first
    // real value is in place before paint either way; the observer's job is
    // then just keeping it current as the element's height actually changes.
    apply(el.getBoundingClientRect().height);

    const observer = new ResizeObserver(([entry]) => apply(entry.contentRect.height));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return height;
}
