import type { Page } from '@playwright/test';

export interface PageConditionWaitOptions {
  polling?: number | 'raf';
  timeout?: number;
}

/** Wait for a page condition that does not consume a serialized predicate argument. */
export async function waitForPageCondition(
  page: Page,
  predicate: () => boolean | Promise<boolean>,
  options?: PageConditionWaitOptions,
): Promise<void> {
  const handle = await page.waitForFunction(predicate, undefined, options);
  await handle.dispose();
}
