import { afterAll, afterEach, expect } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import * as matchers from '@testing-library/jest-dom/matchers';
import { act, cleanup } from '@testing-library/react';

GlobalRegistrator.register({ url: 'http://localhost/' });

expect.extend(matchers);

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

afterAll(async () => {
  if (!GlobalRegistrator.isRegistered) return;
  // Drain queued React scheduler work while Window still exists, then let
  // Happy DOM close every timer and restore the worker global.
  await act(async () => {});
  await GlobalRegistrator.unregister();
});
