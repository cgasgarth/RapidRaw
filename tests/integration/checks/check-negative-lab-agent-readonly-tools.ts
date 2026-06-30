#!/usr/bin/env bun

import { ToolType } from '../../../src/components/panel/right/layers/Masks.tsx';
import { RawEngineAppServerRouteMode } from '../../../src/schemas/agent/agentRuntimeSchemas.ts';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import { dispatchAgentLiveEditorTool } from '../../../src/utils/agentLiveToolDispatch.ts';
import {
  NEGATIVE_LAB_AGENT_CONVERSION_PLAN_TOOL_NAME,
  NEGATIVE_LAB_AGENT_INSPECT_TOOL_NAME,
  NEGATIVE_LAB_AGENT_QC_PROOF_TOOL_NAME,
  NEGATIVE_LAB_AGENT_READ_ONLY_TOOL_NAMES,
  NEGATIVE_LAB_AGENT_ROLL_NORMALIZATION_PLAN_TOOL_NAME,
  NEGATIVE_LAB_AGENT_STOCK_FAMILY_PLAN_TOOL_NAME,
} from '../../../src/utils/negativeLabAgentReadOnlyAppServerTools.ts';
import { NegativeLabOutputFormatId } from '../../../src/utils/negativeLabOutputFormatIds.ts';
import {
  buildNegativeLabScanMetricsV1,
  type NegativeLabScanMetricPixel,
} from '../../../src/utils/negativeLabScanMetrics.ts';
import { buildRawEngineAppServerRouteCatalog } from '../../../src/utils/rawEngineAppServerHost.ts';

const sessionId = 'session_negative_lab_agent_readonly';
const selectedFrameIds = ['negative-lab-frame-1', 'negative-lab-frame-2'];
const targetPaths = ['/roll/001.CR3', '/roll/002.CR3', '/roll/003.CR3'];
const includedPaths = ['/roll/001.CR3', '/roll/002.CR3'];
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 14 : 3));

useEditorStore.getState().setEditor({
  adjustments: INITIAL_ADJUSTMENTS,
  brushSettings: { feather: 50, size: 64, tool: ToolType.Brush },
  finalPreviewUrl: 'blob:negative-lab-agent-readonly-before',
  hasRenderedFirstFrame: true,
  histogram: {
    [ActiveChannel.Blue]: { color: '#4D96FF', data: bins },
    [ActiveChannel.Green]: { color: '#6BCB77', data: bins },
    [ActiveChannel.Luma]: { color: '#FFFFFF', data: bins },
    [ActiveChannel.Red]: { color: '#FF6B6B', data: bins },
  },
  history: [INITIAL_ADJUSTMENTS],
  historyIndex: 0,
  selectedImage: {
    exif: { ISO: '200', LensModel: 'Synthetic Negative Lab Readonly Fixture' },
    height: 3000,
    isRaw: false,
    isReady: true,
    originalUrl: 'blob:negative-lab-agent-readonly-original',
    path: targetPaths[0],
    thumbnailUrl: 'blob:negative-lab-agent-readonly-thumb',
    width: 4500,
  },
  uncroppedAdjustedPreviewUrl: null,
});

const frameHealth = {
  activePathIndex: 1,
  baseFogConfidence: 0.82,
  includedPaths,
  previewReady: true,
  targetPaths,
};
const sampleRect = { height: 0.6, width: 0.12, x: 0.02, y: 0.2 };
const conversion = {
  outputFormat: NegativeLabOutputFormatId.JpegProof,
  paths: targetPaths,
  presetId: 'negative_lab.generic.c41.neutral.v1',
  sampleRect,
  scope: 'all' as const,
  suffix: 'Positive',
};

const beforeState = snapshotEditorMutationState();

const inspect = await dispatchAgentLiveEditorTool({
  args: {
    densitometer: {
      baseFogEstimate: {
        baseDensity: [0.146, 0.221, 0.357],
        baseRgb: [0.714, 0.601, 0.44],
        blueWeight: 0.82,
        confidence: 0.91,
        greenWeight: 0.95,
        redWeight: 1.18,
      },
    },
    frameHealth,
    requestId: 'negative-lab-agent-readonly-inspect',
    selectedFrameIds,
    selectedScope: 'all',
    sessionId,
  },
  requestId: 'negative-lab-agent-readonly-inspect',
  runtimeToolName: NEGATIVE_LAB_AGENT_INSPECT_TOOL_NAME,
});

