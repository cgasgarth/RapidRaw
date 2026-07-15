#!/usr/bin/env bun

import { spawn } from 'node:child_process';

import { chromium, type Page } from '@playwright/test';
import { z } from 'zod';

import { allocateFreeTcpPort } from '../../../../scripts/lib/dev-server-port';

const host = '127.0.0.1';
const port = await allocateFreeTcpPort(host);
const baseUrl = `http://${host}:${String(port)}`;
const sourcePath = '/tmp/rawengine-browser-harness/browser-harness.ARW';
const patchSchema = z
  .object({
    id: z.string(),
    visible: z.boolean(),
  })
  .passthrough();
const persistenceSchema = z
  .object({
    adjustments: z.object({ aiPatches: z.array(patchSchema) }).passthrough(),
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
const renderCallSchema = z.object({
  args: z
    .object({
      request: z
        .object({
          editDocumentV2: z
            .object({
              nodes: z
                .object({
                  source_artifacts: z
                    .object({ params: z.object({ aiPatches: z.array(patchSchema) }).strict() })
                    .passthrough(),
                })
                .passthrough(),
              sourceArtifacts: z.object({ aiPatches: z.array(patchSchema) }).strict(),
            })
            .passthrough(),
        })
        .passthrough(),
    })
    .passthrough(),
  endedAtMs: z.number().nullable(),
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

const callsFor = async (page: Page, command: string) =>
  page.evaluate(
    (requestedCommand) =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === requestedCommand) ?? [],
    command,
  );

const waitForCallCount = async (page: Page, command: string, expected: number) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await callsFor(page, command)).length >= expected) return;
    await page.waitForTimeout(50);
  }
  throw new Error(
    `Timed out waiting for ${String(expected)} ${command} calls; observed ${String((await callsFor(page, command)).length)}.`,
  );
};

