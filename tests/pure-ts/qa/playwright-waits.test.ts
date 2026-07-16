import { expect, test } from 'bun:test';
import { chromium } from '@playwright/test';

import { waitForPageCondition } from '../../../scripts/lib/playwright-waits';

test('applies a no-argument page-condition timeout instead of serializing it as predicate data', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(800);
    const startedAt = performance.now();
    let rejected = false;

    try {
      await waitForPageCondition(page, () => false, { polling: 10, timeout: 75 });
    } catch {
      rejected = true;
    }

    const elapsedMs = performance.now() - startedAt;
    expect(rejected).toBe(true);
    expect(elapsedMs).toBeGreaterThanOrEqual(50);
    expect(elapsedMs).toBeLessThan(400);
  } finally {
    await browser.close();
  }
}, 5_000);
