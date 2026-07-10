import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import {
  type FocusPrivateRawBrowserProof,
  type HdrPrivateRawBrowserProof,
  type LayerMaskPrivateRawBrowserProof,
  loadFocusPrivateRawProof,
  loadHdrPrivateRawProof,
  loadLayerMaskPrivateRawProof,
  loadNegativeLabPublicExportProof,
  loadNegativeLabRealRawPrivateProof,
  loadPanoramaPrivateRawProof,
  loadSrPrivateRawProof,
  type NegativeLabPublicExportBrowserProof,
  type NegativeLabRealRawPrivateBrowserProof,
  type PanoramaPrivateRawBrowserProof,
  type SrPrivateRawBrowserProof,
} from './browser-proofs.ts';
import { readPngDimensions, stopDevServer, waitForDevServer } from './capture-plumbing.ts';
import {
  assertAdjustmentsPanelRetune,
  assertSectionCount,
  assertWorkflowRailSharedScopes,
  prepareScenario,
} from './scenario-assertions.ts';
import {
  baseUrl,
  compactPortraitViewport,
  getScenarioProofRequirements,
  highDpiTargets,
  host,
  outputDir,
  VISUAL_SMOKE_SCENARIO_IDS,
  type VisualSmokeCaptureScenario,
  viewport,
} from './scenarios.ts';

