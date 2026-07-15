#!/usr/bin/env bun

import { spawn } from 'node:child_process';

import { chromium } from '@playwright/test';
import { z } from 'zod';

import { editDocumentV2Schema } from '../../../../packages/rawengine-schema/src/editDocumentV2';
import { allocateFreeTcpPort } from '../../../../scripts/lib/dev-server-port';

const host = '127.0.0.1';
const port = await allocateFreeTcpPort(host);
const baseUrl = `http://${host}:${String(port)}`;
const sourcePath = '/tmp/rawengine-browser-harness/browser-harness.ARW';
const persistenceSchema = z
  .object({
    adjustments: z
      .object({
        crop: z.object({
          height: z.number(),
          unit: z.enum(['%', 'normalized', 'px']),
          width: z.number(),
          x: z.number(),
          y: z.number(),
        }),
      })
      .passthrough(),
    path: z.literal(sourcePath),
    transaction: z
      .object({
        baseAdjustmentRevision: z.number().int().nonnegative(),
        imageSessionId: z.string().min(1),
        nextAdjustmentRevision: z.number().int().positive(),
        transactionId: z.string().min(1),
      })
      .strict(),
  })
  .passthrough();
const previewRequestSchema = z.object({ editDocumentV2: editDocumentV2Schema }).passthrough();

