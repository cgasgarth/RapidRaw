import type { NegativeLabQcProofReport } from '../schemas/negativeLabWorkspaceSchemas';

const CONTACT_SHEET_TILE_WIDTH = 600;
const CONTACT_SHEET_TILE_HEIGHT = 400;

export interface NegativeLabQcContactSheetWarning {
  blocksAutomation: boolean;
  code: 'contact_sheet_requires_split';
  evidence: string;
  frameIds: string[];
  scope: 'frame';
  severity: 'warning';
}

export interface NegativeLabQcContactSheetArtifact {
  contactSheet: {
    artifact: {
      artifactId: string;
      contentHash: string;
      dimensions: { height: number; width: number };
      kind: 'preview';
      storage: 'temp_cache';
    };
    columns: number;
    rows: number;
  };
  frameIds: string[];
  generatedAt: string;
  overlays: Array<{
    frameId: string;
    geometry: {
      coordinateSpace: 'normalized_frame';
      height: number;
      kind: 'rect';
      width: number;
      x: number;
      y: number;
    };
    label: string;
    overlayId: string;
    overlayKind: 'base_sample' | 'density_sample' | 'frame_boundary' | 'warning_badge';
    severity: 'info' | 'warning';
    warningCodes: Array<'contact_sheet_requires_split'>;
  }>;
  positiveVariants: Array<{
    frameId: string;
    operationId: string;
    outputArtifact: {
      artifactId: string;
      contentHash: string;
      dimensions: { height: number; width: number };
      kind: 'preview';
      storage: 'temp_cache';
    };
    outputIntent: 'editable_positive' | 'export_ready_preview' | 'proof_preview';
    sourceContentHash: string;
    sourcePath: string;
    warnings: NegativeLabQcContactSheetWarning[];
  }>;
  proofId: string;
  rollConsistency: {
    anchorFrameIds: string[];
    densityDeltaTolerance: number;
    exposureDeltaToleranceEv: number;
    frameMetrics: Array<{
      densityDelta: number;
      exposureDeltaEv: number;
      frameId: string;
      warningCodes: Array<'contact_sheet_requires_split'>;
      whiteBalanceDelta: number;
      withinTolerance: boolean;
    }>;
    metricVersion: 1;
    whiteBalanceDeltaTolerance: number;
  };
  schemaVersion: 1;
  sessionId: string;
  warnings: NegativeLabQcContactSheetWarning[];
}

export interface NegativeLabQcOverlayVisibility {
  densityWarnings: boolean;
  frameBounds: boolean;
  rejectedMarkers: boolean;
}

interface BuildNegativeLabQcContactSheetArtifactParams {
  generatedAt?: string;
  outputIntent?: 'editable_positive' | 'export_ready_preview' | 'proof_preview';
  overlayVisibility?: NegativeLabQcOverlayVisibility;
  qcDecisionByFrameId?: Readonly<Record<string, 'approved' | 'pending' | 'rejected'>>;
  report: NegativeLabQcProofReport;
  sessionId: string;
  sourcePathsByFrameId?: ReadonlyMap<string, string>;
}

const fnv1a32 = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const stableSha256LikeHash = (namespace: string, payload: unknown): string => {
  const serialized = JSON.stringify({ namespace, payload });
  const digest = Array.from({ length: 8 }, (_, index) => fnv1a32(`${index}:${serialized}`)).join('');
  return `sha256:${digest}`;
};

const warningForBlockedRow = (frameId: string, evidence: string): NegativeLabQcContactSheetWarning => ({
  blocksAutomation: true,
  code: 'contact_sheet_requires_split',
  evidence,
  frameIds: [frameId],
  scope: 'frame',
  severity: 'warning',
});

