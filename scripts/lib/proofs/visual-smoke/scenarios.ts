import { resolve } from 'node:path';

import {
  VISUAL_SMOKE_SCENARIO_IDS,
  VISUAL_SMOKE_SCENARIOS,
} from '../../../../src/validation/visual/visualSmokeScenarios.ts';

export const host = '127.0.0.1';
export const outputDir = resolve('artifacts/visual-smoke');
export const viewport = { width: 1440, height: 960 };
export const compactPortraitViewport = { width: 390, height: 844 };

export const highDpiTargets = [
  { deviceScaleFactor: 1, name: 'empty-library-1x.png' },
  { deviceScaleFactor: 2, name: 'empty-library-2x.png' },
] as const;

export const scenarios = VISUAL_SMOKE_SCENARIOS.map((scenario) => ({
  ...scenario,
  compactOutputPath: 'compactOutputFile' in scenario ? resolve(outputDir, scenario.compactOutputFile) : undefined,
  highDpiDeviceScaleFactor: 'highDpiDeviceScaleFactor' in scenario ? scenario.highDpiDeviceScaleFactor : undefined,
  highDpiOutputPath: 'highDpiOutputFile' in scenario ? resolve(outputDir, scenario.highDpiOutputFile) : undefined,
  outputPath: resolve(outputDir, scenario.outputFile),
  reducedMotionOutputPath:
    'reducedMotionOutputFile' in scenario ? resolve(outputDir, scenario.reducedMotionOutputFile) : undefined,
  reviewOutputPath: 'reviewOutputFile' in scenario ? resolve(outputDir, scenario.reviewOutputFile) : undefined,
  reviewViewport: 'reviewViewport' in scenario ? scenario.reviewViewport : undefined,
  viewport: 'viewport' in scenario ? scenario.viewport : undefined,
}));

export type VisualSmokeCaptureScenario = (typeof scenarios)[number];

export function readRequestedScenario(argv: string[]): string | null {
  const scenarioArgIndex = argv.indexOf('--scenario');
  return scenarioArgIndex >= 0 ? (argv[scenarioArgIndex + 1] ?? null) : null;
}

export function printUsage(): void {
  console.log(`Usage: bun scripts/proofs/capture-visual-smoke.ts [--scenario <id>] [--list-scenarios]\n`);
  console.log('Runs browser visual smoke capture for RawEngine UI scenarios.');
  console.log('Use --list-scenarios to print valid scenario IDs without launching a browser.');
}

export function printScenarioList(): void {
  for (const scenario of scenarios) {
    console.log(`${scenario.mode}\t${scenario.marker}`);
  }
}

export function getSelectedVisualSmokeScenarios(requestedScenario: string | null): VisualSmokeCaptureScenario[] {
  const selectedScenarios =
    requestedScenario === null ? scenarios : scenarios.filter((scenario) => scenario.mode === requestedScenario);

  if (selectedScenarios.length === 0) {
    throw new Error(`Unknown visual smoke scenario: ${requestedScenario ?? '<missing>'}`);
  }

  return selectedScenarios;
}

export function getScenarioProofRequirements(selectedScenarios: readonly VisualSmokeCaptureScenario[]) {
  return {
    requiresFocusPrivateRawProof: selectedScenarios.some(
      (scenario) =>
        scenario.mode === VISUAL_SMOKE_SCENARIO_IDS.FocusPrivateRawUi ||
        scenario.mode === VISUAL_SMOKE_SCENARIO_IDS.FocusPrivateRawModalReview,
    ),
    requiresHdrPrivateRawProof: selectedScenarios.some(
      (scenario) =>
        scenario.mode === VISUAL_SMOKE_SCENARIO_IDS.HdrPrivateRawUi ||
        scenario.mode === VISUAL_SMOKE_SCENARIO_IDS.HdrPrivateRawEditorHandoff,
    ),
    requiresLayerMaskPrivateRawProof: selectedScenarios.some(
      (scenario) => scenario.mode === VISUAL_SMOKE_SCENARIO_IDS.LayerMaskPrivateRawUi,
    ),
    requiresNegativeLabPublicExportProof: selectedScenarios.some(
      (scenario) => scenario.mode === VISUAL_SMOKE_SCENARIO_IDS.NegativeLabPublicExportReview,
    ),
    requiresNegativeLabRealRawPrivateProof: selectedScenarios.some(
      (scenario) => scenario.mode === VISUAL_SMOKE_SCENARIO_IDS.NegativeLabRealRawPrivateReview,
    ),
    requiresPanoramaPrivateRawProof: selectedScenarios.some(
      (scenario) => scenario.mode === VISUAL_SMOKE_SCENARIO_IDS.PanoramaPrivateRawUi,
    ),
    requiresSrPrivateRawProof: selectedScenarios.some(
      (scenario) =>
        scenario.mode === VISUAL_SMOKE_SCENARIO_IDS.SrPrivateRawUi ||
        scenario.mode === VISUAL_SMOKE_SCENARIO_IDS.SrPrivateRawModalReview,
    ),
  };
}

export { VISUAL_SMOKE_SCENARIO_IDS };