const conversionPlan = await dispatchAgentLiveEditorTool({
  args: {
    conversion,
    requestId: 'negative-lab-agent-readonly-conversion',
    selectedFrameIds,
    selectedScope: 'all',
    sessionId,
  },
  requestId: 'negative-lab-agent-readonly-conversion',
  runtimeToolName: NEGATIVE_LAB_AGENT_CONVERSION_PLAN_TOOL_NAME,
});

const rollPlan = await dispatchAgentLiveEditorTool({
  args: {
    requestId: 'negative-lab-agent-readonly-roll-normalization',
    rollNormalization: {
      ...frameHealth,
      anchorFrameIds: ['negative-lab-frame-1'],
      frameScanMetrics: [
        {
          frameId: 'negative-lab-frame-1',
          metrics: buildNegativeLabScanMetricsV1({
            imageHeight: 20,
            imageWidth: 20,
            pixels: buildDensityPixels(0.72, 0.28),
          }),
          sourcePath: '/roll/001.CR3',
        },
        {
          frameId: 'negative-lab-frame-2',
          metrics: buildNegativeLabScanMetricsV1({
            imageHeight: 20,
            imageWidth: 20,
            pixels: buildDensityPixels(0.31, 0.32),
          }),
          sourcePath: '/roll/002.CR3',
        },
      ],
      mode: 'density_and_balance',
      preserveCreativeAdjustments: true,
      selectedFrameIds,
    },
    selectedFrameIds,
    selectedScope: 'all',
    sessionId,
  },
  requestId: 'negative-lab-agent-readonly-roll-normalization',
  runtimeToolName: NEGATIVE_LAB_AGENT_ROLL_NORMALIZATION_PLAN_TOOL_NAME,
});

const qcProof = await dispatchAgentLiveEditorTool({
  args: {
    qc: frameHealth,
    requestId: 'negative-lab-agent-readonly-qc',
    selectedFrameIds,
    selectedScope: 'all',
    sessionId,
  },
  requestId: 'negative-lab-agent-readonly-qc',
  runtimeToolName: NEGATIVE_LAB_AGENT_QC_PROOF_TOOL_NAME,
});

const stockFamilyPlan = await dispatchAgentLiveEditorTool({
  args: {
    requestId: 'negative-lab-agent-readonly-stock-family',
    selectedFrameIds,
    selectedScope: 'all',
    sessionId,
    stockFamily: {
      outputFormat: NegativeLabOutputFormatId.JpegProof,
      paths: targetPaths,
      sampleRect,
      scope: 'all',
      stockFamilyRegistryId: 'negative_lab.stock_family.c41_portrait_color_negative.v1',
      suffix: 'Positive',
    },
  },
  requestId: 'negative-lab-agent-readonly-stock-family',
  runtimeToolName: NEGATIVE_LAB_AGENT_STOCK_FAMILY_PLAN_TOOL_NAME,
});

const afterState = snapshotEditorMutationState();
if (JSON.stringify(afterState) !== JSON.stringify(beforeState)) {
  throw new Error('Negative Lab read-only agent tools mutated editor state.');
}

assertReadOnlyToolResult(inspect, NEGATIVE_LAB_AGENT_INSPECT_TOOL_NAME);
assertReadOnlyToolResult(conversionPlan, NEGATIVE_LAB_AGENT_CONVERSION_PLAN_TOOL_NAME);
assertReadOnlyToolResult(rollPlan, NEGATIVE_LAB_AGENT_ROLL_NORMALIZATION_PLAN_TOOL_NAME);
assertReadOnlyToolResult(qcProof, NEGATIVE_LAB_AGENT_QC_PROOF_TOOL_NAME);
assertReadOnlyToolResult(stockFamilyPlan, NEGATIVE_LAB_AGENT_STOCK_FAMILY_PLAN_TOOL_NAME);