export async function runVisualSmokeCapture({
  requestedScenario,
  selectedScenarios,
}: {
  requestedScenario: string | null;
  selectedScenarios: readonly VisualSmokeCaptureScenario[];
}): Promise<void> {
  await mkdir(outputDir, { recursive: true });

  let serverOutput = '';
  const server = spawn('bun', ['run', 'dev', '--', '--host', host], {
    env: { ...process.env, RAWENGINE_VISUAL_SMOKE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const captureServerOutput = (chunk: Buffer) => {
    serverOutput = `${serverOutput}${chunk.toString()}`.slice(-4_000);
  };

  server.stdout.on('data', captureServerOutput);
  server.stderr.on('data', captureServerOutput);

  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

  try {
    const {
      requiresFocusPrivateRawProof,
      requiresHdrPrivateRawProof,
      requiresLayerMaskPrivateRawProof,
      requiresNegativeLabPublicExportProof,
      requiresNegativeLabRealRawPrivateProof,
      requiresPanoramaPrivateRawProof,
      requiresSrPrivateRawProof,
    } = getScenarioProofRequirements(selectedScenarios);

    const srPrivateRawProof = requiresSrPrivateRawProof ? await loadSrPrivateRawProof() : undefined;
    const focusPrivateRawProof = requiresFocusPrivateRawProof ? await loadFocusPrivateRawProof() : undefined;
    const hdrPrivateRawProof = requiresHdrPrivateRawProof ? await loadHdrPrivateRawProof() : undefined;
    const panoramaPrivateRawProof = requiresPanoramaPrivateRawProof ? await loadPanoramaPrivateRawProof() : undefined;
    const layerMaskPrivateRawProof = requiresLayerMaskPrivateRawProof
      ? await loadLayerMaskPrivateRawProof()
      : undefined;
    const negativeLabPublicExportProof = requiresNegativeLabPublicExportProof
      ? await loadNegativeLabPublicExportProof()
      : undefined;
    const negativeLabRealRawPrivateProof = requiresNegativeLabRealRawPrivateProof
      ? await loadNegativeLabRealRawPrivateProof()
      : undefined;

    await waitForDevServer(baseUrl);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ deviceScaleFactor: 1, viewport });
    await page.addInitScript(() => {
      window.__RAWENGINE_NEGATIVE_LAB_CLIPBOARD_WRITES__ = [];
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.__RAWENGINE_NEGATIVE_LAB_CLIPBOARD_WRITES__.push(text);
          },
        },
      });
    });
    if (srPrivateRawProof !== undefined) {
      await page.addInitScript((proof: SrPrivateRawBrowserProof) => {
        window.__RAWENGINE_SR_PRIVATE_RAW_PROOF__ = proof;
      }, srPrivateRawProof);
    }
    if (focusPrivateRawProof !== undefined) {
      await page.addInitScript((proof: FocusPrivateRawBrowserProof) => {
        window.__RAWENGINE_FOCUS_PRIVATE_RAW_PROOF__ = proof;
      }, focusPrivateRawProof);
    }
    if (hdrPrivateRawProof !== undefined) {
      await page.addInitScript((proof: HdrPrivateRawBrowserProof) => {
        window.__RAWENGINE_HDR_PRIVATE_RAW_PROOF__ = proof;
      }, hdrPrivateRawProof);
    }
    if (panoramaPrivateRawProof !== undefined) {
      await page.addInitScript((proof: PanoramaPrivateRawBrowserProof) => {
        window.__RAWENGINE_PANORAMA_PRIVATE_RAW_PROOF__ = proof;
      }, panoramaPrivateRawProof);
    }
    if (layerMaskPrivateRawProof !== undefined) {
      await page.addInitScript((proof: LayerMaskPrivateRawBrowserProof) => {
        window.__RAWENGINE_LAYER_MASK_PRIVATE_RAW_PROOF__ = proof;
      }, layerMaskPrivateRawProof);
    }
    if (negativeLabPublicExportProof !== undefined) {
      await page.addInitScript((proof: NegativeLabPublicExportBrowserProof) => {
        window.__RAWENGINE_NEGATIVE_LAB_PUBLIC_EXPORT_PROOF__ = proof;
      }, negativeLabPublicExportProof);
    }
    if (negativeLabRealRawPrivateProof !== undefined) {
      await page.addInitScript((proof: NegativeLabRealRawPrivateBrowserProof) => {
        window.__RAWENGINE_NEGATIVE_LAB_REAL_RAW_PRIVATE_PROOF__ = proof;
      }, negativeLabRealRawPrivateProof);
    }

    page.on('pageerror', (error) => {
      throw error;
    });

    const primaryViewportFor = (scenario: VisualSmokeCaptureScenario) =>
      scenario.mode === VISUAL_SMOKE_SCENARIO_IDS.ProfessionalAdjustmentsCompact
        ? compactPortraitViewport
        : (scenario.viewport ?? viewport);
    const captureScenario = async ({
      scenario,
      targetOutputPath,
      targetViewport,
    }: {
      scenario: VisualSmokeCaptureScenario;
      targetOutputPath: string;
      targetViewport: { height: number; width: number };
    }) => {
      await page.setViewportSize(targetViewport);
      await page.goto(`${baseUrl}/visual-smoke.html?scenario=${scenario.appMode ?? scenario.mode}`, {
        waitUntil: 'networkidle',
      });
      await page.locator('[data-visual-smoke-ready="true"]').waitFor({ timeout: 10_000 });
      await page.getByText(scenario.marker, { exact: true }).waitFor({ timeout: 10_000 });
      await assertSectionCount(page, scenario.sectionMinimum);
      await prepareScenario(page, scenario.mode);
      await page.screenshot({ path: targetOutputPath, fullPage: false });
      const dimensions = await readPngDimensions(targetOutputPath);
      if (dimensions.width !== targetViewport.width || dimensions.height !== targetViewport.height) {
        throw new Error(
          `${scenario.mode} dimensions mismatch: expected ${targetViewport.width}x${targetViewport.height}, got ${dimensions.width}x${dimensions.height}`,
        );
      }
    };

    for (const scenario of selectedScenarios) {
      const scenarioViewport = primaryViewportFor(scenario);
      await captureScenario({ scenario, targetOutputPath: scenario.outputPath, targetViewport: scenarioViewport });
      if (scenario.reviewOutputPath !== undefined && scenario.reviewViewport !== undefined) {
        await captureScenario({
          scenario,
          targetOutputPath: scenario.reviewOutputPath,
          targetViewport: scenario.reviewViewport,
        });
      }
      if (scenario.compactOutputPath !== undefined) {
        await captureScenario({
          scenario,
          targetOutputPath: scenario.compactOutputPath,
          targetViewport: compactPortraitViewport,
        });
      }
      if (scenario.reducedMotionOutputPath !== undefined) {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await captureScenario({
          scenario,
          targetOutputPath: scenario.reducedMotionOutputPath,
          targetViewport: scenarioViewport,
        });
        await page.emulateMedia({ reducedMotion: 'no-preference' });
      }
      if (scenario.mode === VISUAL_SMOKE_SCENARIO_IDS.EmptyLibrary) {
        await page.goto(`${baseUrl}/visual-smoke.html?scenario=${VISUAL_SMOKE_SCENARIO_IDS.AdjustmentsPanelRetune}`, {
          waitUntil: 'networkidle',
        });
        await page.locator('[data-visual-smoke-ready="true"]').waitFor({ timeout: 10_000 });
        await page.getByTestId('adjustments-panel-retune-heading').getByText('Light', { exact: true }).waitFor({
          timeout: 10_000,
        });
        await assertAdjustmentsPanelRetune(page);
        await page.goto(`${baseUrl}/visual-smoke.html?scenario=${VISUAL_SMOKE_SCENARIO_IDS.WorkflowRail}`, {
          waitUntil: 'networkidle',
        });
        await page.locator('[data-visual-smoke-ready="true"]').waitFor({ timeout: 10_000 });
        await assertWorkflowRailSharedScopes(page);
      }
    }

    await page.close();

    for (const scenario of selectedScenarios) {
      if (scenario.highDpiOutputPath === undefined || scenario.highDpiDeviceScaleFactor === undefined) continue;

      const scenarioViewport = primaryViewportFor(scenario);
      const highDpiPage = await browser.newPage({
        deviceScaleFactor: scenario.highDpiDeviceScaleFactor,
        viewport: scenarioViewport,
      });
      highDpiPage.on('pageerror', (error) => {
        throw error;
      });
      await highDpiPage.goto(`${baseUrl}/visual-smoke.html?scenario=${scenario.appMode ?? scenario.mode}`, {
        waitUntil: 'networkidle',
      });
      await highDpiPage.locator('[data-visual-smoke-ready="true"]').waitFor({ timeout: 10_000 });
      await highDpiPage.getByText(scenario.marker, { exact: true }).waitFor({ timeout: 10_000 });
      await assertSectionCount(highDpiPage, scenario.sectionMinimum);
      await prepareScenario(highDpiPage, scenario.mode);
      await highDpiPage.screenshot({ path: scenario.highDpiOutputPath, fullPage: false });
      await highDpiPage.close();

      const dimensions = await readPngDimensions(scenario.highDpiOutputPath);
      const expectedWidth = scenarioViewport.width * scenario.highDpiDeviceScaleFactor;
      const expectedHeight = scenarioViewport.height * scenario.highDpiDeviceScaleFactor;
      if (dimensions.width !== expectedWidth || dimensions.height !== expectedHeight) {
        throw new Error(
          `${scenario.mode} high-DPI dimensions mismatch: expected ${expectedWidth}x${expectedHeight}, got ${dimensions.width}x${dimensions.height}`,
        );
      }
    }

    const shouldCheckHighDpi =
      requestedScenario === null || requestedScenario === VISUAL_SMOKE_SCENARIO_IDS.EmptyLibrary;
    for (const target of shouldCheckHighDpi ? highDpiTargets : []) {
      const highDpiPage = await browser.newPage({ deviceScaleFactor: target.deviceScaleFactor, viewport });
      highDpiPage.on('pageerror', (error) => {
        throw error;
      });

      await highDpiPage.goto(`${baseUrl}/visual-smoke.html?scenario=${VISUAL_SMOKE_SCENARIO_IDS.EmptyLibrary}`, {
        waitUntil: 'networkidle',
      });
      await highDpiPage.locator('[data-visual-smoke-ready="true"]').waitFor({ timeout: 10_000 });
      await assertSectionCount(highDpiPage, 4);

      const outputPath = resolve(outputDir, target.name);
      await highDpiPage.screenshot({ path: outputPath, fullPage: false });
      await highDpiPage.close();

      const dimensions = await readPngDimensions(outputPath);
      const expectedWidth = viewport.width * target.deviceScaleFactor;
      const expectedHeight = viewport.height * target.deviceScaleFactor;
      if (dimensions.width !== expectedWidth || dimensions.height !== expectedHeight) {
        throw new Error(
          `${target.name} dimensions mismatch: expected ${expectedWidth}x${expectedHeight}, got ${dimensions.width}x${dimensions.height}`,
        );
      }

      console.log(`visual-smoke ${target.name} ok ${dimensions.width}x${dimensions.height}`);
    }
    console.log(`visual-smoke ok (${selectedScenarios.map((scenario) => scenario.mode).join(', ')})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Executable doesn')) {
      console.error('Playwright Chromium is not installed. Run: bunx playwright install chromium');
    }
    if (serverOutput.trim().length > 0) {
      console.error(`Vite output excerpt:\n${serverOutput.trim()}`);
    }
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
    await stopDevServer(server);
  }
}
