import type { Route } from '@playwright/test';

export const CLERK_ACCOUNTS_ROUTE = 'https://*.clerk.accounts.dev/**';

type BrowserProofRoute = Pick<Route, 'fulfill'>;

export interface BrowserRouteRegistrar {
  route(pattern: string, handler: (route: BrowserProofRoute) => Promise<void>): Promise<unknown>;
}

const fulfillOfflineClerkRequest = (route: BrowserProofRoute): Promise<void> =>
  route.fulfill({
    body: '{}',
    contentType: 'application/json',
    status: 200,
  });

export const installBrowserProofNetworkBoundary = async (page: BrowserRouteRegistrar): Promise<void> => {
  await page.route(CLERK_ACCOUNTS_ROUTE, fulfillOfflineClerkRequest);
};
