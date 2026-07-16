import { afterEach, expect } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';

GlobalRegistrator.register({ url: 'http://localhost/' });

// Suites outside tests/pure-ts/ui still own specialized DOM fixtures. Keep only
// the browser bindings they replace writable while they migrate to this harness.
for (const key of [
  'Blob',
  'DOMRectReadOnly',
  'document',
  'Element',
  'Event',
  'HTMLElement',
  'HTMLDetailsElement',
  'HTMLDivElement',
  'HTMLImageElement',
  'Image',
  'localStorage',
  'navigator',
  'Node',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'ResizeObserver',
  'SVGImageElement',
  'window',
] as const) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
  if (descriptor?.configurable !== true) continue;
  Object.defineProperty(globalThis, key, {
    configurable: true,
    enumerable: descriptor.enumerable,
    value: Reflect.get(globalThis, key),
    writable: true,
  });
}

expect.extend(matchers);

afterEach(() => {
  cleanup();
  if (typeof document !== 'undefined') document.body.replaceChildren();
});
