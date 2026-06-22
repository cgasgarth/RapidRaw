import React from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';

import VisualSmokeApp from './VisualSmokeApp';
import { VISUAL_SMOKE_SCENARIO_IDS } from './visualSmokeScenarios';
import { Invokes } from '../../components/ui/AppProperties';
import '../../i18n';
import '../../styles.css';

type VisualSmokeInvoke = (command: string, args?: Record<string, unknown>, options?: unknown) => Promise<unknown>;

interface VisualSmokeTauriInternals {
  convertFileSrc: (filePath: string, protocol?: string) => string;
  invoke: VisualSmokeInvoke;
  transformCallback: (callback: unknown, once?: boolean) => number;
  unregisterCallback: (id: number) => void;
}

interface VisualSmokeInvokeCall {
  args?: Record<string, unknown> | undefined;
  command: string;
  options?: unknown;
}

declare global {
  interface Window {
    __RAWENGINE_NEGATIVE_LAB_PREVIEW_RETURNS__?: Array<string>;
    __RAWENGINE_VISUAL_SMOKE_INVOKES__?: Array<VisualSmokeInvokeCall>;
    __TAURI_INTERNALS__?: VisualSmokeTauriInternals;
    isTauri?: boolean;
  }
}

const negativeLabPreviewParamsProofSchema = z.looseObject({
  base_fog_sample: z.unknown().optional(),
  blue_weight: z.unknown().optional(),
  green_weight: z.unknown().optional(),
  red_weight: z.unknown().optional(),
});

const buildNegativeLabPreviewUrl = (args?: Record<string, unknown>) => {
  const params = negativeLabPreviewParamsProofSchema.safeParse(args?.['params']);
  const proof = params.success
    ? JSON.stringify({
        baseFogSample: params.data.base_fog_sample ?? null,
        blueWeight: params.data.blue_weight ?? null,
        greenWeight: params.data.green_weight ?? null,
        redWeight: params.data.red_weight ?? null,
      })
    : 'default';

  return `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">
  <defs>
    <linearGradient id="negativeLabSmoke" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#ffd0a8"/>
      <stop offset="0.45" stop-color="#8fc7ff"/>
      <stop offset="1" stop-color="#f6f0cf"/>
    </linearGradient>
  </defs>
  <rect width="960" height="640" fill="#151515"/>
  <rect x="96" y="58" width="768" height="524" rx="20" fill="url(#negativeLabSmoke)"/>
  <rect x="136" y="96" width="110" height="448" fill="#291c1a" opacity="0.28"/>
  <rect x="706" y="96" width="118" height="448" fill="#f1ceb0" opacity="0.3"/>
  <circle cx="486" cy="322" r="128" fill="#fff6dc" opacity="0.42"/>
  <path d="M142 468c130-82 229-38 344-88 113-49 188-111 333-58v222H142z" fill="#263a41" opacity="0.74"/>
  <text x="128" y="604" fill="#f8f1dc" font-size="18">${proof}</text>
</svg>`)}`;
};

const generatedPreviewBytes = [
  255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 1, 1, 0, 72, 0, 72, 0, 0, 255, 219, 0, 67, 0, 3, 2, 2, 3, 2, 2, 3, 3,
  3, 3, 4, 3, 3, 4, 5, 8, 5, 5, 4, 4, 5, 10, 7, 7, 6, 8, 12, 10, 12, 12, 11, 10, 11, 11, 13, 14, 18, 16, 13, 14, 17, 14,
  11, 11, 16, 22, 16, 17, 19, 20, 21, 21, 21, 12, 15, 23, 24, 22, 20, 24, 18, 20, 21, 20, 255, 192, 0, 17, 8, 0, 1, 0,
  1, 3, 1, 34, 0, 2, 17, 1, 3, 17, 1, 255, 196, 0, 20, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 255,
  196, 0, 20, 16, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 218, 0, 12, 3, 1, 0, 2, 17, 3, 17, 0, 63, 0,
  191, 255, 217,
];

const previewNegativeConversionCommand: string = Invokes.PreviewNegativeConversion;
const generatePreviewForPathCommand: string = Invokes.GeneratePreviewForPath;
const estimateNegativeBaseFogCommand: string = Invokes.EstimateNegativeBaseFog;
const suggestNegativeLabNeutralPatchCommand: string = Invokes.SuggestNegativeLabNeutralPatchRgbBalance;
const convertNegativesCommand: string = Invokes.ConvertNegatives;
const saveCommunityPresetCommand: string = Invokes.SaveCommunityPreset;
const handleExportPresetsToFileCommand: string = Invokes.HandleExportPresetsToFile;

let callbackId = 0;
window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ = [];
window.__RAWENGINE_NEGATIVE_LAB_PREVIEW_RETURNS__ = [];
window.isTauri = true;
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
  unregisterListener: () => {},
};
window.__TAURI_INTERNALS__ = {
  convertFileSrc: (filePath) => filePath,
  invoke: (command, args, options) => {
    window.__RAWENGINE_VISUAL_SMOKE_INVOKES__?.push({ args, command, options });
    if (command === previewNegativeConversionCommand) {
      const previewUrl = buildNegativeLabPreviewUrl(args);
      window.__RAWENGINE_NEGATIVE_LAB_PREVIEW_RETURNS__?.push(previewUrl);
      return Promise.resolve(previewUrl);
    }
    if (command === generatePreviewForPathCommand) return Promise.resolve(generatedPreviewBytes);
    if (command === estimateNegativeBaseFogCommand) {
      return Promise.resolve({
        baseDensity: [0.145, 0.238, 0.356],
        baseRgb: [0.716, 0.578, 0.441],
        blueWeight: 1.18,
        confidence: 0.91,
        greenWeight: 0.96,
        redWeight: 1.07,
      });
    }
    if (command === suggestNegativeLabNeutralPatchCommand) {
      return Promise.resolve({
        applicationRisk: 'low',
        applyAllowed: true,
        confidence: 0.82,
        correctionMagnitude: 0.07,
        effectiveRgbBalance: { blueWeight: 1.16, greenWeight: 0.93, redWeight: 1.14 },
        neutralityRisk: 'high',
        offsetClamped: false,
        sampleDensity: [0.145, 0.238, 0.356],
        sampleRect: { height: 0.18, width: 0.18, x: 0.18, y: 0.62 },
        sampleRgb: [0.716, 0.578, 0.441],
        suggestedRgbBalanceOffset: { blueWeight: -0.02, greenWeight: -0.03, redWeight: 0.07 },
      });
    }
    if (command === convertNegativesCommand) return Promise.resolve(['/tmp/rawengine-negative-smoke-positive.tif']);
    if (command === saveCommunityPresetCommand) return Promise.resolve(null);
    if (command === handleExportPresetsToFileCommand) return Promise.resolve(null);
    if (command === 'plugin:dialog|save') return Promise.resolve('/tmp/rawengine-film-look-smoke.rrpreset');
    if (command === 'plugin:event|listen') return Promise.resolve(1);
    if (command === 'plugin:event|unlisten') return Promise.resolve(null);
    return Promise.reject(new Error(`Unhandled visual smoke command: ${command}`));
  },
  transformCallback: () => {
    callbackId += 1;
    return callbackId;
  },
  unregisterCallback: () => {},
};

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

const mode = new URLSearchParams(window.location.search).get('scenario') ?? VISUAL_SMOKE_SCENARIO_IDS.EmptyLibrary;

createRoot(rootElement).render(
  <React.StrictMode>
    <VisualSmokeApp mode={mode} />
  </React.StrictMode>,
);