const sameJsonValue = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameJsonValue(value, right[index]))
    );
  }
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftEntries = Object.entries(left);
  const rightRecord = right as Record<string, unknown>;
  return (
    leftEntries.length === Object.keys(rightRecord).length &&
    leftEntries.every(([key, value]) => Object.hasOwn(rightRecord, key) && sameJsonValue(value, rightRecord[key]))
  );
};

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
      const response = await fetch(baseUrl);
      if (response.ok) {
        await Bun.sleep(500);
        if ((await fetch(baseUrl)).ok) return;
      }
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
  const provisionalBadge = page.getByTestId('embedded-preview-provisional-badge');
  await provisionalBadge.waitFor({ state: 'visible', timeout: 10_000 });
  await provisionalBadge.waitFor({ state: 'hidden', timeout: 10_000 });
  await page.getByRole('main', { name: 'Editor workspace' }).waitFor({ timeout: 10_000 });

  const cropPanelButton = page.getByTestId('right-panel-switcher-button-crop');
  if ((await cropPanelButton.getAttribute('aria-pressed')) !== 'true') await cropPanelButton.click();
  await page.getByTestId('crop-canvas-mode-strip').waitFor({ timeout: 10_000 });
  const surface = page.getByTestId('crop-overlay-surface');
  const identity = await surface.evaluate((element) => ({
    imageSessionId: element.dataset.controllerImageSession,
    installedTool: element.dataset.controllerInstalledTool,
    operationGeneration: element.dataset.controllerOperationGeneration,
    sourceIdentity: element.dataset.controllerSourceIdentity,
    sourceRevision: element.dataset.controllerSourceRevision,
    tool: element.dataset.controllerTool,
  }));
  if (
    identity.sourceIdentity !== sourcePath ||
    identity.imageSessionId === undefined ||
    identity.operationGeneration === undefined ||
    identity.sourceRevision === undefined ||
    identity.installedTool !== 'crop' ||
    identity.tool !== 'crop'
  ) {
    throw new Error(`Crop surface did not expose complete source/session identity: ${JSON.stringify(identity)}`);
  }
  const cropRoot = page.locator('.ReactCrop');
  const cropPointerSurface = cropRoot.locator('.ReactCrop__child-wrapper');
  await cropRoot.waitFor({ timeout: 10_000 });
  await cropPointerSurface.waitFor({ timeout: 10_000 });
  const rootBounds = await cropPointerSurface.boundingBox();
  if (rootBounds === null || rootBounds.width < 200 || rootBounds.height < 150) {
    throw new Error('Crop surface was not interactable.');
  }
  await page.waitForTimeout(400);
  const baselineSaves = await page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0,
  );
  const baselinePreviewCalls = await page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === 'apply_adjustments')
        .length ?? 0,
  );

  const start = { x: rootBounds.x + 50, y: rootBounds.y + 40 };
  const end = { x: rootBounds.x + rootBounds.width - 90, y: rootBounds.y + rootBounds.height - 70 };
  const pointerTarget = await page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    return {
      className: element?.getAttribute('class'),
      tagName: element?.tagName,
      withinCrop: element?.closest('.ReactCrop__child-wrapper') !== null,
    };
  }, start);
  if (!pointerTarget.withinCrop) throw new Error(`Crop pointer target was occluded: ${JSON.stringify(pointerTarget)}`);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const selection = page.locator('.ReactCrop__crop-selection');
  await selection.waitFor({ state: 'attached', timeout: 10_000 });
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await selection.waitFor({ timeout: 10_000 });
  const saveDeadline = Date.now() + 10_000;
  let observedSaves = baselineSaves;
  while (Date.now() < saveDeadline) {
    observedSaves = await page.evaluate(
      () =>
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
          ({ command }) => command === 'save_metadata_and_update_thumbnail',
        ).length ?? 0,
    );
    if (observedSaves === baselineSaves + 1) break;
    await page.waitForTimeout(50);
  }
  if (observedSaves !== baselineSaves + 1) {
    throw new Error(`Crop selection completed without one persistence receipt: ${String(observedSaves)} saves.`);
  }

  const croppedBounds = await selection.boundingBox();
  if (croppedBounds === null || croppedBounds.width <= 100 || croppedBounds.width >= rootBounds.width - 40) {
    throw new Error('Crop drag did not visibly create a bounded selection.');
  }
  const persisted = persistenceSchema.parse(
    await page.evaluate(
      () =>
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
          .filter(({ command }) => command === 'save_metadata_and_update_thumbnail')
          .at(-1)?.args ?? null,
    ),
  );
  if (
    persisted.adjustments.crop.width <= 0 ||
    persisted.transaction.imageSessionId !== identity.imageSessionId ||
    persisted.transaction.nextAdjustmentRevision !== persisted.transaction.baseAdjustmentRevision + 1
  ) {
    throw new Error(`Crop did not persist one source-bound geometry revision: ${JSON.stringify(persisted)}`);
  }

  const previewDeadline = Date.now() + 10_000;
  let observedPreviewCalls = baselinePreviewCalls;
  while (Date.now() < previewDeadline) {
    observedPreviewCalls = await page.evaluate(
      () =>
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === 'apply_adjustments')
          .length ?? 0,
    );
    if (observedPreviewCalls > baselinePreviewCalls) break;
    await page.waitForTimeout(50);
  }
  if (observedPreviewCalls <= baselinePreviewCalls) {
    throw new Error('Crop commit did not publish a new EditDocumentV2 preview request.');
  }
  const previewRequest = previewRequestSchema.parse(
    await page.evaluate(
      () =>
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
          .filter(({ command }) => command === 'apply_adjustments')
          .at(-1)?.args?.request ?? null,
    ),
  );
  const previewDocument = previewRequest.editDocumentV2;
  if (
    !sameJsonValue(previewDocument.geometry, previewDocument.nodes.geometry?.params) ||
    !sameJsonValue(previewDocument.geometry.crop, persisted.adjustments.crop)
  ) {
    throw new Error(
      `Crop preview did not carry atomic geometry authority: ${JSON.stringify(previewDocument.geometry)}`,
    );
  }

  const undo = page.locator('button[data-command-id="undo"]:visible').first();
  if (!(await undo.isEnabled())) throw new Error('Crop commit did not create an undo boundary.');
  await undo.click();
  await selection.waitFor({ state: 'hidden', timeout: 10_000 });

  console.log('crop edit transaction browser ok');
} catch (error) {
  console.error('crop edit transaction browser failed');
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer();
}
