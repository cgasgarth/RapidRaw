import React from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { MOXCMS_EXPORT_COLOR_CAPABILITIES_V1 } from '../../../packages/rawengine-schema/src/exportColorCapabilities';
import { Invokes } from '../../tauri/commands';
import VisualSmokeApp from './VisualSmokeApp';
import { VISUAL_SMOKE_SCENARIO_IDS } from './visualSmokeScenarios';

import '../../i18n';
import './visual-smoke-styles.css';

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
const buildGeneratedAgentPreviewBytes = async (): Promise<ArrayBuffer> => {
  const canvas = document.createElement('canvas');
  canvas.height = 1024;
  canvas.width = 1536;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Visual smoke agent preview canvas is unavailable.');

  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, '#203c3f');
  gradient.addColorStop(0.52, '#627163');
  gradient.addColorStop(1, '#d5af70');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result === null) reject(new Error('Visual smoke agent preview encoding failed.'));
        else resolve(result);
      },
      'image/jpeg',
      0.86,
    );
  });
  return blob.arrayBuffer();
};
const generatedPreviewBase64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAAAAH/8QAFBABAAAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL//2Q==';
const generatedPreviewDataUrl = `data:image/jpeg;base64,${generatedPreviewBase64}`;

const previewNegativeConversionCommand: string = Invokes.PreviewNegativeConversion;
const renderNegativeLabDryRunPreviewArtifactCommand: string = Invokes.RenderNegativeLabDryRunPreviewArtifact;
const generatePreviewForPathCommand: string = Invokes.GeneratePreviewForPath;
const estimateNegativeBaseFogCommand: string = Invokes.EstimateNegativeBaseFog;
const suggestNegativeLabHighlightPatchCommand: string = Invokes.SuggestNegativeLabHighlightPatchExposure;
const suggestNegativeLabNeutralPatchCommand: string = Invokes.SuggestNegativeLabNeutralPatchRgbBalance;
const suggestNegativeLabShadowPatchCommand: string = Invokes.SuggestNegativeLabShadowPatchBlackPoint;
const convertNegativesCommand: string = Invokes.ConvertNegatives;
const previewGeometryTransformCommand: string = Invokes.PreviewGeometryTransform;
const getLensDistortionParamsCommand: string = Invokes.GetLensDistortionParams;
const getLensfunLensesForMakerCommand: string = Invokes.GetLensfunLensesForMaker;
const getLensfunMakersCommand: string = Invokes.GetLensfunMakers;
const autodetectLensCommand: string = Invokes.AutodetectLens;
const saveCommunityPresetCommand: string = Invokes.SaveCommunityPreset;
const handleExportPresetsToFileCommand: string = Invokes.HandleExportPresetsToFile;
const estimateExportSizesCommand: string = Invokes.EstimateExportSizes;
const getExportColorCapabilitiesCommand: string = Invokes.GetExportColorCapabilities;
const isOriginalFileAvailableCommand: string = Invokes.IsOriginalFileAvailable;

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
    if (command === renderNegativeLabDryRunPreviewArtifactCommand) {
      window.__RAWENGINE_NEGATIVE_LAB_PREVIEW_RETURNS__?.push(generatedPreviewDataUrl);
      return Promise.resolve({
        artifactId: 'artifact_negative_lab_runtime_preview_visual_smoke',
        baseFogSampleSummary: {
          clippedFraction: 0,
          confidence: 0.81,
          densityRange: 0.07,
          densityRgb: {
            b: 0.55,
            g: 0.51,
            r: 0.48,
          },
          meanRgb: {
            b: 0.2818,
            g: 0.309,
            r: 0.3311,
          },
          sampleCount: 400,
          sampleRect: {
            height: 0.6,
            width: 0.12,
            x: 0.02,
            y: 0.2,
          },
          source: 'deterministic_edge_safe_default_rect',
          warningCodes: [],
        },
        contentHash: 'sha256:f7f9bf94f7a57bc7639643ede0d4b28a142ab5d8a5221032833fd09883dcf99b',
        dimensions: {
          height: 1,
          width: 1,
        },
        previewDataUrl: generatedPreviewDataUrl,
        renderer: 'rawengine_negative_lab_runtime_preview_v1',
        storage: 'temp_cache',
      });
    }
    if (command === generatePreviewForPathCommand) {
      const isAgentMediumPreview = Object.entries(args ?? {}).some(
        ([key, value]) => key === 'targetResolution' && value === 1536,
      );
      return isAgentMediumPreview ? buildGeneratedAgentPreviewBytes() : Promise.resolve(generatedPreviewBytes);
    }
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
    if (command === suggestNegativeLabHighlightPatchCommand) {
      return Promise.resolve({
        applicationRisk: 'low',
        applyAllowed: true,
        correctionMagnitudeEv: 0.35,
        currentFrameClippedFraction: 0.08,
        currentFrameExposureOffset: 0.5,
        currentSampleClippedFraction: 0.42,
        currentSampleP99MaxChannel: 1,
        currentSampleRgb: [0.99, 0.97, 0.95],
        effectiveExposure: 0.1,
        offsetClamped: false,
        projectedFrameClippedFraction: 0.04,
        projectedSampleClippedFraction: 0,
        projectedSampleP99MaxChannel: 0.97,
        projectedSampleRgb: [0.91, 0.89, 0.86],
        role: 'highlight',
        sampleRect: { height: 0.16, width: 0.16, x: 0.66, y: 0.18 },
        status: 'suggested',
        suggestedExposureDeltaEv: -0.35,
        suggestedFrameExposureOffset: 0.15,
      });
    }
    if (command === suggestNegativeLabShadowPatchCommand) {
      return Promise.resolve({
        applicationRisk: 'low',
        applyAllowed: true,
        correctionMagnitude: 0.12,
        currentBlackPoint: 0,
        currentSampleP01MinChannel: 0.12,
        currentSampleRgb: [0.14, 0.13, 0.12],
        endpointClamped: false,
        projectedBlackPoint: 0.12,
        projectedSampleP01MinChannel: 0.034,
        projectedSampleRgb: [0.06, 0.05, 0.04],
        role: 'shadow',
        sampleRect: { height: 0.18, width: 0.18, x: 0.18, y: 0.62 },
        status: 'suggested',
        suggestedBlackPointDelta: 0.12,
      });
    }
    if (command === convertNegativesCommand) {
      return Promise.resolve([
        {
          artifactId: 'artifact_negative_lab_visual_smoke',
          conversionBundlePath: '/tmp/rawengine-negative-smoke-positive.tif.conversion-bundle.json',
          dimensions: { height: 900, width: 1200 },
          frameExposureOverrides: { overrides: [], schemaVersion: 1 },
          frameRgbBalanceOverrides: { overrides: [], schemaVersion: 1 },
          outputArtifactId: 'artifact_negative_lab_visual_smoke_output',
          outputFormat: 'tiff16',
          outputHash: 'fnv1a64:0123456789abcdef',
          outputPath: '/tmp/rawengine-negative-smoke-positive.tif',
          path: '/tmp/rawengine-negative-smoke-positive.tif',
          positiveVariantId: 'positive_variant_visual_smoke',
          profileProvenanceHash: null,
          replayPlanHash: 'fnv1a32:2f4a91bc',
          selectedAcquisitionProfile: {
            channelBasis: 'camera_raw',
            displayName: 'Camera RAW linear',
            id: 'camera_raw_linear_v1',
            inputTransform: 'camera_raw_linear',
            provenanceSummary: 'Visual smoke acquisition profile.',
            warningCodes: [],
          },
          selectedProfile: null,
          sidecarPath: '/tmp/rawengine-negative-smoke-positive.tif.rrdata',
          sourceImageRef: '/fixtures/negative-lab/synthetic-color-negative-001.tif',
          sourcePath: '/fixtures/negative-lab/synthetic-color-negative-001.tif',
        },
      ]);
    }
    if (command === previewGeometryTransformCommand) {
      return Promise.resolve(
        `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
  <defs>
    <linearGradient id="geometryPreview" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#1f3441"/>
      <stop offset="0.52" stop-color="#8e7652"/>
      <stop offset="1" stop-color="#efe2b7"/>
    </linearGradient>
  </defs>
  <rect width="960" height="540" fill="#0f1114"/>
  <path d="M90 436c152-86 254-37 380-91 128-55 216-126 398-51v146H90z" fill="#263a41"/>
  <rect x="98" y="62" width="764" height="392" rx="18" fill="url(#geometryPreview)" opacity="0.92"/>
  <path d="M152 386c122-72 246-38 360-78 104-37 194-94 294-54v150H152z" fill="#1f3529" opacity="0.58"/>
  <circle cx="696" cy="126" r="44" fill="#f4dea0" opacity="0.82"/>
  <text x="126" y="492" fill="#f8fafc" font-size="20">visual smoke geometry preview</text>
</svg>`)}`,
      );
    }
    if (command === getLensfunMakersCommand) return Promise.resolve(['Sony', 'Canon']);
    if (command === getLensfunLensesForMakerCommand) return Promise.resolve(['FE 35mm F1.8', 'FE 24-70mm F2.8']);
    if (command === getLensDistortionParamsCommand) {
      return Promise.resolve({
        k1: 0.012,
        k2: -0.004,
        k3: 0,
        model: 1,
        tca_vb: 0.9994,
        tca_vr: 1.0006,
        vig_k1: -0.02,
        vig_k2: 0.004,
        vig_k3: 0,
      });
    }
    if (command === autodetectLensCommand) return Promise.resolve({ maker: 'Sony', model: 'FE 35mm F1.8' });
    if (command === saveCommunityPresetCommand) return Promise.resolve(null);
    if (command === handleExportPresetsToFileCommand) return Promise.resolve(null);
    if (command === estimateExportSizesCommand) return Promise.resolve(18_432_000);
    if (command === getExportColorCapabilitiesCommand) return Promise.resolve(MOXCMS_EXPORT_COLOR_CAPABILITIES_V1);
    if (command === isOriginalFileAvailableCommand) return Promise.resolve(true);
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
