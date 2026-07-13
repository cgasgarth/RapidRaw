import type { Page } from '@playwright/test';
import type { QaScenario } from './model';

async function openLibrary(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'RapidRAW' }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: /Open Folder/u }).click();
  await page
    .getByRole('button', { name: /browser-harness\.ARW/u })
    .first()
    .waitFor();
}

async function openEditor(page: Page): Promise<void> {
  await openLibrary(page);
  await page
    .getByRole('button', { name: /browser-harness\.ARW/u })
    .first()
    .dblclick();
  await page.getByRole('main', { name: 'Editor workspace' }).waitFor();
  await page.getByTestId('image-canvas').waitFor();
}

export const qaScenarios: readonly QaScenario[] = [
  {
    id: 'browser.library.open',
    tags: ['browser', 'library'],
    dependencies: [],
    fixture: { id: 'empty' },
    isolation: 'fresh-context',
    timeoutMs: 45_000,
    async run({ page }) {
      await openLibrary(page);
    },
  },
  {
    id: 'browser.editor.chrome',
    tags: ['browser', 'editor', 'accessibility'],
    dependencies: [],
    fixture: { id: 'editor' },
    isolation: 'fresh-context',
    timeoutMs: 45_000,
    async run({ page }) {
      await openEditor(page);
      await page.getByRole('region', { name: 'Editor preview' }).waitFor();
      const unlabeled = await page
        .locator('button')
        .evaluateAll(
          (buttons) =>
            buttons.filter(
              (button) =>
                !button.textContent?.trim() && !button.getAttribute('aria-label') && !button.getAttribute('title'),
            ).length,
        );
      if (unlabeled > 0) throw new Error(`${unlabeled} icon buttons lack accessible labels.`);
    },
  },
  {
    id: 'browser.editor.compare',
    tags: ['browser', 'editor', 'compare'],
    dependencies: [],
    fixture: { id: 'editor' },
    isolation: 'fresh-context',
    timeoutMs: 45_000,
    async run({ page }) {
      await openEditor(page);
      await page.getByTestId('editor-command-overflow-trigger').click();
      await page.getByRole('menuitemcheckbox', { name: /Compare split wipe/u }).click();
      const mode = await page.getByTestId('image-canvas').getAttribute('data-editor-compare-mode');
      if (mode !== 'split-wipe') throw new Error(`Expected split-wipe, received ${mode ?? 'null'}.`);
    },
  },
  {
    id: 'browser.editor.crop',
    tags: ['browser', 'editor', 'crop'],
    dependencies: [],
    fixture: { id: 'editor' },
    isolation: 'fresh-context',
    timeoutMs: 45_000,
    async run({ page }) {
      await openEditor(page);
      await page.keyboard.press('Control+K');
      await page.getByRole('button', { name: /Show crop tools/u }).click();
      await page.getByRole('heading', { name: 'Crop' }).waitFor();
    },
  },
  {
    id: 'browser.negative-lab.modal',
    tags: ['browser', 'editor', 'negative-lab'],
    dependencies: [],
    fixture: { id: 'editor' },
    isolation: 'fresh-context',
    timeoutMs: 45_000,
    async run({ page }) {
      await openEditor(page);
      await page.keyboard.press('Control+K');
      await page.getByLabel(/Search commands/u).fill('negative');
      await page.getByRole('button', { name: /Open negative lab/u }).click();
      await page.getByTestId('negative-lab-preview-image').waitFor();
    },
  },
] as const;
