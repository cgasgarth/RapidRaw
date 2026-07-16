import { afterEach, expect } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';

GlobalRegistrator.register({ url: 'http://localhost/' });

expect.extend(matchers);

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});
