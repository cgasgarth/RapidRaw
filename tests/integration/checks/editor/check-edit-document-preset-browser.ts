#!/usr/bin/env bun

import { spawn } from 'node:child_process';

import { chromium, type Page } from '@playwright/test';
import { z } from 'zod';

import { editDocumentV2CopyPayloadSchema } from '../../../../packages/rawengine-schema/src/editDocumentV2';
import { allocateFreeTcpPort } from '../../../../scripts/lib/dev-server-port';

const host = '127.0.0.1';
const port = await allocateFreeTcpPort(host);
const baseUrl = `http://${host}:${String(port)}`;
const presetName = 'Descriptor Proof';

const savedPresetSchema = z.object({
  editDocumentV2: editDocumentV2CopyPayloadSchema,
  format: z.literal('rapidraw.preset'),
  id: z.string().min(1),
  includeCropTransform: z.boolean(),
  includeMasks: z.literal(false),
  name: z.literal(presetName),
  presetType: z.enum(['style', 'tool']),
  schemaVersion: z.literal(1),
});

const server = spawn('bun', ['run', 'dev', '--', '--host', host, '--port', String(port)], {
  env: { ...process.env, RAWENGINE_DEV_SERVER_PORT: String(port), VITE_RAWENGINE_BROWSER_TAURI_HARNESS: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
const captureServerOutput = (chunk: Buffer) => {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-4_000);
};
server.stdout.on('data', captureServerOutput);
server.stderr.on('data', captureServerOutput);

const waitForServer = async () => {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode !== null) throw new Error('Vite exited before startup.');
    try {
      if ((await fetch(baseUrl)).ok) return;
    } catch {
      // Vite is still starting.
    }
    await Bun.sleep(250);
  }
  throw new Error(`Timed out waiting for ${baseUrl}.`);
};

const stopServer = async () => {
  if (server.exitCode !== null || server.signalCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => server.once('exit', () => resolve())),
    Bun.sleep(5_000).then(() => server.kill('SIGKILL')),
  ]);
};

const callCount = (page: Page, command: string) =>
  page.evaluate(
    (name) => window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter((call) => call.command === name).length ?? 0,
    command,
  );

const waitForCallCount = async (page: Page, command: string, expected: number) => {
  await page.waitForFunction(
    ({ commandName, count }) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter((call) => call.command === commandName).length ?? 0) >=
      count,
    { commandName: command, count: expected },
    { timeout: 10_000 },
  );
};

const saveCount = (page: Page) => callCount(page, 'save_metadata_and_update_thumbnail');

const commitNumericControl = async (page: Page, testId: string, value: string) => {
  await page.getByTestId(`${testId}-value`).click();
  const input = page.getByTestId(`${testId}-input`);
  await input.fill(value);
  await input.press('Enter');
  await page.getByTestId(`${testId}-value`).waitFor({ state: 'visible', timeout: 10_000 });
};

const waitForExposure = async (page: Page, expected: string) => {
  try {
    await page.waitForFunction(
      ({ id, value }) => document.querySelector(`[data-testid="${id}"]`)?.textContent?.trim() === value,
      { id: 'basic-control-exposure-value', value: expected },
      { timeout: 10_000 },
    );
  } catch {
    const actual = await page
      .getByTestId('basic-control-exposure-value')
      .textContent({ timeout: 1_000 })
      .catch(() => null);
    const alerts = await page.getByRole('alert').allInnerTexts();
    throw new Error(
      `Exposure remained ${actual ?? '<missing>'}; expected ${expected}; alerts=${JSON.stringify(alerts)}`,
    );
  }
};

