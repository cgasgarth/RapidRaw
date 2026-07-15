#!/usr/bin/env bun

import { spawn } from 'node:child_process';

import { chromium, type Page } from '@playwright/test';
import { z } from 'zod';

import { allocateFreeTcpPort } from '../../../../scripts/lib/dev-server-port';

const host = '127.0.0.1';
const port = await allocateFreeTcpPort(host);
const baseUrl = `http://${host}:${String(port)}`;
const nodeEnvelopeSchema = z.object({ enabled: z.boolean() }).passthrough();
const documentSchema = z
  .object({
    extensions: z.record(z.string(), z.unknown()),
    layers: z.object({ masks: z.array(z.record(z.string(), z.unknown())) }).passthrough(),
    nodes: z.record(z.string(), nodeEnvelopeSchema),
  })
  .passthrough();
const saveSchema = z.object({
  args: z
    .object({
      adjustments: z.record(z.string(), z.unknown()),
      editDocumentV2: documentSchema,
      transaction: z.object({ baseAdjustmentRevision: z.number(), nextAdjustmentRevision: z.number() }).passthrough(),
    })
    .passthrough(),
});

const server = spawn('bun', ['run', 'dev', '--', '--host', host, '--port', String(port)], {
  env: {
    ...process.env,
    RAWENGINE_DEV_SERVER_PORT: String(port),
    VITE_RAWENGINE_BROWSER_TAURI_HARNESS: '1',
  },
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
    new Promise<void>((resolve) => {
      server.once('exit', () => resolve());
    }),
    Bun.sleep(5_000).then(() => server.kill('SIGKILL')),
  ]);
};

const commandCount = async (page: Page, command: string) =>
  page.evaluate(
    ({ commandName }) =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter((call) => call.command === commandName).length ?? 0,
    { commandName: command },
  );

const waitForCommandCount = async (page: Page, command: string, expected: number) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await commandCount(page, command)) >= expected) return;
    await page.waitForTimeout(50);
  }
  throw new Error(
    `Timed out waiting for ${String(expected)} ${command} calls; observed ${String(await commandCount(page, command))}.`,
  );
};

const waitForEditIdle = async (page: Page, requiredStableSamples = 7) => {
  let stableSamples = 0;
  let previous = '';
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const current = `${String(await commandCount(page, 'apply_adjustments'))}:${String(
      await commandCount(page, 'save_metadata_and_update_thumbnail'),
    )}`;
    stableSamples = current === previous ? stableSamples + 1 : 0;
    if (stableSamples >= requiredStableSamples) return;
    previous = current;
    await page.waitForTimeout(250);
  }
  throw new Error('Editor did not become idle.');
};

const latestSave = async (page: Page) =>
  saveSchema.parse(
    await page.evaluate(() =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
        .filter((call) => call.command === 'save_metadata_and_update_thumbnail')
        .at(-1),
    ),
  ).args;

const renderAuthoritySnapshot = async (page: Page) =>
  page.evaluate(() => {
    const call = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
      .filter(({ command }) => command === 'apply_adjustments')
      .at(-1);
    const request = call?.args?.['request'];
    if (request === null || typeof request !== 'object' || Array.isArray(request)) return null;
    const record = request as Record<string, unknown>;
    const identity = record['previewOperationIdentity'];
    const session =
      identity !== null && typeof identity === 'object' && !Array.isArray(identity)
        ? (identity as Record<string, unknown>)['session']
        : null;
    if (session === null || typeof session !== 'object' || Array.isArray(session)) return null;
    const sessionRecord = session as Record<string, unknown>;
    return {
      adjustmentRevision: sessionRecord['adjustmentRevision'],
      editDocumentV2: record['editDocumentV2'],
      graphRevision: sessionRecord['graphRevision'],
    };
  });

