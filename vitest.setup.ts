import '@testing-library/jest-dom/vitest';

// This setup file runs for every test, including the pure-function lib/*
// tests that intentionally use the fast 'node' environment (no DOM at all)
// — guard everything below on a DOM actually being present, since `Element`
// doesn't exist there.
if (typeof Element !== 'undefined') {
  // jsdom doesn't implement this — dnd-kit's DndContext touches it while
  // measuring draggable/droppable nodes, even for tests that never simulate
  // an actual drag.
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  if (typeof Element.prototype.scrollIntoView === 'undefined') {
    Element.prototype.scrollIntoView = () => {};
  }
  // Sonner (swipe-to-dismiss) and Radix (touch/drag interactions) both use
  // the Pointer Capture API, which jsdom doesn't implement.
  if (typeof Element.prototype.setPointerCapture === 'undefined') {
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.hasPointerCapture = () => false;
  }
}
