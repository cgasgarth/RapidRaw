import { z } from 'zod';
import {
  type ArtifactHandleV1,
  artifactHandleV1Schema,
  type ToneColorDryRunResultV1,
  toneColorDryRunResultV1Schema,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas';
import {
  type AgentArtifactReview,
  type AgentChatDryRunReview,
  agentArtifactReviewSchema,
  agentChatDryRunReviewSchema,
} from '../../../schemas/agent/agentChatTranscriptSchemas';
import { useEditorStore } from '../../../store/useEditorStore';
import {
  type BasicToneCommandEnvelope,
  buildBasicToneCommandEnvelope,
  buildBasicToneImageCommandContext,
  type LegacyBasicToneAdjustmentPayload,
} from '../../basicToneCommandBridge';
import {
  buildSelectiveColorCommandEnvelope,
  buildSelectiveColorImageCommandContext,
  type SelectiveColorAdjustmentPayload,
  type SelectiveColorCommandColorPipeline,
  type SelectiveColorCommandEnvelope,
} from '../../selectiveColorCommandBridge';
import {
  type AgentLiveBasicTonePixel,
  hashBasicTonePreviewPixels,
  renderBasicTonePreviewPixels,
} from '../session/agentLiveBasicTone';
import { createLiveEditorCoreAppServerBridge } from '../session/agentLiveEditorCoreState';
import { buildAgentImageContextSnapshot } from './agentImageContextSnapshot';
import {
  type AgentPreviewEnvelope,
  agentPreviewEnvelopeSchema,
  buildAgentPreviewEnvelope,
  stableAgentPreviewHash,
} from './agentPreviewEnvelope';

export const AGENT_TONE_COLOR_DRY_RUN_EXPERT_TOOL_NAME = 'rawengine.agent.tone_color.dry_run_expert_edit';

export const agentToneColorDryRunExpertIntentSchema = z.enum([
  'brighten',
  'contrast',
  'cool_white_balance',
  'recover_highlights',
  'saturation_down',
  'saturation_up',
  'warm_white_balance',
]);

export type AgentToneColorDryRunExpertIntent = z.infer<typeof agentToneColorDryRunExpertIntentSchema>;

export interface AgentToneColorDryRunExpertOptions {
  expectedGraphRevision?: string;
  expectedRecipeHash?: string;
  operationId: string;
  prompt: string;
  sessionId: string;
}

export interface AgentToneColorDryRunExpertResult {
  afterArtifact: ArtifactHandleV1;
  afterPreview: AgentPreviewEnvelope;
  afterPreviewHash: string;
  artifactReview: AgentArtifactReview;
  beforeArtifact: ArtifactHandleV1;
  beforePreview: AgentPreviewEnvelope;
  beforePreviewHash: string;
  changedPixelCount: number;
  changedPixelPercent: number;
  commands: readonly [BasicToneCommandEnvelope, SelectiveColorCommandEnvelope];
  dryRunReview: AgentChatDryRunReview;
  dryRuns: readonly ToneColorDryRunResultV1[];
  graphRevisionAfter: string;
  graphRevisionBefore: string;
  intents: readonly AgentToneColorDryRunExpertIntent[];
  recipeHash: string;
  summary: string;
}

const expertResultSchema = z
  .object({
    afterArtifact: artifactHandleV1Schema,
    afterPreview: agentPreviewEnvelopeSchema,
    afterPreviewHash: z.string().trim().min(1),
    artifactReview: agentArtifactReviewSchema,
    beforeArtifact: artifactHandleV1Schema,
    beforePreview: agentPreviewEnvelopeSchema,
    beforePreviewHash: z.string().trim().min(1),
    changedPixelCount: z.number().int().positive(),
    changedPixelPercent: z.number().min(0).max(100),
    dryRunReview: agentChatDryRunReviewSchema,
    dryRuns: z.array(toneColorDryRunResultV1Schema).length(2),
    graphRevisionAfter: z.string().trim().min(1),
    graphRevisionBefore: z.string().trim().min(1),
    intents: z.array(agentToneColorDryRunExpertIntentSchema).min(1),
    recipeHash: z.string().trim().min(1),
    summary: z.string().trim().min(1),
  })
  .strict();

const PREVIEW_PIXELS: readonly AgentLiveBasicTonePixel[] = [
  [0.07, 0.08, 0.1],
  [0.18, 0.2, 0.24],
  [0.36, 0.37, 0.4],
  [0.56, 0.55, 0.52],
  [0.76, 0.71, 0.65],
  [0.93, 0.88, 0.8],
];

const AGENT_COLOR_PIPELINE = {
  chromaticAdaptation: {
    method: 'bradford_v1',
    sourceWhitePoint: { x: 0.3457, y: 0.3585 },
    status: 'math_validated',
    targetWhitePoint: { x: 0.32168, y: 0.33767 },
    warnings: [],
  },
  inputDomain: 'camera_linear_rgb',
  operationDomain: 'acescg_linear_v1',
  renderTarget: {
    bitDepth: 8,
    embedIcc: true,
    intent: 'relative_colorimetric',
    outputProfile: 'display_p3',
    viewTransform: 'rawengine_agx_v1',
  },
  sceneToDisplayTransform: 'rawengine_agx_v1',
  workingSpace: 'acescg_linear_v1',
} as const satisfies SelectiveColorCommandColorPipeline;

const INTENT_MATCHERS = [
  { intent: 'recover_highlights', patterns: ['recover highlight', 'recover highlights', 'save highlight'] },
  { intent: 'warm_white_balance', patterns: ['warm', 'warmer', 'golden', 'white balance warmer'] },
  { intent: 'cool_white_balance', patterns: ['cool', 'cooler', 'less warm', 'remove warm', 'neutralize warm'] },
  { intent: 'contrast', patterns: ['contrast', 'pop', 'deepen', 'punch'] },
  {
    intent: 'saturation_down',
    patterns: ['less saturation', 'decrease saturation', 'reduce saturation', 'desaturate'],
  },
  { intent: 'saturation_up', patterns: ['more saturation', 'increase saturation', 'boost saturation', 'vibrant'] },
  { intent: 'brighten', patterns: ['brighten', 'brighter', 'too dark', 'lift exposure', 'exposure'] },
] as const satisfies ReadonlyArray<{
  intent: AgentToneColorDryRunExpertIntent;
  patterns: readonly string[];
}>;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const detectExpertIntents = (prompt: string): AgentToneColorDryRunExpertIntent[] => {
  const normalized = prompt.toLowerCase();
  const intents = INTENT_MATCHERS.flatMap(({ intent, patterns }) =>
    patterns.some((pattern) => normalized.includes(pattern)) ? [intent] : [],
  );
  return Array.from(new Set(intents));
};

const buildBasicTonePayload = (
  base: LegacyBasicToneAdjustmentPayload,
  intents: readonly AgentToneColorDryRunExpertIntent[],
): LegacyBasicToneAdjustmentPayload => ({
  ...base,
  blacks: clamp(base.blacks + (intents.includes('contrast') ? -7 : -3), -100, 100),
  clarity: clamp(base.clarity + (intents.includes('contrast') ? 14 : 6), -100, 100),
  contrast: clamp(base.contrast + (intents.includes('contrast') ? 18 : 8), -100, 100),
  exposure: clamp(base.exposure + (intents.includes('brighten') ? 0.32 : 0.12), -10, 10),
  highlights: clamp(base.highlights + (intents.includes('recover_highlights') ? -24 : -10), -100, 100),
  saturation: clamp(
    base.saturation +
      (intents.includes('saturation_up') ? 10 : 0) -
      (intents.includes('saturation_down') ? 12 : 0) +
      (intents.includes('warm_white_balance') ? 3 : 0),
    -100,
    100,
  ),
  shadows: clamp(base.shadows + (intents.includes('brighten') ? 12 : 6), -100, 100),
  whites: clamp(base.whites + (intents.includes('recover_highlights') ? -4 : 4), -100, 100),
});

const buildSelectiveColorPayload = (
  intents: readonly AgentToneColorDryRunExpertIntent[],
): SelectiveColorAdjustmentPayload => {
  if (intents.includes('cool_white_balance')) {
    return { adjustment: { hue: -2, luminance: 3, saturation: 7 }, rangeKey: 'blues' };
  }
  if (intents.includes('saturation_down')) {
    return { adjustment: { hue: 0, luminance: 1, saturation: -10 }, rangeKey: 'yellows' };
  }
  return {
    adjustment: {
      hue: intents.includes('warm_white_balance') ? -4 : 0,
      luminance: intents.includes('brighten') ? 4 : 2,
      saturation: intents.includes('saturation_up') || intents.includes('warm_white_balance') ? 12 : 5,
    },
    rangeKey: intents.includes('warm_white_balance') ? 'oranges' : 'blues',
  };
};

const renderSelectiveColorPreviewPixels = (
  pixels: readonly AgentLiveBasicTonePixel[],
  payload: SelectiveColorAdjustmentPayload,
): AgentLiveBasicTonePixel[] =>
  pixels.map((pixel): AgentLiveBasicTonePixel => {
    const saturationScale = 1 + payload.adjustment.saturation / 180;
    const lumaLift = payload.adjustment.luminance / 500;
    const hueBias = payload.adjustment.hue / 720;
    const mean = pixel.reduce((sum, channel) => sum + channel, 0) / pixel.length;
    const blueBias = payload.rangeKey === 'blues' || payload.rangeKey === 'aquas' ? 0.018 : 0;
    const warmBias = payload.rangeKey === 'oranges' || payload.rangeKey === 'yellows' ? 0.018 : 0;

    return [
      Number(clamp(mean + (pixel[0] - mean) * saturationScale + lumaLift + warmBias - hueBias, 0, 1).toFixed(6)),
      Number(clamp(mean + (pixel[1] - mean) * saturationScale + lumaLift, 0, 1).toFixed(6)),
      Number(clamp(mean + (pixel[2] - mean) * saturationScale + lumaLift + blueBias + hueBias, 0, 1).toFixed(6)),
    ];
  });

const buildPreviewArtifact = ({ artifactId, hash }: { artifactId: string; hash: string }): ArtifactHandleV1 =>
  artifactHandleV1Schema.parse({
    artifactId,
    contentHash: `sha256:${hash.padStart(16, '0')}`,
    dimensions: { height: 1, width: PREVIEW_PIXELS.length },
    kind: 'preview',
    storage: 'temp_cache',
  });

const buildExpertPreviewEnvelope = ({
  graphRevision,
  height,
  operationId,
  previewRef,
  purpose,
  recipeSeed,
  renderSeed,
  width,
}: {
  graphRevision: string;
  height: number;
  operationId: string;
  previewRef: string;
  purpose: AgentPreviewEnvelope['purpose'];
  recipeSeed: unknown;
  renderSeed: unknown;
  width: number;
}): AgentPreviewEnvelope =>
  buildAgentPreviewEnvelope({
    crop: null,
    height,
    idSeed: `${operationId}:${purpose}:${graphRevision}`,
    previewRef,
    purpose,
    recipeHash: `recipe:${stableAgentPreviewHash(JSON.stringify(recipeSeed))}`,
    renderHash: `render:${stableAgentPreviewHash(JSON.stringify(renderSeed))}`,
    stableHash: stableAgentPreviewHash,
    width,
    zoom: null,
  });

const formatIntentSummary = (intents: readonly AgentToneColorDryRunExpertIntent[]): string =>
  intents.map((intent) => intent.replaceAll('_', ' ')).join(', ');

const buildDryRunReview = ({
  basicToneDryRun,
  changedPixelPercent,
  hslDryRun,
  intents,
}: {
  basicToneDryRun: ToneColorDryRunResultV1;
  changedPixelPercent: number;
  hslDryRun: ToneColorDryRunResultV1;
  intents: readonly AgentToneColorDryRunExpertIntent[];
}): AgentChatDryRunReview =>
  agentChatDryRunReviewSchema.parse({
    actions: [
      {
        id: 'approve-dry-run',
        label: 'Approve preview',
        reason: 'Dry-run only; approval is required before any edit graph mutation.',
        state: 'available',
      },
      {
        id: 'reject-plan',
        label: 'Reject',
        reason: 'Discard this deterministic dry-run proposal.',
        state: 'available',
      },
      {
        id: 'apply-approved',
        label: 'Apply approved edit',
        reason: 'Apply remains gated behind the accepted dry-run receipt.',
        state: 'disabled',
      },
    ],
    affectedTargets: [
      { id: 'expert-intents', label: 'Intent', value: formatIntentSummary(intents) },
      { id: 'preview-delta', label: 'Changed pixels', value: `${changedPixelPercent}%` },
      { id: 'tool-route', label: 'Tool route', value: 'tonecolor.dry_run_command' },
    ],
    parameterDiffs: [...basicToneDryRun.parameterDiff, ...hslDryRun.parameterDiff].map((diff, index) => ({
      after: String(diff.value),
      before: diff.previousValue === undefined ? 'current' : String(diff.previousValue),
      id: `expert-diff-${index + 1}`,
      label: `${diff.module} ${diff.path}`,
    })),
    warnings: ['Preview artifact is ephemeral and does not mutate history, sidecars, thumbnails, or exports.'],
  });

const buildArtifactReview = ({
  afterArtifact,
  afterPreview,
  afterRevision,
  beforeArtifact,
  beforePreview,
  graphRevisionBefore,
  operationId,
  summary,
}: {
  afterArtifact: ArtifactHandleV1;
  afterPreview: AgentPreviewEnvelope;
  afterRevision: string;
  beforeArtifact: ArtifactHandleV1;
  beforePreview: AgentPreviewEnvelope;
  graphRevisionBefore: string;
  operationId: string;
  summary: string;
}): AgentArtifactReview =>
  agentArtifactReviewSchema.parse({
    auditEntries: [
      {
        artifactId: beforeArtifact.artifactId,
        id: `${operationId}-audit-before`,
        replayLink: `rawengine-agent://replay/${operationId}/before`,
        stage: 'preview',
        summary: 'Captured selected-image before preview without graph mutation.',
        toolCallId: `${operationId}-before-preview`,
      },
      {
        artifactId: afterArtifact.artifactId,
        id: `${operationId}-audit-dry-run`,
        replayLink: `rawengine-agent://replay/${operationId}/after`,
        stage: 'dry_run',
        summary,
        toolCallId: `${operationId}-tonecolor-dry-run`,
      },
    ],
    beforeAfter: {
      afterLabel: 'After dry-run',
      afterRevision,
      beforeLabel: 'Before',
      beforeRevision: graphRevisionBefore,
    },
    previewArtifacts: [
      {
        contentHash: beforeArtifact.contentHash,
        id: beforeArtifact.artifactId,
        kind: 'edit_preview',
        source: 'output.previewArtifacts',
        status: 'ready',
        title: 'Before selected-image preview',
        toolCallId: `${operationId}-before-preview`,
      },
      {
        contentHash: afterArtifact.contentHash,
        id: afterArtifact.artifactId,
        kind: 'edit_preview',
        source: 'output.previewArtifacts',
        status: 'review_required',
        title: 'After tone/color dry-run preview',
        toolCallId: `${operationId}-tonecolor-dry-run`,
      },
    ],
    replayGallery: [
      {
        artifactId: beforeArtifact.artifactId,
        href: beforePreview.previewRef,
        id: `${operationId}-gallery-source`,
        label: 'Source preview',
        role: 'source',
        toolCallId: `${operationId}-before-preview`,
      },
      {
        artifactId: afterArtifact.artifactId,
        href: afterPreview.previewRef,
        id: `${operationId}-gallery-dry-run`,
        label: 'Dry-run preview',
        role: 'dry_run',
        toolCallId: `${operationId}-tonecolor-dry-run`,
      },
      {
        artifactId: afterArtifact.artifactId,
        href: afterPreview.cacheKey,
        id: `${operationId}-gallery-output`,
        label: 'Review output',
        role: 'output',
        toolCallId: `${operationId}-tonecolor-dry-run`,
      },
      {
        artifactId: beforeArtifact.artifactId,
        href: beforePreview.cacheKey,
        id: `${operationId}-gallery-rollback`,
        label: 'Rollback source',
        role: 'rollback',
        toolCallId: `${operationId}-before-preview`,
      },
    ],
  });

export const buildAgentToneColorDryRunExpertEdit = async ({
  expectedGraphRevision,
  expectedRecipeHash,
  operationId,
  prompt,
  sessionId,
}: AgentToneColorDryRunExpertOptions): Promise<AgentToneColorDryRunExpertResult> => {
  const snapshot = buildAgentImageContextSnapshot();
  if (expectedGraphRevision !== undefined && expectedGraphRevision !== snapshot.graphRevision) {
    throw new Error('Tone/color dry-run rejected stale graph revision.');
  }
  if (expectedRecipeHash !== undefined && expectedRecipeHash !== snapshot.initialPreview.recipeHash) {
    throw new Error('Tone/color dry-run rejected stale recipe hash.');
  }

  const intents = detectExpertIntents(prompt);
  if (intents.length === 0) {
    throw new Error(
      'Unsupported tone/color dry-run request. Try brighten, recover highlights, warm/cool white balance, contrast, or saturation.',
    );
  }

  const editor = useEditorStore.getState();
  const selectedImage = editor.selectedImage;
  if (selectedImage === null) throw new Error('Cannot dry-run tone/color expert edit without a selected image.');
  const graphRevisionBefore = snapshot.graphRevision;
  const basicPayload = buildBasicTonePayload(editor.adjustments, intents);
  const selectivePayload = buildSelectiveColorPayload(intents);
  const basicToneCommand = buildBasicToneCommandEnvelope(
    basicPayload,
    buildBasicToneImageCommandContext({
      expectedGraphRevision: graphRevisionBefore,
      imagePath: selectedImage.path,
      operationId: `${operationId}_basic_tone`,
      sessionId,
    }),
    { dryRun: true },
  );
  const selectiveColorCommand = buildSelectiveColorCommandEnvelope(
    selectivePayload,
    buildSelectiveColorImageCommandContext({
      colorPipeline: AGENT_COLOR_PIPELINE,
      expectedGraphRevision: graphRevisionBefore,
      imagePath: selectedImage.path,
      operationId: `${operationId}_selective_color`,
      sessionId,
    }),
    { dryRun: true },
  );

  const bridge = createLiveEditorCoreAppServerBridge();
  const basicToneDispatch = await bridge.dispatch(basicToneCommand);
  if (!basicToneDispatch.ok)
    throw new Error(`Tone/color expert basic-tone dry-run failed: ${basicToneDispatch.message}`);
  const selectiveColorDispatch = await bridge.dispatch(selectiveColorCommand);
  if (!selectiveColorDispatch.ok) {
    throw new Error(`Tone/color expert selective-color dry-run failed: ${selectiveColorDispatch.message}`);
  }
  const basicToneDryRun = toneColorDryRunResultV1Schema.parse(basicToneDispatch.result);
  const hslDryRun = toneColorDryRunResultV1Schema.parse(selectiveColorDispatch.result);

  const afterTonePixels = renderBasicTonePreviewPixels(PREVIEW_PIXELS, basicToneCommand);
  const afterPixels = renderSelectiveColorPreviewPixels(afterTonePixels, selectivePayload);
  const beforePreviewHash = hashBasicTonePreviewPixels(PREVIEW_PIXELS).padStart(16, '0');
  const afterPreviewHash = hashBasicTonePreviewPixels(afterPixels).padStart(16, '0');
  const changedPixelCount = afterPixels.filter((pixel, index) =>
    pixel.some((channel, channelIndex) => channel !== PREVIEW_PIXELS[index]?.[channelIndex]),
  ).length;
  const changedPixelPercent = Number(((changedPixelCount / PREVIEW_PIXELS.length) * 100).toFixed(1));
  const graphRevisionAfter = `history_${useEditorStore.getState().historyIndex}`;
  if (graphRevisionAfter !== graphRevisionBefore) {
    throw new Error('Tone/color expert dry-run mutated the editor graph revision.');
  }
  if (beforePreviewHash === afterPreviewHash || changedPixelCount === 0) {
    throw new Error('Tone/color expert dry-run did not change rendered preview pixels.');
  }

  const recipeHash = `recipe:${stableAgentPreviewHash(
    JSON.stringify({
      basicTone: basicToneCommand.parameters,
      intents,
      selectiveColor: selectiveColorCommand.parameters,
    }),
  )}`;
  const beforeArtifact = buildPreviewArtifact({
    artifactId: `artifact_agent_tone_color_${operationId}_before_preview`,
    hash: beforePreviewHash,
  });
  const afterArtifact = buildPreviewArtifact({
    artifactId: `artifact_agent_tone_color_${operationId}_after_preview`,
    hash: afterPreviewHash,
  });
  const beforePreview = buildExpertPreviewEnvelope({
    graphRevision: graphRevisionBefore,
    height: selectedImage.height,
    operationId,
    previewRef: beforeArtifact.artifactId,
    purpose: 'detail_review',
    recipeSeed: {
      graphRevision: graphRevisionBefore,
      imagePath: selectedImage.path,
      recipeHash: snapshot.initialPreview.recipeHash,
    },
    renderSeed: { artifactHash: beforePreviewHash, graphRevision: graphRevisionBefore, imagePath: selectedImage.path },
    width: selectedImage.width,
  });
  const afterPreview = buildExpertPreviewEnvelope({
    graphRevision: basicToneDryRun.predictedGraphRevision,
    height: selectedImage.height,
    operationId,
    previewRef: afterArtifact.artifactId,
    purpose: 'refresh',
    recipeSeed: { graphRevision: basicToneDryRun.predictedGraphRevision, recipeHash },
    renderSeed: { artifactHash: afterPreviewHash, graphRevision: basicToneDryRun.predictedGraphRevision },
    width: selectedImage.width,
  });
  const summary = `Deterministic tone/color dry-run planned ${formatIntentSummary(intents)} with ${changedPixelPercent}% sampled preview pixels changed.`;
  const dryRunReview = buildDryRunReview({ basicToneDryRun, changedPixelPercent, hslDryRun, intents });
  const artifactReview = buildArtifactReview({
    afterArtifact,
    afterPreview,
    afterRevision: basicToneDryRun.predictedGraphRevision,
    beforeArtifact,
    beforePreview,
    graphRevisionBefore,
    operationId,
    summary,
  });

  const parsed = expertResultSchema.parse({
    afterArtifact,
    afterPreview,
    afterPreviewHash,
    artifactReview,
    beforeArtifact,
    beforePreview,
    beforePreviewHash,
    changedPixelCount,
    changedPixelPercent,
    dryRunReview,
    dryRuns: [basicToneDryRun, hslDryRun],
    graphRevisionAfter,
    graphRevisionBefore,
    intents,
    recipeHash,
    summary,
  });

  return {
    ...parsed,
    commands: [basicToneCommand, selectiveColorCommand],
  };
};