const assertDisclosureOnly = async (page: Page, testId: string) => {
  const section = page.getByTestId(testId);
  await section.waitFor({ state: 'attached', timeout: 10_000 });
  await section.scrollIntoViewIfNeeded();
  const toggle =
    (await section.getAttribute('aria-expanded')) === null ? section.locator('button[aria-expanded]').first() : section;
  const initialExpanded = await toggle.getAttribute('aria-expanded');
  if (initialExpanded !== 'true' && initialExpanded !== 'false') throw new Error(`${testId} has no disclosure state.`);
  await waitForEditIdle(page);
  const baselineApplies = await commandCount(page, 'apply_adjustments');
  const baselineSaves = await commandCount(page, 'save_metadata_and_update_thumbnail');
  const baselineAuthority = await renderAuthoritySnapshot(page);
  if (baselineAuthority === null) throw new Error(`${testId} has no baseline render authority.`);
  await toggle.click();
  if ((await toggle.getAttribute('aria-expanded')) === initialExpanded) throw new Error(`${testId} did not toggle.`);
  await toggle.click();
  if ((await toggle.getAttribute('aria-expanded')) !== initialExpanded) throw new Error(`${testId} did not restore.`);
  await waitForEditIdle(page);
  const afterApplies = await commandCount(page, 'apply_adjustments');
  const afterSaves = await commandCount(page, 'save_metadata_and_update_thumbnail');
  if (afterSaves !== baselineSaves) {
    throw new Error(`${testId} disclosure caused persistence (${String(baselineSaves)} -> ${String(afterSaves)}).`);
  }
  if (afterApplies > baselineApplies) {
    const incidentalAuthorities = await page.evaluate(
      (startIndex) =>
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
          .filter((call) => call.command === 'apply_adjustments')
          .slice(startIndex)
          .map((call) => {
            const request = call.args?.['request'];
            if (request === null || typeof request !== 'object' || Array.isArray(request)) return null;
            const record = request as Record<string, unknown>;
            const identity = record['previewOperationIdentity'];
            const session =
              identity !== null && typeof identity === 'object' && !Array.isArray(identity)
                ? (identity as Record<string, unknown>)['session']
                : null;
            if (session === null || typeof session !== 'object' || Array.isArray(session)) return null;
            const sessionRecord = session as Record<string, unknown>;
            return {
              adjustmentRevision: sessionRecord['adjustmentRevision'],
              editDocumentV2: record['editDocumentV2'],
              graphRevision: sessionRecord['graphRevision'],
            };
          }),
      baselineApplies,
    );
    const expected = JSON.stringify(baselineAuthority);
    if (incidentalAuthorities?.some((authority) => JSON.stringify(authority) !== expected)) {
      throw new Error(`${testId} disclosure changed render authority during presentation reflow.`);
    }
  }
};

