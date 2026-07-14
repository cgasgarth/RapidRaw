#!/usr/bin/env bun

import { runExportUiCheck } from '../../../../scripts/lib/proofs/export-ui-check.ts';

await runExportUiCheck({
  label: 'export single panel editor',
  run: async (page) => {
    await page.getByRole('button', { name: /Export Image/u }).waitFor({ timeout: 10_000 });

    const exportButtonCount = await page.getByRole('button', { name: /Export Image/u }).count();
    if (exportButtonCount !== 1) {
      throw new Error(`Expected one editor export action, found ${exportButtonCount}`);
    }

    const noImagesSelectedCount = await page.getByText('No images selected.').count();
    if (noImagesSelectedCount !== 0) {
      throw new Error('Library export panel is still mounted in editor mode.');
    }
  },
});
