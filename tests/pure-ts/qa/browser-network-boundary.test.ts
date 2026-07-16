import { expect, mock, test } from 'bun:test';
import type { Route } from '@playwright/test';

import {
  type BrowserRouteRegistrar,
  CLERK_ACCOUNTS_ROUTE,
  installBrowserProofNetworkBoundary,
} from '../../../scripts/qa/browser-network-boundary';

test('stubs every Clerk accounts request before browser proof navigation', async () => {
  const fulfill = mock(async (_options: Parameters<Route['fulfill']>[0]) => {});
  let registeredPattern: string | undefined;
  let registeredHandler: Parameters<BrowserRouteRegistrar['route']>[1] | undefined;
  const page: BrowserRouteRegistrar = {
    route: mock(async (pattern, handler) => {
      registeredPattern = pattern;
      registeredHandler = handler;
    }),
  };

  await installBrowserProofNetworkBoundary(page);
  expect(registeredPattern).toBe(CLERK_ACCOUNTS_ROUTE);
  expect(registeredPattern).toBe('https://*.clerk.accounts.dev/**');
  expect(registeredHandler).toBeDefined();

  await registeredHandler?.({ fulfill });
  expect(fulfill).toHaveBeenCalledWith({
    body: '{}',
    contentType: 'application/json',
    status: 200,
  });
});
