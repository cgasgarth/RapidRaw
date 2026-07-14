#!/usr/bin/env bun

import { exportHarnessRootPath, runExportUiCheck } from '../../../../scripts/lib/proofs/export-ui-check.ts';

await runExportUiCheck({
  label: 'export receipt layout',
  run: async (page) => {
    await page.getByText('File Settings').waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: 'TIFF' }).click({ force: true });
    await page.getByRole('button', { name: /Export Image/u }).click();

    const receipt = page.getByTestId('export-success-receipt');
    await receipt.waitFor({ timeout: 10_000 });
    await page
      .locator(`[data-testid="filmstrip-thumbnail"][data-image-path="${exportHarnessRootPath}/export.tif"]`)
      .waitFor({ timeout: 10_000 });
    await receipt.locator('summary').click();

    const detailsBox = await page.getByTestId('export-success-receipt-details').boundingBox();
    const actionsBox = await page.getByTestId('export-success-receipt-actions').boundingBox();
    const policyBox = await page.getByTestId('export-success-color-policy').boundingBox();
    const transformBox = await page.getByTestId('export-success-color-managed-transform').boundingBox();

    if (!detailsBox || detailsBox.width < 240) {
      throw new Error(`Receipt details column collapsed: ${detailsBox?.width ?? 'missing'}`);
    }
    if (!actionsBox || actionsBox.width < 240) {
      throw new Error(`Receipt actions row collapsed: ${actionsBox?.width ?? 'missing'}`);
    }
    if (!policyBox || policyBox.height > 36) {
      throw new Error(`Receipt policy text wrapped too tall: ${policyBox?.height ?? 'missing'}`);
    }
    if (!transformBox || transformBox.height > 36) {
      throw new Error(`Receipt transform text wrapped too tall: ${transformBox?.height ?? 'missing'}`);
    }

    const collectionRefreshPaths = await page.evaluate(() => {
      const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
      return calls.filter((call) => call.command === 'open_library_collection').map((call) => call.args?.path);
    });
    if (collectionRefreshPaths.length < 2 || collectionRefreshPaths.at(-1) !== exportHarnessRootPath) {
      throw new Error(
        `Expected export completion to reopen ${exportHarnessRootPath}; saw ${JSON.stringify(collectionRefreshPaths)}.`,
      );
    }

    await page.getByRole('button', { name: /Back to Library/u }).click();
    await page
      .locator(`[data-testid="library-thumbnail"][data-image-path="${exportHarnessRootPath}/export.tif"]`)
      .waitFor({ timeout: 10_000 });
  },
});
