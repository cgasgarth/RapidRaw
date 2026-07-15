#!/usr/bin/env bun

import { spawn } from 'node:child_process';

import { chromium, type Page } from '@playwright/test';

import { allocateFreeTcpPort } from '../../../../scripts/lib/dev-server-port';

const host = '127.0.0.1';
const port = await allocateFreeTcpPort(host);
const baseUrl = `http://${host}:${String(port)}`;
const sourcePath = '/tmp/rawengine-browser-harness/browser-harness.ARW';
const successorPath = '/tmp/rawengine-browser-harness/browser-harness-2.ARW';
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
  await page.waitForFunction(
    ({ commandName, expectedCount }) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === commandName).length ??
        0) >= expectedCount,
    { commandName: command, expectedCount: expected },
    { timeout: 10_000 },
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
    window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.setAdjustmentsForPath(path, {
      perspectiveCorrection: {
        amount: 100,
        cropPolicy: 'auto_crop',
        guides: [],
        mode: 'auto_full',
        resolvedPlan: null,
      },
    });
  }, sourcePath);
  await page.getByRole('button', { name: /Open Folder/u }).click();
  await page
    .getByRole('button', { name: /browser-harness\.ARW/u })
    .first()
    .dblclick();
  await page.getByRole('main', { name: 'Editor workspace' }).waitFor({ timeout: 10_000 });
  const panelButton = page.getByTestId('right-panel-switcher-button-adjustments');
  if ((await panelButton.getAttribute('aria-pressed')) !== 'true') await panelButton.click();
  const section = page.getByTestId('adjustments-section-transformLens');
  const disclosure = section.locator('button[aria-expanded]').first();
  if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click();
  const controls = page.getByTestId('transform-lens-inspector');
  await controls.waitFor({ timeout: 10_000 });

  const baselineSaves = (await calls(page, 'save_metadata_and_update_thumbnail')).length;
  const baselineRenders = (await calls(page, 'apply_adjustments')).length;
  await page.getByTestId('perspective-analyze-button').click();
  await page.getByTestId('perspective-evidence-summary').waitFor({ timeout: 10_000 });
  await waitForCount(page, 'save_metadata_and_update_thumbnail', baselineSaves + 1);
  await waitForCount(page, 'apply_adjustments', baselineRenders + 1);

  const accepted = await page.evaluate(async () => {
    const module = await import('/src/store/useEditorStore.ts');
    const state = module.useEditorStore.getState();
    return {
      historyIndex: state.historyIndex,
      planFingerprint: state.adjustments.perspectiveCorrection.resolvedPlan?.fingerprint,
      receipt: state.lastEditApplicationReceipt,
      revision: state.adjustmentRevision,
    };
  });
  if (
    accepted.historyIndex !== 1 ||
    accepted.planFingerprint !== 42 ||
    accepted.receipt?.source !== 'geometry-tool' ||
    accepted.receipt.persistence !== 'commit'
  ) {
    throw new Error(`Perspective analysis transaction was not authoritative: ${JSON.stringify(accepted)}`);
  }
  const save = (await calls(page, 'save_metadata_and_update_thumbnail')).at(-1)?.args as
    | {
        adjustments?: { perspectiveCorrection?: { resolvedPlan?: { fingerprint?: number } } };
        path?: string;
        transaction?: unknown;
      }
    | undefined;
  if (
    save?.path !== sourcePath ||
    save.transaction === undefined ||
    save.adjustments?.perspectiveCorrection?.resolvedPlan?.fingerprint !== 42
  ) {
    throw new Error(`Perspective persistence omitted the committed plan: ${JSON.stringify(save)}`);
  }
  const render = (await calls(page, 'apply_adjustments')).at(-1)?.args as
    | {
        request?: {
          editDocumentV2?: {
            extensions?: { legacyAdjustments?: { perspectiveCorrection?: { resolvedPlan?: unknown } } };
          };
        };
      }
    | undefined;
  if (
    render?.request?.editDocumentV2?.extensions?.legacyAdjustments?.perspectiveCorrection?.resolvedPlan === undefined
  ) {
    throw new Error('Perspective plan did not reach the render-authoritative document.');
  }

  const noOpSaves = (await calls(page, 'save_metadata_and_update_thumbnail')).length;
  const noOpRenders = (await calls(page, 'apply_adjustments')).length;
  await page.getByTestId('perspective-analyze-button').click();
  await page.waitForTimeout(500);
  const noOp = await page.evaluate(async () => {
    const module = await import('/src/store/useEditorStore.ts');
    const state = module.useEditorStore.getState();
    return { historyIndex: state.historyIndex, revision: state.adjustmentRevision };
  });
  if (
    noOp.historyIndex !== 1 ||
    noOp.revision !== accepted.revision ||
    (await calls(page, 'save_metadata_and_update_thumbnail')).length !== noOpSaves ||
    (await calls(page, 'apply_adjustments')).length !== noOpRenders
  ) {
    throw new Error(`Exact perspective no-op produced work: ${JSON.stringify(noOp)}`);
  }

  await page.keyboard.press('Meta+z');
  await page.waitForFunction(async () => {
    const module = await import('/src/store/useEditorStore.ts');
    return module.useEditorStore.getState().adjustments.perspectiveCorrection.resolvedPlan === null;
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.perspectiveAnalysisResponses.push({
      delayMs: 350,
      value: {
        analysis: {
          confidence: 0.92,
          horizonAngleDegrees: 1.5,
          identity: {
            analysisDimensions: [1024, 768],
            implementationVersion: 1,
            lensGeometryFingerprint: 2,
            orientationFingerprint: 3,
            sourceRevision: 4,
          },
          lines: [],
          warningCodes: [],
        },
        receipt: {
          abstentionReason: null,
          conditionEstimate: 1,
          guideCount: 0,
          horizontalGuideCount: 0,
          plan: {
            analysisIdentity: {
              analysisDimensions: [1024, 768],
              implementationVersion: 1,
              lensGeometryFingerprint: 2,
              orientationFingerprint: 3,
              sourceRevision: 4,
            },
            confidence: 0.92,
            correctedToSource: [
              [1, 0, 0],
              [0, 1, 0],
              [0, 0, 1],
            ],
            fingerprint: 99,
            implementationVersion: 1,
            retainedArea: 0.81,
            sourceToCorrected: [
              [1, 0, 0],
              [0, 1, 0],
              [0, 0, 1],
            ],
            suggestedCrop: null,
            validPolygon: [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
            ],
            warningCodes: [],
          },
          residualDegreesP95: 0.25,
          verticalGuideCount: 0,
        },
      },
    });
  });
  const staleBaselineSaves = (await calls(page, 'save_metadata_and_update_thumbnail')).length;
  await page.getByTestId('perspective-analyze-button').click();
  await page.evaluate(
    async ({ firstPath, secondPath }) => {
      const module = await import('/src/store/useEditorStore.ts');
      const state = module.useEditorStore.getState();
      const selected = state.selectedImage;
      if (selected === null) throw new Error('Expected selected browser fixture.');
      state.setEditor({
        imageSession: module.createEditorImageSession({
          generation: state.imageSessionId + 1,
          path: secondPath,
          source: 'cache',
        }),
        selectedImage: { ...selected, path: secondPath },
      });
      const successor = module.useEditorStore.getState();
      successor.setEditor({
        imageSession: module.createEditorImageSession({
          generation: successor.imageSessionId + 1,
          path: firstPath,
          source: 'cache',
        }),
        selectedImage: { ...selected, path: firstPath },
      });
    },
    { firstPath: sourcePath, secondPath: successorPath },
  );
  await page.waitForTimeout(600);
  const staleResult = await page.evaluate(async () => {
    const module = await import('/src/store/useEditorStore.ts');
    const state = module.useEditorStore.getState();
    return {
      path: state.selectedImage?.path,
      plan: state.adjustments.perspectiveCorrection.resolvedPlan,
    };
  });
  if (
    staleResult.path !== sourcePath ||
    staleResult.plan !== null ||
    (await calls(page, 'save_metadata_and_update_thumbnail')).length !== staleBaselineSaves
  ) {
    throw new Error(`A→B→A stale perspective analysis committed: ${JSON.stringify(staleResult)}`);
  }

  console.log('perspective analysis edit transaction browser ok');
} catch (error) {
  console.error(serverOutput);
  throw error;
} finally {
  await browser?.close();
  await stopServer();
}
