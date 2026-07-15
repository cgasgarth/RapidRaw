#!/usr/bin/env bun

import { spawn } from 'node:child_process';

import { chromium, type Page } from '@playwright/test';
import { z } from 'zod';

import { allocateFreeTcpPort } from '../../../../scripts/lib/dev-server-port';

const host = '127.0.0.1';
const port = await allocateFreeTcpPort(host);
const baseUrl = `http://${host}:${String(port)}`;
const sourcePath = '/tmp/rawengine-browser-harness/browser-harness.ARW';
const pointSchema = z.object({ xEv: z.number(), yEv: z.number() }).strict();
const sceneCurveSchema = z
  .object({
    channelMode: z.enum(['luminance_preserving', 'linked_rgb']),
    middleGrey: z.number(),
    points: z.array(pointSchema),
  })
  .strict();
const persistenceSchema = z
  .object({
    adjustments: z.object({ rawEngineEditGraphVersion: z.literal(2), sceneCurveV1: sceneCurveSchema }).passthrough(),
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
const renderSchema = z.object({
  args: z
    .object({
      request: z
        .object({
          editDocumentV2: z
            .object({
              nodes: z
                .object({
                  scene_curve: z.object({ params: z.object({ sceneCurveV1: sceneCurveSchema }).passthrough() }),
                })
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

const waitForRenderedPointCount = async (page: Page, expected: number) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const parsed = renderSchema.safeParse((await calls(page, 'apply_adjustments')).at(-1));
    if (
      parsed.success &&
      parsed.data.endedAtMs !== null &&
      parsed.data.args.request.editDocumentV2.nodes.scene_curve.params.sceneCurveV1.points.length === expected
    )
      return;
    await page.waitForTimeout(50);
  }
  throw new Error(`Timed out waiting for a rendered Scene curve with ${String(expected)} points.`);
};

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let page: Page | undefined;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { height: 900, width: 1360 } });
  page.on('console', (message) => {
    if (message.type() === 'error') serverOutput = `${serverOutput}\nbrowser console: ${message.text()}`.slice(-4_000);
  });
  page.on('pageerror', (error) => {
    serverOutput = `${serverOutput}\nbrowser page error: ${error.message}`.slice(-4_000);
  });
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
  await page.getByRole('main', { name: 'Editor workspace' }).waitFor({ timeout: 10_000 });
  await page.getByTestId('right-panel-switcher-button-adjustments').click();
  const curves = page.getByTestId('adjustments-section-curves');
  const disclosure = curves.locator('button[aria-expanded]').first();
  if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click();
  await page.getByTestId('curve-domain-switcher').getByRole('button', { name: 'Scene' }).click();
  const editor = page.getByTestId('typed-curve-editor');
  await editor.waitFor({ timeout: 10_000 });
  if ((await editor.getAttribute('data-commit-image-session')) === null) {
    throw new Error('Typed curve editor did not publish a current image-session commit identity.');
  }
  await expectPointRows(editor, 2);
  await page.waitForTimeout(150);

  const baselineSaves = (await calls(page, 'save_metadata_and_update_thumbnail')).length;
  const baselineRenders = (await calls(page, 'apply_adjustments')).length;
  await editor.getByRole('button', { name: 'Add point' }).click();
  await waitForCount(page, 'save_metadata_and_update_thumbnail', baselineSaves + 1);
  await waitForCount(page, 'apply_adjustments', baselineRenders + 1);
  await waitForRenderedPointCount(page, 3);
  await expectPointRows(editor, 3);

  const persistence = persistenceSchema.parse((await calls(page, 'save_metadata_and_update_thumbnail')).at(-1)?.args);
  if (
    persistence.adjustments.sceneCurveV1.points.length !== 3 ||
    persistence.transaction.nextAdjustmentRevision !== persistence.transaction.baseAdjustmentRevision + 1
  ) {
    throw new Error(`Scene curve did not persist one exact transaction: ${JSON.stringify(persistence)}`);
  }

  await page.locator('button[data-command-id="undo"]:visible').first().click();
  await waitForCount(page, 'apply_adjustments', baselineRenders + 2);
  await expectPointRows(editor, 2);

  console.log('typed curve edit transaction browser ok');
} catch (error) {
  console.error('typed curve edit transaction browser failed');
  if (page !== undefined) {
    console.error(
      JSON.stringify({
        commands: await page
          .evaluate(() => window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.map(({ command }) => command) ?? [])
          .catch(() => []),
        editor: await page
          .getByTestId('typed-curve-editor')
          .evaluate((element) => ({
            revision: element.getAttribute('data-commit-adjustment-revision'),
            session: element.getAttribute('data-commit-image-session'),
            source: element.getAttribute('data-commit-source-identity'),
          }))
          .catch(() => null),
      }),
    );
  }
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer();
}

async function expectPointRows(editor: ReturnType<Page['getByTestId']>, expected: number) {
  const rows = editor.getByRole('list').locator(':scope > div');
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await rows.count()) === expected) return;
    await editor.page().waitForTimeout(50);
  }
  throw new Error(`Expected ${String(expected)} visible curve point rows, received ${String(await rows.count())}.`);
}