if (!hasFrameIds(conversionPlan, selectedFrameIds) || !hasFrameIds(stockFamilyPlan, selectedFrameIds)) {
  throw new Error('Negative Lab read-only plan tools did not expose selected frame ids.');
}
if (!hasParameterDiff(conversionPlan) || !hasParameterDiff(rollPlan) || !hasParameterDiff(stockFamilyPlan)) {
  throw new Error('Negative Lab read-only plan tools did not expose parameter diffs.');
}
if (!hasQcArtifact(qcProof)) {
  throw new Error('Negative Lab read-only QC proof did not expose contact-sheet artifact references.');
}

const catalog = buildRawEngineAppServerRouteCatalog();
for (const toolName of NEGATIVE_LAB_AGENT_READ_ONLY_TOOL_NAMES) {
  const route = catalog.find((candidate) => candidate.toolNames.includes(toolName));
  if (route === undefined) throw new Error(`Missing read-only Negative Lab agent catalog route for ${toolName}.`);
  if (!route.modes.includes(RawEngineAppServerRouteMode.Read)) {
    throw new Error(`${toolName} must be cataloged as a read route.`);
  }
  if (!route.runtimeCheckScripts.includes('bun tests/integration/checks/check-negative-lab-agent-readonly-tools.ts')) {
    throw new Error(`${toolName} must advertise focused read-only validation.`);
  }
}

console.log(`negative lab agent read-only tools ok (${NEGATIVE_LAB_AGENT_READ_ONLY_TOOL_NAMES.length} tools)`);

function snapshotEditorMutationState() {
  const state = useEditorStore.getState();
  return {
    adjustments: state.adjustments,
    finalPreviewUrl: state.finalPreviewUrl,
    history: state.history,
    historyIndex: state.historyIndex,
    selectedImagePath: state.selectedImage?.path ?? null,
    uncroppedAdjustedPreviewUrl: state.uncroppedAdjustedPreviewUrl,
  };
}

function buildDensityPixels(p50: number, range: number): NegativeLabScanMetricPixel[] {
  return Array.from({ length: 20 * 20 }, (_, index): NegativeLabScanMetricPixel => {
    const x = index % 20;
    const y = Math.floor(index / 20);
    const density = Math.max(0.04, p50 + ((x + y) / 38 - 0.5) * range);
    return { b: 10 ** -density, g: 10 ** -density, r: 10 ** -density };
  });
}

function assertReadOnlyToolResult(value: unknown, toolName: string): void {
  if (typeof value !== 'object' || value === null) throw new Error(`${toolName} did not return an object.`);
  if (!('toolName' in value) || value.toolName !== toolName) throw new Error(`${toolName} result has wrong tool name.`);
  if (!('proof' in value) || typeof value.proof !== 'object' || value.proof === null) {
    throw new Error(`${toolName} result is missing read-only proof.`);
  }
  const proof = value.proof as { mutates?: unknown; readOnly?: unknown; stateMutationProhibited?: unknown };
  if (proof.mutates !== false || proof.readOnly !== true || proof.stateMutationProhibited !== true) {
    throw new Error(`${toolName} result did not prove non-mutating behavior.`);
  }
  if (!('deterministicHash' in value) || typeof value.deterministicHash !== 'string') {
    throw new Error(`${toolName} result is missing deterministic hash.`);
  }
}

function hasFrameIds(value: unknown, expectedFrameIds: string[]): boolean {
  if (typeof value !== 'object' || value === null || !('affectedFrameIds' in value)) return false;
  const affectedFrameIds = value.affectedFrameIds;
  return Array.isArray(affectedFrameIds) && expectedFrameIds.every((frameId) => affectedFrameIds.includes(frameId));
}

function hasParameterDiff(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || !('parameterDiff' in value)) return false;
  return Array.isArray(value.parameterDiff) && value.parameterDiff.length > 0;
}

function hasQcArtifact(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || !('contactSheetArtifact' in value)) return false;
  const artifact = value.contactSheetArtifact;
  return (
    typeof artifact === 'object' &&
    artifact !== null &&
    'artifactId' in artifact &&
    'contentHash' in artifact &&
    'proofId' in artifact
  );
}
