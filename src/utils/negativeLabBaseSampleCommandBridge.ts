import type {
  NegativeBaseFogDensitometerReadout,
  NegativeBaseFogEstimate,
  NegativeLabBaseFogSampleRect,
} from '../schemas/negativeLabPresetCatalogSchemas';

export type NegativeLabBaseSampleSource = 'auto_full_frame' | 'custom_rect' | 'preset_rect';
export type NegativeLabBaseSampleConfidence = 'blocked' | 'high' | 'low' | 'medium';
export type NegativeLabBaseSampleWarningCode =
  | 'clipped_base_channel'
  | 'low_acquisition_confidence'
  | 'missing_visible_base'
  | 'uneven_illumination';

export interface NegativeLabBaseSampleCommandContext {
  estimate: NegativeBaseFogEstimate;
  frameId: string;
  imagePath: string;
  sampleRect: NegativeLabBaseFogSampleRect | null;
  source: NegativeLabBaseSampleSource;
}

export interface NegativeLabBaseSamplePreviewProofContext extends NegativeLabBaseSampleCommandContext {
  previewBeforeUrl: string | null;
}

export interface NegativeLabBaseSamplePreviewProof {
  command: NegativeLabUpdateBaseSamplesCommand;
  confidence: NegativeLabBaseSampleConfidence;
  previewAfterHash: string;
  previewBeforeHash: string | null;
  previewChanged: boolean;
  previewRevision: number;
  sampleSource: NegativeLabBaseSampleSource;
  warningCodes: NegativeLabBaseSampleWarningCode[];
}

interface NegativeLabUpdateBaseSamplesCommand {
  actor: {
    id: 'negative-lab-ui';
    kind: 'ui';
  };
  approval: {
    approvalClass: 'preview_only';
    reason: string;
    state: 'not_required';
  };
  commandId: string;
  commandType: 'negativeLab.updateBaseSamples';
  correlationId: string;
  dryRun: true;
  idempotencyKey: string;
  parameters: {
    frameSelection: {
      excludeFrameIds: string[];
      frameIds: string[];
      mode: 'selected';
      qcStatuses: string[];
      warningCodes: string[];
    };
    sampleEditMode: 'replace';
    sampleRecords: Array<{
      confidence: NegativeLabBaseSampleConfidence;
      measuredAt: string;
      sampleId: string;
      sampleRegion: {
        frameId: string;
        geometry: {
          coordinateSpace: 'normalized_frame';
          height: number;
          kind: 'rect';
          width: number;
          x: number;
          y: number;
        };
        regionId: string;
        role: 'base_fog';
      };
      sampleScope: 'frame';
      schemaVersion: 1;
      status: 'candidate';
      warningCodes: NegativeLabBaseSampleWarningCode[];
    }>;
    sampleRegions: Array<{
      frameId: string;
      geometry: {
        coordinateSpace: 'normalized_frame';
        height: number;
        kind: 'rect';
        width: number;
        x: number;
        y: number;
      };
      regionId: string;
      role: 'base_fog';
    }>;
    sessionId: string;
  };
  schemaVersion: 1;
  target: {
    imagePath: string;
    kind: 'image';
  };
}

const FULL_FRAME_SAMPLE_RECT: NegativeLabBaseFogSampleRect = {
  height: 1,
  width: 1,
  x: 0,
  y: 0,
};

export const buildNegativeLabBaseSampleHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

export const classifyNegativeLabBaseSampleConfidence = (
  estimate: NegativeBaseFogEstimate,
): NegativeLabBaseSampleConfidence => {
  if (estimate.confidence >= 0.85) return 'high';
  if (estimate.confidence >= 0.6) return 'medium';
  if (estimate.confidence > 0) return 'low';
  return 'blocked';
};

