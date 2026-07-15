#!/usr/bin/env bun

import type { Page } from '@playwright/test';
import { z } from 'zod';

import { runExportUiCheck } from '../../../../scripts/lib/proofs/export-ui-check.ts';
import { exportRecipeSchema } from '../../../../src/schemas/export/exportRecipeSchemas.ts';

const settingsStorageKey = 'rawengine-browser-tauri-harness-settings-v1';
const incompleteRecipe = {
  fileFormat: 'jpeg',
  id: 'default-hq',
  name: 'High Quality needs review',
};

await runExportUiCheck({
  label: 'current export recipe recovery',
  settings: { exportPresets: [incompleteRecipe] },
  run: async (page) => {
    const summary = page.getByTestId('export-recipe-readiness-summary');
    await summary.waitFor({ timeout: 10_000 });
    if (!(await summary.innerText()).includes('0 valid')) {
      throw new Error('Incomplete persisted recipe was not visibly invalid.');
    }

    const invalidRow = page.locator('[data-recipe-state="invalid"]');
    await invalidRow.waitFor({ timeout: 10_000 });
    if ((await invalidRow.getAttribute('aria-pressed')) !== 'false') {
      throw new Error('Incomplete persisted recipe became the active export recipe.');
    }
    await invalidRow.click();
    if (
      (await invalidRow.getAttribute('aria-pressed')) !== 'false' ||
      (await invalidRow.getAttribute('data-repair-target')) !== 'true'
    ) {
      throw new Error('Incomplete persisted recipe must stay inactive while selected only for explicit repair.');
    }

    const beforeRepair = await readPersistedRecipes(page);
    if (JSON.stringify(beforeRepair) !== JSON.stringify([incompleteRecipe])) {
      throw new Error('Reading or selecting an incomplete recipe silently rewrote it.');
    }

    await page.getByRole('button', { name: 'Overwrite selected preset' }).click();
    await page.locator('[data-recipe-state="ready"][aria-pressed="true"]').waitFor({ timeout: 10_000 });
    const repaired = exportRecipeSchema.parse((await readPersistedRecipes(page))[0]);
    if (repaired.id !== incompleteRecipe.id || repaired.name !== incompleteRecipe.name) {
      throw new Error('Explicit repair did not preserve the selected recipe identity.');
    }

    await page.getByRole('button', { name: 'Save current settings as new preset' }).click();
    await page.getByRole('textbox', { name: 'Preset Name' }).fill('Duplicate current recipe');
    await page.getByRole('textbox', { name: 'Preset Name' }).press('Enter');
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="export-recipe-readiness-summary"]')?.textContent?.includes('2 valid'),
    );
    const duplicated = (await readPersistedRecipes(page)).map((value) => exportRecipeSchema.parse(value));
    if (duplicated.length !== 2 || !duplicated.some((recipe) => recipe.name === 'Duplicate current recipe')) {
      throw new Error('Save-as-new did not persist a complete current duplicate.');
    }

    await page.getByRole('slider', { name: 'Quality' }).fill('87');
    await page.getByRole('button', { name: 'Overwrite selected preset' }).click();
    const edited = (await readPersistedRecipes(page))
      .map((value) => exportRecipeSchema.parse(value))
      .find((recipe) => recipe.name === 'Duplicate current recipe');
    if (edited?.jpegQuality !== 87) {
      throw new Error('Editing and overwriting a custom recipe did not persist the complete current settings.');
    }

    await page.getByRole('button', { name: /Export Image/u }).click();
    await page.getByTestId('export-success-receipt').waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: 'TIFF' }).click({ force: true });
    await page.getByRole('button', { name: /Export Again/u }).click();
    await page.waitForFunction(() => {
      const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
      return calls.filter((call) => call.command === 'export_images').length >= 2;
    });
    const afterExports = (await readPersistedRecipes(page)).map((value) => exportRecipeSchema.parse(value));
    const lastUsed = afterExports.find((recipe) => recipe.id === '__last_used__');
    if (lastUsed?.fileFormat !== 'tiff' || lastUsed.jpegQuality !== 100 || lastUsed.lastExportPath === undefined) {
      throw new Error('JPEG/TIFF output did not persist a complete deterministic last-used current recipe.');
    }

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Continue Session/u }).click();
    await page
      .getByRole('button', { name: /browser-harness\.ARW/u })
      .first()
      .dblclick();
    await page.getByRole('button', { exact: true, name: 'Export' }).click();
    await page.locator('[data-recipe-state="ready"]').first().waitFor({ timeout: 10_000 });
    if (!(await page.getByTestId('export-recipe-readiness-summary').innerText()).includes('2 valid')) {
      throw new Error('Explicitly repaired current recipe did not survive restart and reopen.');
    }
  },
});

async function readPersistedRecipes(page: Page) {
  const settingsValue: unknown = await page.evaluate((key) => {
    const value = window.localStorage.getItem(key);
    return value === null ? null : JSON.parse(value);
  }, settingsStorageKey);
  const settings = z
    .object({ exportPresets: z.array(z.unknown()) })
    .loose()
    .parse(settingsValue);
  return settings.exportPresets;
}