const openPresetsPanel = async (page: Page) => {
  await page.keyboard.press('Control+K');
  const palette = page.getByRole('dialog', { name: /Command Palette/u });
  await palette.waitFor({ timeout: 10_000 });
  await palette.getByLabel(/Search commands/u).fill('presets');
  await palette.getByRole('button', { name: /Show presets/u }).click();
  await page.getByTestId('presets-panel').waitFor({ timeout: 10_000 });
};

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { height: 820, width: 1360 } });
  await page.route('https://api.github.com/repos/CyberTimon/RapidRAW/releases/latest', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: { html_url: 'https://github.com/CyberTimon/RapidRAW/releases/latest', tag_name: 'v0.0.0-browser' },
      status: 200,
    });
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'RapidRAW' }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: /Open Folder/u }).click();
  const thumbnail = page.getByRole('button', { name: /browser-harness\.ARW/u }).first();
  await thumbnail.waitFor({ timeout: 10_000 });
  await thumbnail.dblclick();
  await page.getByTestId('embedded-preview-provisional-badge').waitFor({ state: 'hidden', timeout: 10_000 });
  await page.getByRole('main', { name: 'Editor workspace' }).waitFor({ timeout: 10_000 });

  await page.getByTestId('right-panel-switcher-button-adjustments').click();
  let saves = await saveCount(page);
  await commitNumericControl(page, 'basic-control-exposure', '0.85');
  await waitForCallCount(page, 'save_metadata_and_update_thumbnail', saves + 1);
  saves += 1;

  await openPresetsPanel(page);
  const presetsPanel = page.getByTestId('presets-panel');
  await presetsPanel.getByRole('button', { name: 'Save as new preset' }).click();
  const configureDialog = page.getByRole('dialog', { name: 'Save New Preset' });
  await configureDialog.waitFor({ timeout: 10_000 });
  if ((await configureDialog.getByText('Include Masks', { exact: true }).count()) !== 0) {
    throw new Error('Configure Preset exposed masks even though the descriptor excludes layer transfer.');
  }
  await configureDialog.getByLabel('Preset name').fill(presetName);
  await configureDialog.getByRole('button', { name: 'Save' }).click();
  await presetsPanel
    .getByTestId(/preset-result-/u)
    .filter({ hasText: presetName })
    .waitFor({ timeout: 10_000 });
  await waitForCallCount(page, 'save_presets', 1);

  const savedPreset = savedPresetSchema.parse(
    await page.evaluate(
      () =>
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === 'save_presets').at(-1)
          ?.args.presets?.[0]?.preset ?? null,
    ),
  );
  if (
    savedPreset.editDocumentV2.nodes.scene_global_color_tone?.params.exposure !== 0.85 ||
    savedPreset.editDocumentV2.nodes.geometry !== undefined ||
    savedPreset.editDocumentV2.nodes.layers !== undefined ||
    savedPreset.editDocumentV2.nodes.source_artifacts !== undefined
  ) {
    throw new Error(`Saved preset violated descriptor serialization policy: ${JSON.stringify(savedPreset)}`);
  }

  const presetResult = presetsPanel.getByTestId(/preset-result-/u).filter({ hasText: presetName });
  const presetBox = await presetResult.boundingBox();
  if (presetBox === null) throw new Error('Saved preset result has no visible bounds.');
  await presetResult.evaluate(
    (element, position) =>
      element.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          button: 2,
          buttons: 2,
          cancelable: true,
          clientX: position.x,
          clientY: position.y,
          view: window,
        }),
      ),
    { x: presetBox.x + presetBox.width / 2, y: presetBox.y + presetBox.height / 2 },
  );
  await page.getByRole('menuitem', { name: 'Configure Preset', exact: true }).click();
  const editDialog = page.getByRole('dialog', { name: 'Configure Preset' });
  await editDialog.waitFor({ timeout: 10_000 });
  await editDialog.getByText('Include Crop & Transform', { exact: true }).click();
  await editDialog.getByRole('button', { name: 'Save' }).click();
  await waitForCallCount(page, 'save_presets', 2);
  const configuredPreset = savedPresetSchema.parse(
    await page.evaluate(
      () =>
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === 'save_presets').at(-1)
          ?.args.presets?.[0]?.preset ?? null,
    ),
  );
  if (
    !configuredPreset.includeCropTransform ||
    configuredPreset.editDocumentV2.nodes.geometry === undefined ||
    configuredPreset.editDocumentV2.nodes.lens_correction === undefined ||
    configuredPreset.editDocumentV2.nodes.layers !== undefined ||
    configuredPreset.editDocumentV2.nodes.source_artifacts !== undefined
  ) {
    throw new Error(`Configured preset violated descriptor serialization policy: ${JSON.stringify(configuredPreset)}`);
  }

  await page.getByTestId('right-panel-switcher-button-adjustments').click();
  await commitNumericControl(page, 'basic-control-exposure', '0.15');
  await waitForCallCount(page, 'save_metadata_and_update_thumbnail', saves + 1);
  saves += 1;
  await openPresetsPanel(page);
  await presetsPanel.getByRole('button', { name: `Apply preset ${presetName}` }).click();
  await waitForCallCount(page, 'save_metadata_and_update_thumbnail', saves + 1);
  saves += 1;
  await page.getByTestId('right-panel-switcher-button-adjustments').click();
  await waitForExposure(page, '0.85');

  const persisted = await page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
        .filter(({ command }) => command === 'save_metadata_and_update_thumbnail')
        .at(-1)?.args ?? null,
  );
  if (
    Reflect.get(Reflect.get(persisted, 'adjustments'), 'exposure') !== 0.85 ||
    Reflect.get(
      Reflect.get(Reflect.get(Reflect.get(persisted, 'editDocumentV2'), 'nodes'), 'scene_global_color_tone'),
      'enabled',
    ) !== true
  ) {
    throw new Error('Preset apply did not persist matching current edit-document render authority.');
  }

  await openPresetsPanel(page);
  await presetsPanel.getByRole('button', { name: `Apply preset ${presetName}` }).click();
  await page.waitForTimeout(300);
  if ((await saveCount(page)) !== saves) throw new Error('Exact no-op preset apply persisted a second revision.');

  const selectedImagePath = await page
    .getByRole('main', { name: 'Editor workspace' })
    .getAttribute('data-selected-image-path');
  const previewCall = await page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
        .filter(({ command }) => command === 'generate_preset_preview')
        .at(-1)?.args.request ?? null,
  );
  const previewAdjustments = Reflect.get(previewCall, 'jsAdjustments');
  const previewIdentity = Reflect.get(previewCall, 'previewIdentity');
  if (
    Reflect.get(previewAdjustments, 'exposure') !==
      configuredPreset.editDocumentV2.nodes.scene_global_color_tone?.params.exposure ||
    selectedImagePath === null ||
    Reflect.get(previewCall, 'expectedImagePath') !== selectedImagePath ||
    Reflect.get(previewIdentity, 'sourceImagePath') !== Reflect.get(previewCall, 'expectedImagePath') ||
    Reflect.get(previewIdentity, 'presetId') !== configuredPreset.id ||
    typeof Reflect.get(previewIdentity, 'imageSessionId') !== 'number' ||
    typeof Reflect.get(previewIdentity, 'requestId') !== 'number'
  ) {
    throw new Error('Native preset preview request diverged from the saved edit-document and source authority.');
  }

  await presetsPanel.getByRole('button', { name: 'Revert', exact: true }).click();
  await waitForCallCount(page, 'save_metadata_and_update_thumbnail', saves + 1);
  saves += 1;
  await page.getByTestId('right-panel-switcher-button-adjustments').click();
  await waitForExposure(page, '0.15');
  await page.locator('button[data-command-id="undo"]:visible').first().click();
  await waitForExposure(page, '0.85');
  await page.locator('button[data-command-id="redo"]:visible').first().click();
  await waitForExposure(page, '0.15');

  console.log('edit document preset browser ok');
} catch (error) {
  console.error('edit document preset browser failed');
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer();
}
