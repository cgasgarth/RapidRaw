import { openCommandPalette, openEditorFixture, openLibraryFixture } from './fixtures';
import type { QaScenario } from './model';

const browserDefaults = {
  artifactContracts: [],
  requiredCapabilities: ['browser-tauri-harness'],
} as const;

export const qaScenarios: readonly QaScenario[] = [
  {
    ...browserDefaults,
    id: 'browser.library.open',
    tags: ['browser', 'library'],
    dependencies: [],
    fixture: { id: 'empty' },
    isolation: 'fresh-context',
    timeoutMs: 45_000,
    async run({ page }) {
      await openLibraryFixture(page);
    },
  },
  {
    ...browserDefaults,
    id: 'browser.editor.chrome',
    tags: ['browser', 'editor', 'accessibility'],
    dependencies: [],
    fixture: { id: 'editor' },
    isolation: 'fresh-context',
    timeoutMs: 45_000,
    async run({ page }) {
      await openEditorFixture(page);
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
    ...browserDefaults,
    id: 'browser.editor.navigation',
    tags: ['browser', 'editor', 'navigation'],
    dependencies: [],
    fixture: { id: 'editor' },
    isolation: 'fresh-context',
    timeoutMs: 45_000,
    async run({ page }) {
      await openEditorFixture(page);
      await page.getByRole('complementary', { name: 'Editor tools' }).waitFor();
      await page.getByRole('heading', { exact: true, name: 'Color' }).waitFor();
      await openCommandPalette(page);
      const palette = page.getByRole('dialog', { name: /Command Palette/u });
      await palette.getByLabel(/Search commands/u).fill('crop');
      await palette.getByRole('button', { name: /Show crop tools/u }).waitFor();
      await page.keyboard.press('Escape');
      await palette.waitFor({ state: 'detached' });
    },
  },
  {
    ...browserDefaults,
    id: 'browser.editor.compare',
    tags: ['browser', 'editor', 'compare'],
    dependencies: [],
    fixture: { id: 'editor' },
    isolation: 'fresh-context',
    timeoutMs: 45_000,
    async run({ page }) {
      await openEditorFixture(page);
      await page.getByTestId('editor-command-overflow-trigger').click();
      await page.getByRole('menuitemcheckbox', { name: /Compare split wipe/u }).click();
      const canvas = page.getByTestId('image-canvas');
      if ((await canvas.getAttribute('data-editor-compare-mode')) !== 'split-wipe')
        throw new Error('Split-wipe compare mode did not activate.');
      await page.getByTestId('editor-compare-split-divider').waitFor();
      await page.getByTestId('editor-command-overflow-trigger').click();
      await page.getByRole('menuitemcheckbox', { name: /Compare side by side/u }).click();
      if ((await canvas.getAttribute('data-editor-compare-mode')) !== 'side-by-side')
        throw new Error('Side-by-side compare mode did not activate.');
      await page.getByTestId('editor-compare-side-by-side-preview').waitFor();
    },
  },
  {
    ...browserDefaults,
    id: 'browser.editor.crop',
    tags: ['browser', 'editor', 'crop'],
    dependencies: [],
    fixture: { id: 'editor' },
    isolation: 'fresh-context',
    timeoutMs: 45_000,
    async run({ page }) {
      await openEditorFixture(page);
      await openCommandPalette(page);
      await page.getByRole('button', { name: /Show crop tools/u }).click();
      await page.getByRole('heading', { name: 'Crop' }).waitFor();
      await page.getByRole('button', { name: /Straighten Tool/u }).waitFor();
    },
  },
  {
    ...browserDefaults,
    id: 'browser.negative-lab.modal',
    tags: ['browser', 'editor', 'negative-lab'],
    dependencies: [],
    fixture: { id: 'editor' },
    isolation: 'fresh-context',
    timeoutMs: 45_000,
    async run({ page }) {
      await openEditorFixture(page);
      await openCommandPalette(page);
      await page.getByLabel(/Search commands/u).fill('negative');
      await page.getByRole('button', { name: /Open negative lab/u }).click();
      await page.getByTestId('negative-lab-preview-image').waitFor();
      await page.getByTestId('negative-lab-workspace').getByRole('button', { name: 'Cancel' }).click();
      await page.getByTestId('negative-lab-workspace').waitFor({ state: 'detached' });
    },
  },
  {
    ...browserDefaults,
    id: 'browser.editor.copy-paste-settings',
    tags: ['browser', 'editor', 'copy-paste', 'accessibility'],
    dependencies: [],
    fixture: { id: 'editor' },
    isolation: 'fresh-context',
    timeoutMs: 45_000,
    async run({ page }) {
      await openEditorFixture(page);
      await openCommandPalette(page);
      const palette = page.getByRole('dialog', { name: /Command Palette/u });
      await palette.getByLabel(/Search commands/u).fill('copy paste');
      await palette.getByRole('button', { name: /Copy and paste settings/u }).click();
      const dialog = page.getByRole('dialog', { name: /Copy & Paste Settings/u });
      await dialog.getByText('Dust Spot Visualization').waitFor();
      if ((await dialog.getByText('DustSpotVisualization').count()) !== 0)
        throw new Error('Copy & Paste Settings exposed an internal identifier.');
      const save = dialog.getByRole('button', { name: 'Save' });
      const box = await save.boundingBox();
      if (box === null || box.y < 0 || box.y + box.height > 720)
        throw new Error('Copy & Paste Settings Save is outside the constrained viewport.');
    },
  },
  {
    ...browserDefaults,
    id: 'browser.harness.command-contract',
    tags: ['browser', 'terminal-proof'],
    dependencies: [],
    artifactContracts: [{ id: 'harness-command-contract', kind: 'terminal-assertion', required: true }],
    fixture: { id: 'editor' },
    isolation: 'fresh-context',
    timeoutMs: 45_000,
    async run({ page, recordArtifact }) {
      await openEditorFixture(page);
      const proof = await page.evaluate(() => ({
        calls: window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.map((call) => call.command) ?? [],
        enabled: window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.enabled === true,
        hasTauriInternals: window.__TAURI_INTERNALS__ !== undefined,
      }));
      if (!proof.enabled || !proof.hasTauriInternals) throw new Error('Browser Tauri harness is not installed.');
      for (const command of ['load_settings', 'get_supported_file_types', 'plugin:dialog|open', 'get_folder_tree'])
        if (!proof.calls.includes(command)) throw new Error(`Browser harness did not record ${command}.`);
      recordArtifact({ id: 'harness-command-contract', kind: 'terminal-assertion' });
    },
  },
] as const;
