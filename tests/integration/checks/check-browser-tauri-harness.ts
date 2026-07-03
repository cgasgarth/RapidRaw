#!/usr/bin/env bun

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { chromium, type Locator, type Page } from '@playwright/test';

const host = '127.0.0.1';
const port = 1420;
const baseUrl = `http://${host}:${port}`;
const viewport = { height: 720, width: 1280 };
const boundsReportPath = resolve(
  'private-artifacts/validation/preview-bounds/browser-tauri-harness-bounds-report.json',
);
const failureScreenshotPath = resolve('private-artifacts/validation/preview-bounds/browser-tauri-harness-failure.png');

interface ElementBoundsSnapshot {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}

interface BoundsSample {
  elements: Record<string, ElementBoundsSnapshot | null>;
  failures: string[];
  label: string;
  viewport: typeof viewport;
}

interface BoundsReport {
  generatedAt: string;
  samples: BoundsSample[];
  scenario: string;
  status: 'failed' | 'passed';
  viewport: typeof viewport;
}

const boundsSamples: BoundsSample[] = [];

async function waitForDevServer(server: ReturnType<typeof spawn>): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 45_000) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`Vite exited before ${baseUrl} became available.`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (server.exitCode !== null || server.signalCode !== null) {
          throw new Error(`Vite exited after ${baseUrl} became available.`);
        }
        const confirmation = await fetch(baseUrl);
        if (confirmation.ok) return;
      }
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for Vite at ${baseUrl}`);
}

async function stopServer(server: ReturnType<typeof spawn>): Promise<void> {
  if (server.exitCode !== null || server.signalCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => {
      server.once('exit', resolve);
    }),
    new Promise((resolve) =>
      setTimeout(() => {
        server.kill('SIGKILL');
        resolve(undefined);
      }, 5_000),
    ),
  ]);
}

const server = spawn('bun', ['run', 'dev', '--', '--host', host], {
  env: { ...process.env },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
const captureServerOutput = (chunk: Buffer) => {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-4_000);
};
server.stdout.on('data', captureServerOutput);
server.stderr.on('data', captureServerOutput);

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let page: Page | undefined;

try {
  await waitForDevServer(server);
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport });
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });
  await page.route('https://api.github.com/repos/CyberTimon/RapidRAW/releases/latest', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        html_url: 'https://github.com/CyberTimon/RapidRAW/releases/latest',
        tag_name: 'v0.0.0-browser-harness',
      },
      status: 200,
    });
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'RapidRAW' }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: /Open Folder/u }).click();
  await page
    .getByRole('button', { name: /browser-harness\.ARW/u })
    .first()
    .waitFor({ timeout: 10_000 });
  await page
    .getByRole('button', { name: /browser-harness\.ARW/u })
    .first()
    .dblclick();
  await page.getByRole('main', { name: 'Editor workspace' }).waitFor({ timeout: 10_000 });
  await page.getByRole('region', { name: 'Editor preview' }).waitFor({ timeout: 10_000 });
  await page.getByRole('region', { name: 'Image preview' }).waitFor({ timeout: 10_000 });
  const imageCanvas = page.getByTestId('image-canvas');
  await imageCanvas.waitFor({ timeout: 10_000 });
  await verifyPreviewBoundsScenario(page, boundsSamples);
  const splitCompareButton = page.getByRole('button', { name: /Compare split wipe/u });
  const sideBySideCompareButton = page.getByRole('button', { name: /Compare side by side/u });
  await splitCompareButton.waitFor({ timeout: 10_000 });
  await sideBySideCompareButton.waitFor({ timeout: 10_000 });
  await splitCompareButton.click();
  await imageCanvas.waitFor({ timeout: 10_000 });
  if ((await imageCanvas.getAttribute('data-editor-compare-mode')) !== 'split-wipe') {
    throw new Error('Split-wipe compare mode did not activate on the image canvas.');
  }
  await page.getByTestId('editor-compare-split-divider').waitFor({ timeout: 10_000 });
  await sideBySideCompareButton.click();
  if ((await imageCanvas.getAttribute('data-editor-compare-mode')) !== 'side-by-side') {
    throw new Error('Side-by-side compare mode did not activate on the image canvas.');
  }
  await page.getByTestId('editor-compare-side-by-side-preview').waitFor({ timeout: 10_000 });
  await sideBySideCompareButton.click();
  if ((await imageCanvas.getAttribute('data-editor-compare-mode')) !== 'off') {
    throw new Error('Compare mode did not return to off after toggling side-by-side.');
  }
  await page.getByRole('complementary', { name: 'Editor tools' }).waitFor({ timeout: 10_000 });
  await page.getByRole('heading', { name: 'Color' }).waitFor({ timeout: 10_000 });
  await page.getByText(/1024 × 768/u).waitFor({ timeout: 10_000 });
  await page.keyboard.press('Control+K');
  await page.getByRole('dialog', { name: /Command Palette/u }).waitFor({ timeout: 10_000 });
  await page.getByRole('button', { name: /Show crop tools/u }).click();
  await page.getByRole('heading', { name: 'Crop' }).waitFor({ timeout: 10_000 });
  await page.getByRole('button', { name: /Straighten Tool/u }).waitFor({ timeout: 10_000 });
  await page.keyboard.press('Control+K');
  await page.getByRole('dialog', { name: /Command Palette/u }).waitFor({ timeout: 10_000 });
  await page.getByLabel(/Search commands/u).fill('negative');
  await page.getByRole('button', { name: /Open negative lab/u }).click();
  await page.getByRole('heading', { name: 'Negative Conversion' }).waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-preview-image').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-workspace').getByRole('button', { name: 'Cancel' }).click();
  await page.getByTestId('negative-lab-workspace').waitFor({ state: 'detached', timeout: 10_000 });
  await page.keyboard.press('Control+K');
  const commandPaletteForCopyPaste = page.getByRole('dialog', { name: /Command Palette/u });
  await commandPaletteForCopyPaste.waitFor({ timeout: 10_000 });
  await commandPaletteForCopyPaste.getByLabel(/Search commands/u).fill('copy paste');
  await commandPaletteForCopyPaste.getByRole('button', { name: /Copy and paste settings/u }).click();
  const copyPasteDialog = page.getByRole('dialog', { name: /Copy & Paste Settings/u });
  await copyPasteDialog.waitFor({ timeout: 10_000 });
  await copyPasteDialog.getByText('Dust Spot Visualization').waitFor({ timeout: 10_000 });
  if ((await copyPasteDialog.getByText('DustSpotVisualization').count()) > 0) {
    throw new Error('Copy & Paste Settings leaked the dust spot internal identifier.');
  }
  const saveButton = copyPasteDialog.getByRole('button', { name: 'Save' });
  await saveButton.waitFor({ timeout: 10_000 });
  const saveBox = await saveButton.boundingBox();
  if (saveBox === null || saveBox.y + saveBox.height > 720 || saveBox.y < 0) {
    throw new Error('Copy & Paste Settings Save button is outside the constrained viewport.');
  }
  const unlabeledIconButtons = await page.locator('button').evaluateAll((buttons) =>
    buttons
      .map((button, index) => {
        const rect = button.getBoundingClientRect();
        const label =
          button.getAttribute('aria-label')?.trim() ||
          button.getAttribute('title')?.trim() ||
          button.textContent?.trim() ||
          '';
        const isDecorativeDisabledIndicator =
          button.disabled && button.classList.contains('cursor-default') && button.classList.contains('bg-transparent');
        return {
          index,
          isDecorativeDisabledIndicator,
          label,
          visible: rect.width > 0 && rect.height > 0,
        };
      })
      .filter((button) => button.visible && button.label.length === 0 && !button.isDecorativeDisabledIndicator)
      .map((button) => button.index),
  );
  if (unlabeledIconButtons.length > 0) {
    throw new Error(`Visible icon buttons missing accessible names: ${unlabeledIconButtons.join(', ')}`);
  }

  const harnessProof = await page.evaluate(() => ({
    calls: window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.map((call) => call.command) ?? [],
    enabled: window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.enabled === true,
    hasTauriInternals: window.__TAURI_INTERNALS__ !== undefined,
  }));
  if (!harnessProof.enabled || !harnessProof.hasTauriInternals) {
    throw new Error('Browser Tauri harness was not installed.');
  }
  for (const requiredCommand of [
    'load_settings',
    'get_supported_file_types',
    'plugin:dialog|open',
    'get_folder_tree',
    'load_metadata',
    'load_image',
    'apply_adjustments',
    'generate_original_transformed_preview',
  ]) {
    if (!harnessProof.calls.includes(requiredCommand)) {
      throw new Error(`Browser Tauri harness did not record ${requiredCommand}.`);
    }
  }
  const actionableErrors = consoleErrors.filter(
    (message) =>
      !message.includes('React does not recognize the') &&
      !message.includes('Clerk:') &&
      !message.includes('[vite] failed to connect to websocket') &&
      !message.includes('Failed to send error to Vite server') &&
      !message.includes("WebSocket connection to 'ws://127.0.0.1:1420/"),
  );
  if (actionableErrors.length > 0) {
    throw new Error(`Unexpected browser harness console errors: ${actionableErrors.slice(0, 5).join(' | ')}`);
  }
  console.log('browser tauri harness ok');
} catch (error) {
  console.error('browser tauri harness failed');
  if (page !== undefined) {
    await writeBoundsReport('failed');
    await page.screenshot({ fullPage: false, path: failureScreenshotPath }).catch(() => undefined);
    console.error(
      `bounds evidence: ${relative(process.cwd(), boundsReportPath)}; screenshot: ${relative(
        process.cwd(),
        failureScreenshotPath,
      )}`,
    );
  }
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer(server);
}

async function verifyPreviewBoundsScenario(page: Page, samples: BoundsSample[]): Promise<void> {
  const previewPanel = page.getByTestId('editor-image-preview-panel');
  const zoomSlider = page.getByTestId('editor-bottom-bar-zoom-slider');
  await previewPanel.waitFor({ timeout: 10_000 });
  await zoomSlider.waitFor({ timeout: 10_000 });
  await waitForStablePreview(page);

  samples.push(await collectBoundsSample(page, 'fit-after-image-select'));
  await assertLatestBoundsSample(samples);

  await page.keyboard.press('Meta+=');
  await waitForStablePreview(page);
  samples.push(await collectBoundsSample(page, 'keyboard-zoom-in'));
  await assertLatestBoundsSample(samples);

  await page.keyboard.press('Meta+-');
  await waitForStablePreview(page);
  samples.push(await collectBoundsSample(page, 'keyboard-zoom-out'));
  await assertLatestBoundsSample(samples);

  await zoomSlider.evaluate((input) => {
    if (!(input instanceof HTMLInputElement)) throw new Error('Zoom slider test id did not resolve to an input.');
    input.value = '1.75';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await waitForStablePreview(page);
  samples.push(await collectBoundsSample(page, 'slider-zoom-175'));
  await assertLatestBoundsSample(samples);

  await page.getByTestId('editor-bottom-bar-zoom').getByRole('button').first().click();
  await waitForStablePreview(page);
  samples.push(await collectBoundsSample(page, 'reset-to-fit'));
  await assertLatestBoundsSample(samples);

  await writeBoundsReport('passed');
}

async function waitForStablePreview(page: Page): Promise<void> {
  await page.waitForTimeout(250);
  await page.getByTestId('image-canvas').waitFor({ timeout: 10_000 });
}

async function collectBoundsSample(page: Page, label: string): Promise<BoundsSample> {
  const elements = {
    bottomBarShell: await readBounds(page.getByTestId('editor-bottom-bar-shell')),
    firstFilmstripThumbnail: await readOptionalBounds(page.getByTestId('filmstrip-thumbnail').first()),
    imageCanvas: await readBounds(page.getByTestId('image-canvas')),
    previewContent: await readBounds(page.getByTestId('editor-image-preview-content')),
    previewPanel: await readBounds(page.getByTestId('editor-image-preview-panel')),
    previewRegion: await readBounds(page.getByTestId('editor-image-preview-region')),
    rightPanelShell: await readBounds(page.getByTestId('editor-right-panel-shell')),
    toolbarShell: await readBounds(page.getByTestId('editor-toolbar-shell')),
    workspace: await readBounds(page.getByTestId('editor-workspace')),
    zoomControls: await readBounds(page.getByTestId('editor-bottom-bar-zoom')),
    zoomSlider: await readBounds(page.getByTestId('editor-bottom-bar-zoom-slider')),
  };
  const failures = evaluateBounds(elements);
  return { elements, failures, label, viewport };
}

async function readBounds(locator: Locator): Promise<ElementBoundsSnapshot> {
  const box = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      height: rect.height,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      width: rect.width,
    };
  });
  return roundBounds(box);
}

async function readOptionalBounds(locator: Locator): Promise<ElementBoundsSnapshot | null> {
  if ((await locator.count()) === 0) return null;
  return readBounds(locator);
}

function roundBounds(bounds: ElementBoundsSnapshot): ElementBoundsSnapshot {
  return {
    bottom: round(bounds.bottom),
    height: round(bounds.height),
    left: round(bounds.left),
    right: round(bounds.right),
    top: round(bounds.top),
    width: round(bounds.width),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function evaluateBounds(elements: BoundsSample['elements']): string[] {
  const failures: string[] = [];
  const tolerance = 1;
  const viewportBoundedElements = [
    'bottomBarShell',
    'firstFilmstripThumbnail',
    'previewPanel',
    'previewRegion',
    'rightPanelShell',
    'toolbarShell',
    'workspace',
    'zoomControls',
    'zoomSlider',
  ];
  for (const name of viewportBoundedElements) {
    const bounds = elements[name];
    if (bounds === undefined || bounds === null) continue;
    if (bounds.width <= 0 || bounds.height <= 0) {
      failures.push(`${name} has no visible area (${bounds.width}x${bounds.height}).`);
    }
    if (bounds.top < -tolerance) failures.push(`${name} is clipped above viewport top (${bounds.top}).`);
    if (bounds.left < -tolerance) failures.push(`${name} is clipped left of viewport (${bounds.left}).`);
    if (bounds.right > viewport.width + tolerance) {
      failures.push(`${name} exceeds viewport right edge (${bounds.right} > ${viewport.width}).`);
    }
    if (bounds.bottom > viewport.height + tolerance) {
      failures.push(`${name} exceeds viewport bottom edge (${bounds.bottom} > ${viewport.height}).`);
    }
  }

  const previewPanel = elements.previewPanel;
  const previewRegion = elements.previewRegion;
  const bottomBarShell = elements.bottomBarShell;
  const zoomControls = elements.zoomControls;
  const zoomSlider = elements.zoomSlider;
  const firstFilmstripThumbnail = elements.firstFilmstripThumbnail;
  if (previewRegion !== null && previewPanel !== null && !containsBounds(previewRegion, previewPanel, tolerance)) {
    failures.push('preview panel is not fully contained by the preview region.');
  }
  if (bottomBarShell !== null && zoomControls !== null && !containsBounds(bottomBarShell, zoomControls, tolerance)) {
    failures.push('zoom controls are not fully contained by the bottom bar shell.');
  }
  if (zoomControls !== null && zoomSlider !== null && !containsBounds(zoomControls, zoomSlider, tolerance)) {
    failures.push('zoom slider is not fully contained by the zoom controls.');
  }
  if (
    bottomBarShell !== null &&
    firstFilmstripThumbnail !== null &&
    !containsBounds(bottomBarShell, firstFilmstripThumbnail, tolerance)
  ) {
    failures.push('first filmstrip thumbnail is not fully contained by the bottom bar shell.');
  }
  if (zoomControls !== null && firstFilmstripThumbnail !== null && overlaps(zoomControls, firstFilmstripThumbnail)) {
    failures.push('zoom controls overlap the filmstrip thumbnails.');
  }

  return failures;
}

function containsBounds(container: ElementBoundsSnapshot, child: ElementBoundsSnapshot, tolerance: number): boolean {
  return (
    child.top >= container.top - tolerance &&
    child.left >= container.left - tolerance &&
    child.right <= container.right + tolerance &&
    child.bottom <= container.bottom + tolerance
  );
}

function overlaps(left: ElementBoundsSnapshot, right: ElementBoundsSnapshot): boolean {
  return left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
}

async function assertLatestBoundsSample(samples: BoundsSample[]): Promise<void> {
  const latest = samples.at(-1);
  if (!latest || latest.failures.length === 0) return;
  await writeBoundsReport('failed');
  throw new Error(`Preview bounds failed for ${latest.label}: ${latest.failures.join(' | ')}`);
}

async function writeBoundsReport(status: BoundsReport['status']): Promise<void> {
  const report: BoundsReport = {
    generatedAt: new Date().toISOString(),
    samples: boundsSamples,
    scenario: 'browser-tauri-preview-zoom-window-bounds',
    status,
    viewport,
  };
  await mkdir(dirname(boundsReportPath), { recursive: true });
  await writeFile(boundsReportPath, `${JSON.stringify(report, null, 2)}\n`);
}