export const buildNegativeLabBaseSampleWarningCodes = (
  estimate: NegativeBaseFogEstimate,
  densitometerReadout: NegativeBaseFogDensitometerReadout | null,
): NegativeLabBaseSampleWarningCode[] => {
  const warnings = new Set<NegativeLabBaseSampleWarningCode>();
  if (estimate.confidence < 0.6) warnings.add('low_acquisition_confidence');
  if (estimate.baseRgb.some((channel) => channel <= 0.01 || channel >= 0.99)) warnings.add('clipped_base_channel');
  if (densitometerReadout?.status === 'strong_cast') warnings.add('uneven_illumination');
  return [...warnings];
};

export const buildNegativeLabUpdateBaseSamplesCommand = (
  context: NegativeLabBaseSampleCommandContext,
  warningCodes: NegativeLabBaseSampleWarningCode[],
  measuredAt: string,
): NegativeLabUpdateBaseSamplesCommand => {
  const sampleRect = context.sampleRect ?? FULL_FRAME_SAMPLE_RECT;
  const confidence = classifyNegativeLabBaseSampleConfidence(context.estimate);
  const sourceHash = buildNegativeLabBaseSampleHash(
    JSON.stringify({
      frameId: context.frameId,
      imagePath: context.imagePath,
      sampleRect,
      source: context.source,
    }),
  ).replace('fnv1a32:', '');
  const sampleId = `base_sample_${sourceHash}`;
  const regionId = `region_${sampleId}`;
  const geometry = {
    coordinateSpace: 'normalized_frame' as const,
    height: sampleRect.height,
    kind: 'rect' as const,
    width: sampleRect.width,
    x: sampleRect.x,
    y: sampleRect.y,
  };
  const sampleRegion = {
    frameId: context.frameId,
    geometry,
    regionId,
    role: 'base_fog' as const,
  };

  return {
    actor: {
      id: 'negative-lab-ui',
      kind: 'ui',
    },
    approval: {
      approvalClass: 'preview_only',
      reason: 'Base/fog sampling updates the live preview before export.',
      state: 'not_required',
    },
    commandId: `command_negative_base_sample_${sourceHash}`,
    commandType: 'negativeLab.updateBaseSamples',
    correlationId: `corr_negative_base_sample_${sourceHash}`,
    dryRun: true,
    idempotencyKey: `idem_negative_base_sample_${sourceHash}`,
    parameters: {
      frameSelection: {
        excludeFrameIds: [],
        frameIds: [context.frameId],
        mode: 'selected',
        qcStatuses: [],
        warningCodes: [],
      },
      sampleEditMode: 'replace',
      sampleRecords: [
        {
          confidence,
          measuredAt,
          sampleId,
          sampleRegion,
          sampleScope: 'frame',
          schemaVersion: 1,
          status: 'candidate',
          warningCodes,
        },
      ],
      sampleRegions: [sampleRegion],
      sessionId: `negative_lab_session_${sourceHash}`,
    },
    schemaVersion: 1,
    target: {
      imagePath: context.imagePath,
      kind: 'image',
    },
  };
};

export const buildNegativeLabBaseSamplePreviewProof = (
  context: NegativeLabBaseSamplePreviewProofContext,
  previewAfterUrl: string,
  densitometerReadout: NegativeBaseFogDensitometerReadout | null,
  previewRevision: number,
): NegativeLabBaseSamplePreviewProof => {
  const warningCodes = buildNegativeLabBaseSampleWarningCodes(context.estimate, densitometerReadout);
  const command = buildNegativeLabUpdateBaseSamplesCommand(context, warningCodes, new Date(0).toISOString());
  const previewBeforeHash =
    context.previewBeforeUrl === null ? null : buildNegativeLabBaseSampleHash(context.previewBeforeUrl);
  const previewAfterHash = buildNegativeLabBaseSampleHash(previewAfterUrl);

  return {
    command,
    confidence: classifyNegativeLabBaseSampleConfidence(context.estimate),
    previewAfterHash,
    previewBeforeHash,
    previewChanged: previewBeforeHash !== previewAfterHash,
    previewRevision,
    sampleSource: context.source,
    warningCodes,
  };
};
