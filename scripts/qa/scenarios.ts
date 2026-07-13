import { openCommandPalette, openEditorFixture, openLibraryFixture } from './fixtures';
import type { QaScenario } from './model';

const browserDefaults = {
  artifactContracts: [],
  requiredCapabilities: ['browser-tauri-harness'],
} as const;

const libraryScaleScenario = (imageCount: 10_000 | 50_000 | 100_000): QaScenario => ({
  ...browserDefaults,
  id: `browser.library.open-${imageCount / 1_000}k`,
  tags: ['browser', 'library', 'scale'],
  dependencies: [],
  fixture: { id: 'library' },
  isolation: 'fresh-context',
  timeoutMs: 120_000,
  async run({ page }) {
    await openLibraryFixture(page, imageCount);
    const plainCount = String(imageCount);
    const groupedCount = imageCount.toLocaleString('en-US');
    await page.getByText(new RegExp(`^(?:${plainCount}|${groupedCount}) assets$`, 'u')).waitFor({ timeout: 90_000 });
    await page.getByTestId('library-header-workflow-status').waitFor();
    const pageCalls = await page.evaluate(
      () =>
        (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? []).filter(
          ({ command }) => command === 'next_library_collection_page',
        ).length,
    );
    const expectedPageCalls = Math.ceil(imageCount / 256) - 1;
    if (pageCalls !== expectedPageCalls)
      throw new Error(`Catalog pagination mismatch: ${pageCalls} != ${expectedPageCalls} for ${imageCount} images.`);
  },
});

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
  ...([10_000, 50_000, 100_000] as const).map(libraryScaleScenario),
  {
    ...browserDefaults,
    id: 'browser.library.search-filter-sort',
    tags: ['browser', 'library', 'search', 'filter', 'sort'],
    dependencies: [],
    fixture: { id: 'library' },
    isolation: 'fresh-context',
    timeoutMs: 60_000,
    async run({ page }) {
      await openLibraryFixture(page, 10_000);
      const search = page.locator('header input[type="text"]');
      await search.focus();
      await search.fill('browser-harnessz-010000');
      await page.getByRole('button', { name: /browser-harnessz-010000\.ARW/u }).waitFor();
      await search.fill('');
      await page.locator('button[aria-haspopup="true"]').click();
      const dateSort = page.getByRole('menuitem', { name: 'Date Modified' });
      await dateSort.click();
      if (!(await dateSort.getAttribute('class'))?.includes('bg-card-active'))
        throw new Error('Library sort did not settle on Date Modified.');
      await page.locator('button[data-tooltip="5 only"]').click();
      await page.getByText('No images found that match your filter.', { exact: true }).waitFor();
    },
  },
  {
    ...browserDefaults,
    id: 'browser.library.thumbnail-scroll',
    tags: ['browser', 'library', 'scroll', 'thumbnail'],
    dependencies: [],
    fixture: { id: 'library' },
    isolation: 'fresh-context',
    timeoutMs: 60_000,
    async run({ page }) {
      await openLibraryFixture(page, 10_000);
      const grid = page.getByTestId('library-virtualized-grid');
      const scrollResult = await grid.evaluate(async (root) => {
        const scroller = [...root.querySelectorAll('div')].find(
          (element): element is HTMLDivElement =>
            element instanceof HTMLDivElement && element.scrollHeight > element.clientHeight,
        );
        if (scroller === undefined) throw new Error('Virtualized library scroll surface missing.');
        for (const fraction of [0.2, 0.55, 0.9, 1]) {
          scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * fraction;
          scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        return {
          clientHeight: scroller.clientHeight,
          scrollHeight: scroller.scrollHeight,
          scrollTop: scroller.scrollTop,
        };
      });
      if (scrollResult.scrollTop <= 0 || scrollResult.scrollHeight <= scrollResult.clientHeight)
        throw new Error('High-velocity library scroll did not reach a later viewport.');
      await page.waitForFunction(() =>
        [...document.querySelectorAll('[data-image-path]')].some((element) =>
          /browser-harnessz-0(?:9\d{4}|10000)\.ARW$/u.test(element.getAttribute('data-image-path') ?? ''),
        ),
      );
    },
  },
  {
    ...browserDefaults,
    id: 'browser.library.sidecar-change',
    tags: ['browser', 'library', 'sidecar', 'changefeed'],
    dependencies: [],
    fixture: { id: 'library' },
    isolation: 'fresh-context',
    timeoutMs: 45_000,
    async run({ page }) {
      await openLibraryFixture(page);
      await page.waitForFunction(() =>
        (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? []).some(
          ({ command }) => command === 'configure_library_changefeed',
        ),
      );
      await page.evaluate(() => {
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.emitEvent('library-filesystem-change-batch', {
          catalogRevisionAfter: 2,
          catalogRevisionBefore: 0,
          changes: [
            {
              class: 'sidecar',
              kind: 'modified',
              path: '/tmp/rawengine-browser-harness/browser-harness.ARW.xmp',
            },
          ],
          overflowed: false,
          requiresReconcile: false,
          rootId: '/tmp/rawengine-browser-harness',
          watchGeneration: 1,
        });
      });
      await page.waitForFunction(() => {
        const commands = (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? []).map(({ command }) => command);
        return commands.includes('apply_library_catalog_changes') && commands.includes('get_library_folder_aggregates');
      });
    },
  },
  {
    ...browserDefaults,
    id: 'browser.library.folder-tree-expand',
    tags: ['browser', 'library', 'folder-tree'],
    dependencies: [],
    fixture: { id: 'library' },
    isolation: 'fresh-context',
    timeoutMs: 45_000,
    async run({ page }) {
      await openLibraryFixture(page);
      await page
        .getByRole('button', { name: /Expand folder Alaska/u })
        .first()
        .click();
      await page.getByRole('button', { name: /Select folder Selects/u }).waitFor();
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
    id: 'browser.editor.culling-navigation',
    tags: ['browser', 'editor', 'navigation', 'culling'],
    dependencies: [],
    fixture: { id: 'editor' },
    isolation: 'fresh-context',
    timeoutMs: 45_000,
    async run({ page }) {
      await openEditorFixture(page);
      const summary = page.getByTestId('filmstrip-selection-summary');
      const waitForActive = (filename: string) =>
        page.waitForFunction(
          (expected) =>
            document
              .querySelector('[data-testid="filmstrip-selection-summary"]')
              ?.getAttribute('data-active-filename') === expected,
          filename,
        );
      await waitForActive('browser-harness.ARW');
      await page.keyboard.press('ArrowRight');
      await waitForActive('browser-harness-2.ARW');
      await page.keyboard.press('ArrowRight');
      await waitForActive('browser-harness-3.ARW');
      await page.keyboard.press('ArrowLeft');
      await waitForActive('browser-harness-2.ARW');
      if ((await summary.getAttribute('data-selected-count')) !== '1')
        throw new Error('Sequential navigation did not retain a single active selection.');
      const loadPaths = await page.evaluate(() =>
        (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [])
          .filter(({ command }) => command === 'begin_image_open')
          .map(({ args }) => {
            const request = args?.request;
            return typeof request === 'object' && request !== null && 'path' in request
              ? Reflect.get(request, 'path')
              : undefined;
          }),
      );
      for (const suffix of ['browser-harness-2.ARW', 'browser-harness-3.ARW'])
        if (!loadPaths.some((path) => typeof path === 'string' && path.endsWith(suffix)))
          throw new Error(`Sequential navigation did not load ${suffix}.`);
    },
  },
  {
    ...browserDefaults,
    id: 'browser.editor.exposure-flood',
    tags: ['browser', 'editor', 'adjustments', 'exposure'],
    dependencies: [],
    fixture: { id: 'editor' },
    isolation: 'fresh-context',
    timeoutMs: 45_000,
    async run({ page }) {
      await openEditorFixture(page);
      await page.locator('[data-panel-id="adjustments"]').first().click();
      const exposure = page.getByTestId('basic-control-exposure-range');
      await exposure.waitFor();
      for (const value of ['0.1', '0.25', '0.5', '0.8', '1', '0.65', '0.35', '0.15']) await exposure.fill(value);
      if ((await exposure.inputValue()) !== '0.15')
        throw new Error('Exposure flood did not settle on its terminal value.');
      await page.waitForFunction(() =>
        (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? []).some(
          ({ command }) => command === 'apply_adjustments',
        ),
      );
      const adjustmentCalls = await page.evaluate(
        () =>
          (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? []).filter(
            ({ command }) => command === 'apply_adjustments',
          ).length,
      );
      if (adjustmentCalls === 0) throw new Error('Exposure flood produced no preview adjustment work.');
    },
  },
  {
    ...browserDefaults,
    id: 'browser.editor.pan-zoom',
    tags: ['browser', 'editor', 'presentation', 'pan-zoom'],
    dependencies: [],
    fixture: { id: 'editor' },
    isolation: 'fresh-context',
    timeoutMs: 45_000,
    async run({ page }) {
      await openEditorFixture(page);
      const preview = page.getByTestId('editor-image-preview-panel');
      const initialScale = Number(await preview.getAttribute('data-editor-transform-scale'));
      await page.keyboard.press('ArrowUp');
      await page.waitForFunction(
        (scale) =>
          Number(
            document
              .querySelector('[data-testid="editor-image-preview-panel"]')
              ?.getAttribute('data-editor-transform-scale'),
          ) > scale,
        initialScale,
      );
      const box = await preview.boundingBox();
      if (box === null) throw new Error('Editor preview has no presentation bounds.');
      await page.keyboard.down('Space');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 24, { steps: 4 });
      await page.mouse.up();
      await page.keyboard.up('Space');
      const position = await preview.evaluate((element) => ({
        x: Number(element.getAttribute('data-editor-transform-position-x')),
        y: Number(element.getAttribute('data-editor-transform-position-y')),
      }));
      if (position.x === 0 && position.y === 0) throw new Error('Pan gesture did not move the zoomed preview.');
      if ((await preview.getAttribute('data-viewer-gesture-state')) !== 'idle')
        throw new Error('Pan/zoom presentation did not settle after the gesture.');
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