const toggleGlobalSection = async (page: Page, testId: string, expectedNodes: readonly string[]) => {
  const section = page.getByTestId(testId);
  const baselineApplies = await commandCount(page, 'apply_adjustments');
  const baselineSaves = await commandCount(page, 'save_metadata_and_update_thumbnail');
  await section.getByRole('button', { name: 'Disable section' }).click();
  await waitForCommandCount(page, 'apply_adjustments', baselineApplies + 1);
  await waitForCommandCount(page, 'save_metadata_and_update_thumbnail', baselineSaves + 1);
  const disabled = await latestSave(page);
  if (disabled.transaction.nextAdjustmentRevision !== disabled.transaction.baseAdjustmentRevision + 1) {
    throw new Error(`${testId} enablement was not one atomic revision.`);
  }
  for (const nodeType of expectedNodes) {
    if (disabled.editDocumentV2.nodes[nodeType]?.enabled !== false) {
      throw new Error(`${testId} did not disable ${nodeType}.`);
    }
  }
  if ('sectionVisibility' in disabled.adjustments) {
    throw new Error(`${testId} leaked disclosure into flat render authority.`);
  }
  if (expectedNodes.includes('display_creative') && disabled.adjustments['effectsEnabled'] !== false) {
    throw new Error('Effects did not project its explicit compatibility authority.');
  }
  await section.getByRole('button', { name: 'Enable section' }).click();
  await waitForCommandCount(page, 'save_metadata_and_update_thumbnail', baselineSaves + 2);
};

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let page: Page | undefined;
const pageErrors: string[] = [];
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { height: 1000, width: 1600 } });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('https://api.github.com/repos/CyberTimon/RapidRAW/releases/latest', async (route) => {
    await route.fulfill({ contentType: 'application/json', json: { tag_name: 'v0.0.0-browser' }, status: 200 });
  });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'RapidRAW' }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: /Open Folder/u }).click();
  const thumbnail = page.getByRole('button', { name: /browser-harness\.ARW/u }).first();
  await thumbnail.waitFor({ timeout: 10_000 });
  await thumbnail.dblclick();
  const provisionalBadge = page.getByTestId('embedded-preview-provisional-badge');
  await provisionalBadge.waitFor({ state: 'visible', timeout: 10_000 });
  await provisionalBadge.waitFor({ state: 'hidden', timeout: 10_000 });
  await page.getByRole('main', { name: 'Editor workspace' }).waitFor({ timeout: 10_000 });

  await page.getByTestId('right-panel-switcher-button-adjustments').click();
  await page.getByTestId('adjustments-inspector').waitFor({ timeout: 10_000 });
  await waitForEditIdle(page, 16);
  for (const section of ['basic', 'curves', 'details', 'effects'] as const) {
    const testId = `adjustments-section-${section}`;
    await assertDisclosureOnly(page, testId);
  }
  await toggleGlobalSection(page, 'adjustments-section-basic', ['scene_global_color_tone', 'tone_equalizer']);
  await toggleGlobalSection(page, 'adjustments-section-curves', ['scene_curve']);
  await toggleGlobalSection(page, 'adjustments-section-details', ['detail_denoise_dehaze']);
  await toggleGlobalSection(page, 'adjustments-section-effects', ['display_creative']);

  const panelSwitchSaves = await commandCount(page, 'save_metadata_and_update_thumbnail');
  await page.getByTestId('right-panel-switcher-button-color').click();
  await page.getByTestId('color-workspace-panel').waitFor({ timeout: 10_000 });
  await page.waitForTimeout(250);
  if ((await commandCount(page, 'save_metadata_and_update_thumbnail')) !== panelSwitchSaves) {
    throw new Error('Opening Color workspace caused persistence.');
  }
  await waitForEditIdle(page);
  const colorBaselineApplies = await commandCount(page, 'apply_adjustments');
  const colorBaselineSaves = await commandCount(page, 'save_metadata_and_update_thumbnail');
  const colorToggle = page.getByTestId('color-workspace-enable-toggle');
  await colorToggle.click();
  await waitForCommandCount(page, 'apply_adjustments', colorBaselineApplies + 1);
  await waitForCommandCount(page, 'save_metadata_and_update_thumbnail', colorBaselineSaves + 1);
  const colorDisabled = await latestSave(page);
  for (const nodeType of [
    'point_color',
    'black_white_mixer',
    'channel_mixer',
    'perceptual_grading',
    'camera_input',
    'color_calibration',
  ]) {
    if (colorDisabled.editDocumentV2.nodes[nodeType]?.enabled !== false) {
      throw new Error(`Color did not disable ${nodeType}.`);
    }
  }
  if (colorDisabled.transaction.nextAdjustmentRevision !== colorDisabled.transaction.baseAdjustmentRevision + 1) {
    throw new Error('Color enablement was not one atomic revision.');
  }
  await colorToggle.click();
  await waitForCommandCount(page, 'save_metadata_and_update_thumbnail', colorBaselineSaves + 2);

  await page.getByTestId('right-panel-switcher-button-masks').click();
  await page.getByTestId('layer-create-brush-local-adjustment').click();
  const maskRow = page.locator('[data-testid^="mask-container-row-"]').first();
  await maskRow.waitFor({ timeout: 10_000 });
  const subMaskRow = page.locator('[data-testid^="mask-submask-row-"]').first();
  await subMaskRow.waitFor({ timeout: 10_000 });
  await subMaskRow.click();
  await page.getByRole('heading', { name: 'Mask Adjustments' }).waitFor({ timeout: 10_000 });
  await page.getByTestId('mask-adjustments-section-basic-toggle').waitFor({ state: 'attached', timeout: 10_000 });
  await waitForEditIdle(page, 12);
  for (const section of ['basic', 'color', 'curves', 'details'] as const) {
    await assertDisclosureOnly(page, `mask-adjustments-section-${section}-toggle`);
  }
  const maskSection = page.getByTestId('mask-adjustments-section-basic-toggle').locator('..');
  const maskBaselineApplies = await commandCount(page, 'apply_adjustments');
  const maskBaselineSaves = await commandCount(page, 'save_metadata_and_update_thumbnail');
  await maskSection.getByRole('button', { name: 'Disable section' }).click();
  await waitForCommandCount(page, 'apply_adjustments', maskBaselineApplies + 1);
  await waitForCommandCount(page, 'save_metadata_and_update_thumbnail', maskBaselineSaves + 1);
  const maskDisabled = await latestSave(page);
  const firstMask = maskDisabled.editDocumentV2.layers.masks[0];
  const editNodes = z.record(z.string(), nodeEnvelopeSchema).parse(firstMask?.['editNodes']);
  if (editNodes['basic']?.enabled !== false) throw new Error('Mask Basic node did not disable.');
  for (const sibling of ['color', 'curves', 'details']) {
    if (editNodes[sibling]?.enabled !== true) throw new Error(`Mask Basic toggle mutated sibling ${sibling}.`);
  }
  const flatMasks = z.array(z.record(z.string(), z.unknown())).parse(maskDisabled.adjustments['masks']);
  const flatMaskAdjustments = z.record(z.string(), z.unknown()).parse(flatMasks[0]?.['adjustments']);
  if ('sectionVisibility' in flatMaskAdjustments) throw new Error('Mask disclosure leaked into flat render authority.');
  await maskSection.getByRole('button', { name: 'Enable section' }).click();
  await waitForCommandCount(page, 'save_metadata_and_update_thumbnail', maskBaselineSaves + 2);

  await page.screenshot({ fullPage: true, path: '/tmp/rawengine-5536-disclosure-proof.png' });
  if (pageErrors.length > 0) throw new Error(`Browser emitted page errors: ${pageErrors.join(' | ')}`);
  console.log('section disclosure edit authority browser proof ok');
} catch (error) {
  console.error(error);
  if (pageErrors.length > 0) console.error(`Page errors: ${pageErrors.join(' | ')}`);
  if (page) {
    const maskTestIds = await page
      .locator('[data-testid*="mask"]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-testid')).filter(Boolean));
    console.error(`Visible mask test ids: ${maskTestIds.join(', ')}`);
    await page.screenshot({ fullPage: true, path: '/tmp/rawengine-5536-disclosure-failure.png' });
  }
  if (serverOutput) console.error(serverOutput);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await stopServer();
}
