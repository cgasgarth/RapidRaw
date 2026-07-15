#!/usr/bin/env bun

import { spawn } from 'node:child_process';

import { chromium, type Page } from '@playwright/test';
import { z } from 'zod';

import { allocateFreeTcpPort } from '../../../../scripts/lib/dev-server-port';

const host = '127.0.0.1';
const port = await allocateFreeTcpPort(host);
const baseUrl = `http://${host}:${String(port)}`;
const sourcePath = '/tmp/rawengine-browser-harness/browser-harness.ARW';
const renderSchema = z.object({
  args: z
    .object({
      request: z
        .object({
          editDocumentV2: z
            .object({
              nodes: z
                .object({ camera_input: z.object({ params: z.object({ cameraProfile: z.string() }).passthrough() }) })
                .passthrough(),
            })
            .passthrough(),
        })
        .passthrough(),
    })
    .passthrough(),
  endedAtMs: z.number().nullable(),
});

const server = spawn('bun', ['run', 'dev', '--', '--host', host, '--port', String(port)], {
  env: { ...process.env, RAWENGINE_DEV_SERVER_PORT: String(port), VITE_RAWENGINE_BROWSER_TAURI_HARNESS: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
const capture = (chunk: Buffer) => {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-4_000);
};
server.stdout.on('data', capture);
server.stderr.on('data', capture);

const waitForServer = async () => {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
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

const calls = async (page: Page, command: string) =>
  page.evaluate(
    (name) => window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === name) ?? [],
    command,
  );

const waitForCount = async (page: Page, command: string, expected: number) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await calls(page, command)).length >= expected) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`Timed out waiting for ${String(expected)} ${command} calls.`);
};

const waitForCompletedCount = async (page: Page, command: string, expected: number) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await calls(page, command)).filter(({ endedAtMs }) => endedAtMs !== null).length >= expected) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`Timed out waiting for ${String(expected)} completed ${command} calls.`);
};

const waitForRenderedProfile = async (page: Page, profile: string) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const parsed = renderSchema.safeParse((await calls(page, 'apply_adjustments')).at(-1));
    if (
      parsed.success &&
      parsed.data.endedAtMs !== null &&
      parsed.data.args.request.editDocumentV2.nodes.camera_input.params.cameraProfile === profile
    )
      return;
    await page.waitForTimeout(50);
  }
  throw new Error(`Timed out waiting for rendered profile ${profile}.`);
};

const selectNeutralProfile = async (page: Page) => {
  const profileBrowser = page.getByTestId('camera-profile-browser');
  await profileBrowser.getByRole('button', { name: 'Profile preset' }).click();
  await page
    .getByTestId('camera-profile-browser-popover')
    .getByRole('button', { name: 'Neutral', exact: true })
    .click();
};

const triggerReset = async (page: Page) => {
  await page.getByTestId('editor-image-preview-region').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Reset Adjustments', exact: true }).first().click();
  await page.getByRole('menuitem', { name: 'Confirm Reset', exact: true }).first().click();
};

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { height: 900, width: 1360 } });
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
  const provisionalBadge = page.getByTestId('embedded-preview-provisional-badge');
  await provisionalBadge.waitFor({ state: 'visible', timeout: 10_000 });
  await provisionalBadge.waitFor({ state: 'hidden', timeout: 10_000 });
  await page.getByRole('main', { name: 'Editor workspace' }).waitFor({ timeout: 10_000 });
  const adjustmentsPanelButton = page.getByTestId('right-panel-switcher-button-adjustments');
  if ((await adjustmentsPanelButton.getAttribute('aria-pressed')) !== 'true') await adjustmentsPanelButton.click();
  await page.getByTestId('right-panel-switcher-button-color').click();
  await page.getByTestId('color-workspace-tab-foundation').click();
  await page.getByTestId('camera-profile-browser').waitFor({ timeout: 10_000 });

  await selectNeutralProfile(page);
  await waitForRenderedProfile(page, 'camera_neutral');
  await page.waitForTimeout(450);
  const acceptedResetCalls = (await calls(page, 'reset_adjustments_for_paths')).length;
  const acceptedSaves = (await calls(page, 'save_metadata_and_update_thumbnail')).length;
  const acceptedRenders = (await calls(page, 'apply_adjustments')).length;
  await triggerReset(page);
  await waitForCompletedCount(page, 'reset_adjustments_for_paths', acceptedResetCalls + 1);
  await waitForCount(page, 'apply_adjustments', acceptedRenders + 1);
  await waitForRenderedProfile(page, 'camera_standard');
  await page.waitForTimeout(450);
  if ((await calls(page, 'save_metadata_and_update_thumbnail')).length !== acceptedSaves) {
    throw new Error('Native-committed Reset performed a duplicate frontend persistence request.');
  }
  const undo = page.locator('button[data-command-id="undo"]:visible').first();
  if (!(await undo.isDisabled())) throw new Error('Reset did not atomically replace the editor history baseline.');

  const raceResetCalls = (await calls(page, 'reset_adjustments_for_paths')).length;
  const raceSaves = (await calls(page, 'save_metadata_and_update_thumbnail')).length;
  await page.evaluate((path) => {
    window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.resetAdjustmentsResponses.push({
      delayMs: 1_500,
      value: [
        {
          adjustments: {},
          path,
          renderGeneration: 2,
          revision: `sha256:${'c'.repeat(64)}`,
        },
      ],
    });
  }, sourcePath);
  await triggerReset(page);
  await waitForCount(page, 'reset_adjustments_for_paths', raceResetCalls + 1);
  await selectNeutralProfile(page);
  await waitForRenderedProfile(page, 'camera_neutral');
  await waitForCount(page, 'save_metadata_and_update_thumbnail', raceSaves + 1);
  await waitForCompletedCount(page, 'reset_adjustments_for_paths', raceResetCalls + 1);
  await page.waitForTimeout(250);
  await waitForRenderedProfile(page, 'camera_neutral');
  if ((await calls(page, 'save_metadata_and_update_thumbnail')).length !== raceSaves + 1) {
    throw new Error('Stale Reset completion performed persistence after the intervening manual edit.');
  }

  console.log('Reset edit transaction browser ok');
} catch (error) {
  console.error('Reset edit transaction browser failed');
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer();
}