export const buildNegativeLabQcContactSheetArtifact = ({
  generatedAt = '2026-06-21T00:00:00.000Z',
  outputIntent = 'proof_preview',
  overlayVisibility = {
    densityWarnings: true,
    frameBounds: true,
    rejectedMarkers: true,
  },
  qcDecisionByFrameId = {},
  report,
  sessionId,
  sourcePathsByFrameId = new Map(),
}: BuildNegativeLabQcContactSheetArtifactParams): NegativeLabQcContactSheetArtifact => {
  const columns = report.contactSheetColumnCount;
  const rows = Math.max(1, Math.ceil(report.frames.length / columns));
  const proofPayload = {
    frameIds: report.frames.map((frame) => frame.frameId),
    report,
    sessionId,
  };
  const warnings = report.frames
    .filter((frame) => frame.exportBlockedReason !== null)
    .map((frame) => warningForBlockedRow(frame.frameId, frame.exportBlockedReason ?? 'Frame blocked from export.'));

  return {
    contactSheet: {
      artifact: {
        artifactId: `artifact_negative_lab_qc_${fnv1a32(JSON.stringify(proofPayload))}`,
        contentHash: stableSha256LikeHash('negative-lab-qc-contact-sheet', proofPayload),
        dimensions: {
          height: rows * CONTACT_SHEET_TILE_HEIGHT,
          width: columns * CONTACT_SHEET_TILE_WIDTH,
        },
        kind: 'preview',
        storage: 'temp_cache',
      },
      columns,
      rows,
    },
    frameIds: report.frames.map((frame) => frame.frameId),
    generatedAt,
    overlays: report.frames.flatMap((frame) => {
      const overlays = [];
      if (overlayVisibility.frameBounds) {
        overlays.push({
          frameId: frame.frameId,
          geometry: {
            coordinateSpace: 'normalized_frame' as const,
            height: 0.92,
            kind: 'rect' as const,
            width: 0.92,
            x: 0.04,
            y: 0.04,
          },
          label: `Frame bounds: ${frame.scanLabel}`,
          overlayId: `overlay_negative_lab_qc_bounds_${frame.contactSheetSlot}`,
          overlayKind: 'frame_boundary' as const,
          severity: 'info' as const,
          warningCodes: [],
        });
      }
      if (overlayVisibility.densityWarnings && frame.needsReview) {
        overlays.push({
          frameId: frame.frameId,
          geometry: {
            coordinateSpace: 'normalized_frame' as const,
            height: 0.12,
            kind: 'rect' as const,
            width: 0.18,
            x: 0.04,
            y: 0.84,
          },
          label: frame.exportBlockedReason ?? frame.recommendedAction,
          overlayId: `overlay_negative_lab_qc_density_${frame.contactSheetSlot}`,
          overlayKind: 'density_sample' as const,
          severity: 'warning' as const,
          warningCodes: ['contact_sheet_requires_split' as const],
        });
      }
      if (overlayVisibility.rejectedMarkers && qcDecisionByFrameId[frame.frameId] === 'rejected') {
        overlays.push({
          frameId: frame.frameId,
          geometry: {
            coordinateSpace: 'normalized_frame' as const,
            height: 0.2,
            kind: 'rect' as const,
            width: 0.2,
            x: 0.76,
            y: 0.04,
          },
          label: `Rejected in QC: ${frame.scanLabel}`,
          overlayId: `overlay_negative_lab_qc_rejected_${frame.contactSheetSlot}`,
          overlayKind: 'warning_badge' as const,
          severity: 'warning' as const,
          warningCodes: ['contact_sheet_requires_split' as const],
        });
      }
      return overlays;
    }),
    positiveVariants: report.frames.map((frame) => {
      const sourcePath = sourcePathsByFrameId.get(frame.frameId) ?? frame.scanLabel;
      return {
        frameId: frame.frameId,
        operationId: `negative_lab_qc_positive_${frame.contactSheetSlot}`,
        outputArtifact: {
          artifactId: `artifact_negative_lab_positive_${frame.contactSheetSlot}`,
          contentHash: stableSha256LikeHash('negative-lab-qc-positive', {
            frame,
            outputIntent,
            sourcePath,
          }),
          dimensions: {
            height: CONTACT_SHEET_TILE_HEIGHT,
            width: CONTACT_SHEET_TILE_WIDTH,
          },
          kind: 'preview',
          storage: 'temp_cache',
        },
        outputIntent,
        sourceContentHash: stableSha256LikeHash('negative-lab-qc-source', sourcePath),
        sourcePath,
        warnings:
          frame.exportBlockedReason === null ? [] : [warningForBlockedRow(frame.frameId, frame.exportBlockedReason)],
      };
    }),
    proofId: `negative_lab_qc_proof_${fnv1a32(JSON.stringify(proofPayload))}`,
    rollConsistency: {
      anchorFrameIds: report.frames.slice(0, 1).map((frame) => frame.frameId),
      densityDeltaTolerance: 0.08,
      exposureDeltaToleranceEv: 0.25,
      frameMetrics: report.frames.map((frame) => ({
        densityDelta: frame.needsReview ? 0.08 : 0,
        exposureDeltaEv: 0,
        frameId: frame.frameId,
        warningCodes: frame.needsReview ? ['contact_sheet_requires_split'] : [],
        whiteBalanceDelta: 0,
        withinTolerance: !frame.needsReview,
      })),
      metricVersion: 1,
      whiteBalanceDeltaTolerance: 0.08,
    },
    schemaVersion: 1,
    sessionId,
    warnings,
  };
};