const waitForRenderedPatches = async (page: Page, expected: ReadonlyArray<{ id: string; visible: boolean }>) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const parsed = renderCallSchema.safeParse((await callsFor(page, 'apply_adjustments')).at(-1));
    if (parsed.success && parsed.data.endedAtMs !== null) {
      const request = parsed.data.args.request;
      const nodePatches = request.editDocumentV2.nodes.source_artifacts.params.aiPatches;
      const domainPatches = request.editDocumentV2.sourceArtifacts.aiPatches;
      const projected = nodePatches.map(({ id, visible }) => ({ id, visible }));
      if (
        JSON.stringify(projected) === JSON.stringify(expected) &&
        JSON.stringify(nodePatches) === JSON.stringify(domainPatches) &&
        !Object.hasOwn(request, 'jsAdjustments')
      ) {
        return;
      }
    }
    await page.waitForTimeout(50);
  }
  const latest = renderCallSchema.safeParse((await callsFor(page, 'apply_adjustments')).at(-1));
  throw new Error(
    `Timed out waiting for rendered source artifacts ${JSON.stringify(expected)}; latest=${JSON.stringify(
      latest.success
        ? latest.data.args.request.editDocumentV2.nodes.source_artifacts.params.aiPatches.map(({ id, visible }) => ({
            id,
            visible,
          }))
        : latest.error.issues,
    )}.`,
  );
};

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { height: 900, width: 1400 } });
  await page.route('https://api.github.com/repos/CyberTimon/RapidRAW/releases/latest', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: { html_url: 'https://github.com/CyberTimon/RapidRAW/releases/latest', tag_name: 'v0.0.0-browser' },
      status: 200,
    });
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'RapidRAW' }).waitFor({ timeout: 30_000 });
  await page.evaluate((path) => {
    const aiPatch = (id: string, name: string) => ({
      id,
      invert: false,
      isLoading: false,
      name,
      patchData: { fixture: id },
      prompt: '',
      subMasks: [],
      visible: true,
    });
    window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.setAdjustmentsForPath(path, {
      aiPatches: [aiPatch('repair-one', 'Repair one'), aiPatch('repair-two', 'Repair two')],
    });
  }, sourcePath);
  await page.getByRole('button', { name: /Open Folder/u }).click();
  const thumbnail = page.getByRole('button', { name: /browser-harness\.ARW/u }).first();
  await thumbnail.waitFor({ timeout: 10_000 });
  await thumbnail.dblclick();
  const provisionalBadge = page.getByTestId('embedded-preview-provisional-badge');
  await provisionalBadge.waitFor({ state: 'visible', timeout: 10_000 });
  await provisionalBadge.waitFor({ state: 'hidden', timeout: 10_000 });
  await page.getByRole('main', { name: 'Editor workspace' }).waitFor({ timeout: 10_000 });
  await page.getByTestId('right-panel-switcher-button-ai').click();
  await page.getByTestId('inpaint-edit-list').waitFor({ timeout: 10_000 });
  await page.getByTestId('inpaint-edit-count').getByText('2').waitFor();

  const baselineSaves = (await callsFor(page, 'save_metadata_and_update_thumbnail')).length;
  const baselineRenders = (await callsFor(page, 'apply_adjustments')).length;
  await page.getByRole('button', { name: 'Hide generated preview' }).click();
  await waitForCallCount(page, 'save_metadata_and_update_thumbnail', baselineSaves + 1);
  await waitForCallCount(page, 'apply_adjustments', baselineRenders + 1);
  await waitForRenderedPatches(page, [
    { id: 'repair-one', visible: true },
    { id: 'repair-two', visible: false },
  ]);
  await page.getByRole('button', { name: 'Show generated preview' }).waitFor();

  const secondRow = page.getByTestId('inpaint-edit-repair-two');
  await secondRow.hover();
  await secondRow.getByRole('button', { name: 'Delete Edit' }).click();
  await waitForCallCount(page, 'save_metadata_and_update_thumbnail', baselineSaves + 2);
  await waitForCallCount(page, 'apply_adjustments', baselineRenders + 2);
  await waitForRenderedPatches(page, [{ id: 'repair-one', visible: true }]);
  await page.getByTestId('inpaint-edit-count').getByText('1').waitFor();

  const saveCalls = await callsFor(page, 'save_metadata_and_update_thumbnail');
  const visibilitySave = persistenceSchema.parse(saveCalls.at(-2)?.args);
  const deletionSave = persistenceSchema.parse(saveCalls.at(-1)?.args);
  if (
    visibilitySave.adjustments.aiPatches[1]?.visible !== false ||
    deletionSave.adjustments.aiPatches.length !== 1 ||
    visibilitySave.transaction.nextAdjustmentRevision !== deletionSave.transaction.baseAdjustmentRevision ||
    visibilitySave.transaction.imageSessionId !== deletionSave.transaction.imageSessionId ||
    visibilitySave.transaction.nextAdjustmentRevision !== visibilitySave.transaction.baseAdjustmentRevision + 1 ||
    deletionSave.transaction.nextAdjustmentRevision !== deletionSave.transaction.baseAdjustmentRevision + 1
  ) {
    throw new Error(
      `AI visibility/delete did not persist as two sequential source/session revisions: ${JSON.stringify({ deletionSave, visibilitySave })}`,
    );
  }

  const undo = page.locator('button[data-command-id="undo"]:visible').first();
  if (!(await undo.isEnabled())) throw new Error('AI source-artifact commits did not create Undo boundaries.');
  await undo.click();
  await waitForCallCount(page, 'apply_adjustments', baselineRenders + 3);
  await waitForRenderedPatches(page, [
    { id: 'repair-one', visible: true },
    { id: 'repair-two', visible: false },
  ]);
  await page.getByTestId('inpaint-edit-repair-two').waitFor();

  await page.waitForFunction(() => {
    const button = document.querySelector<HTMLButtonElement>('button[data-command-id="undo"]:not([disabled])');
    return button !== null;
  });
  await undo.click();
  await waitForCallCount(page, 'apply_adjustments', baselineRenders + 4);
  await waitForRenderedPatches(page, [
    { id: 'repair-one', visible: true },
    { id: 'repair-two', visible: true },
  ]);
  await page.getByRole('button', { name: 'Hide generated preview' }).waitFor();

  console.log('ai source-artifact edit transaction browser ok');
} catch (error) {
  console.error('ai source-artifact edit transaction browser failed');
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer();
}
