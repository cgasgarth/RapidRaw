import type { AsymmetricMatchers, Matchers } from 'bun:test';
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module 'bun:test' {
  interface Matchers<T> extends TestingLibraryMatchers<Matchers<unknown>, T> {}
  interface AsymmetricMatchers extends TestingLibraryMatchers<Matchers<unknown>, unknown> {}
}
