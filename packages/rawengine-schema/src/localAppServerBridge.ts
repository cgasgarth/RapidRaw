import { z } from 'zod';

import { openComputationalMergeDerivedSourceV1 } from './computational-merge/computationalMergeDerivedSourceRuntime.js';
import { EditCommandBus, type EditCommandBusContext, type EditCommandDispatchResult } from './editCommandBus.js';
import { FocusStackAppServerRuntimeToolBusV1 } from './focus-stack/focusStackAppServerRuntime.js';
import { HdrAppServerRuntimeToolBusV1 } from './hdr/hdrAppServerRuntime.js';
import { LinearGradientMaskCommandRuntime } from './linearGradientMaskCommandRuntime.js';
import { PanoramaAppServerRuntimeToolBusV1 } from './panorama/panoramaAppServerRuntime.js';
import {
  ApprovalClass,
  aiEnhancementApplyResultV1Schema,
  aiEnhancementCommandEnvelopeV1Schema,
  aiEnhancementDryRunResultV1Schema,
  aiToolApplyResultV1Schema,
  aiToolCommandEnvelopeV1Schema,
  aiToolDryRunResultV1Schema,
  type ComputationalMergeCommandEnvelopeV1,
  type ComputationalMergeCommandTypeV1,
  type ComputationalMergeDerivedSourceOpenRequestV1,
  type ComputationalMergeFamilyV1,
  computationalMergeCommandEnvelopeV1Schema,
  computationalMergeDerivedSourceOpenRequestV1Schema,
  type DetailEffectsCommandEnvelopeV1,
  type DetailEffectsPatchV1,
  detailEffectsCommandEnvelopeV1Schema,
  detailEffectsDryRunResultV1Schema,
  detailEffectsMutationResultV1Schema,
  type LayerMaskCommandEnvelopeV1,
  type LensProfileCommandEnvelopeV1,
  type LensProfilePatchV1,
  layerMaskCommandEnvelopeV1Schema,
  lensProfileCommandEnvelopeV1Schema,
  lensProfileDryRunResultV1Schema,
  lensProfileMutationResultV1Schema,
  type ProjectLibrarySnapshotV1,
  projectLibrarySnapshotV1Schema,
  type RawEngineToolRegistryV1,
  rawEngineToolRegistryV1Schema,
  type ToneColorCommandEnvelopeV1,
  type ToneColorDryRunResultV1,
  type ToneColorHslBandV1,
  type ToneColorMutationResultV1,
  toneColorCommandEnvelopeV1Schema,
  toneColorDryRunResultV1Schema,
  toneColorMutationResultV1Schema,
} from './rawEngineSchemas.js';
import { SuperResolutionAppServerRuntimeToolBusV1 } from './super-resolution/superResolutionAppServerRuntime.js';
import { rawEngineDefaultToolRegistryV1 } from './toolRegistry.js';

export const RawEngineLocalAppServerCommandType = {
  EditorStateQuery: 'rawengine.local.editorState.query',
  ImageMetadataQuery: 'rawengine.local.imageMetadata.query',
  ProjectMetadataQuery: 'rawengine.local.projectMetadata.query',
  SelectedImagesQuery: 'rawengine.local.selectedImages.query',
  ToolRegistryQuery: 'rawengine.local.toolRegistry.query',
} as const;

export type RawEngineLocalAppServerCommandType =
  (typeof RawEngineLocalAppServerCommandType)[keyof typeof RawEngineLocalAppServerCommandType];

export const rawEngineLocalAppServerToolRegistryQueryV1Schema = z
  .object({
    commandType: z.literal(RawEngineLocalAppServerCommandType.ToolRegistryQuery),
    requestId: z.string().trim().min(1),
  })
  .strict();

const rawEngineLocalAppServerReadQueryBaseV1Schema = z
  .object({
    commandId: z.string().trim().min(1),
    correlationId: z.string().trim().min(1),
    dryRun: z.literal(false),
    requestId: z.string().trim().min(1),
  })
  .strict();

export const rawEngineLocalAppServerProjectMetadataQueryV1Schema = rawEngineLocalAppServerReadQueryBaseV1Schema.extend({
  commandType: z.literal(RawEngineLocalAppServerCommandType.ProjectMetadataQuery),
});

export const rawEngineLocalAppServerSelectedImagesQueryV1Schema = rawEngineLocalAppServerReadQueryBaseV1Schema.extend({
  commandType: z.literal(RawEngineLocalAppServerCommandType.SelectedImagesQuery),
});

export const rawEngineLocalAppServerImageMetadataQueryV1Schema = rawEngineLocalAppServerReadQueryBaseV1Schema.extend({
  commandType: z.literal(RawEngineLocalAppServerCommandType.ImageMetadataQuery),
  imagePath: z.string().trim().min(1),
});

export const rawEngineLocalAppServerEditorStateQueryV1Schema = rawEngineLocalAppServerReadQueryBaseV1Schema.extend({
  commandType: z.literal(RawEngineLocalAppServerCommandType.EditorStateQuery),
});

export const rawEngineLocalAppServerProjectMetadataResultV1Schema = z
  .object({
    activeAlbumId: z.string().trim().min(1).nullable(),
    currentFolderPath: z.string().trim().min(1).nullable(),
    filterCriteria: projectLibrarySnapshotV1Schema.shape.filterCriteria,
    imageCount: z.number().int().nonnegative(),
    libraryActivePath: z.string().trim().min(1).nullable(),
    pinnedFolderCount: z.number().int().nonnegative(),
    rootPaths: z.array(z.string().trim().min(1)),
    selectedCount: z.number().int().nonnegative(),
    sortCriteria: projectLibrarySnapshotV1Schema.shape.sortCriteria,
  })
  .strict();

export const rawEngineLocalAppServerSelectedImagesResultV1Schema = z
  .object({
    images: z.array(projectLibrarySnapshotV1Schema.shape.imageList.element),
    selectedPaths: z.array(z.string().trim().min(1)),
  })
  .strict();

export const rawEngineLocalAppServerImageMetadataResultV1Schema = z
  .object({
    image: projectLibrarySnapshotV1Schema.shape.imageList.element,
  })
  .strict();

export const rawEngineLocalAppServerEditorStateResultV1Schema = z
  .object({
    activeImagePath: z.string().trim().min(1).nullable(),
    currentFolderPath: z.string().trim().min(1).nullable(),
    selectedImagePaths: z.array(z.string().trim().min(1)),
    visibleImageCount: z.number().int().nonnegative(),
  })
  .strict();

export const rawEngineAgentInitialPreviewReceiptV1Schema = z
  .object({
    colorPipeline: z
      .object({
        encodedProfile: z.literal('srgb-preview'),
        outputProfile: z.literal('srgb'),
        previewTransform: z.literal('editor-preview-to-srgb-jpeg'),
        workingSpace: z.literal('rawengine-scene-linear'),
      })
      .strict(),
    contentHash: z.string().regex(/^sha256:[a-f0-9]{16,64}$/u),
    graphRevision: z.string().trim().min(1),
    imagePath: z.string().trim().min(1),
    preview: z
      .object({
        accessScope: z.literal('local_private'),
        artifactId: z.string().trim().min(1),
        encodedFormat: z.literal('jpeg'),
        height: z.number().int().positive(),
        includesOriginalRaw: z.literal(false),
        longEdgePx: z.literal(1536),
        mediaType: z.literal('image/jpeg'),
        previewRef: z.string().trim().min(1),
        purpose: z.literal('initial_context'),
        quality: z.literal(0.86),
        recipeHash: z.string().trim().min(1),
        renderHash: z.string().trim().min(1),
        width: z.number().int().positive(),
      })
      .strict(),
    proofContext: z
      .object({
        stale: z.boolean(),
        transport: z.literal('codex_app_server'),
      })
      .strict(),
    requestId: z.string().trim().min(1),
    schemaVersion: z.literal(1),
    sessionId: z.string().trim().min(1),
    toolName: z.literal('rawengine.agent.initial_prompt_preview'),
  })
  .strict();

export type RawEngineAgentInitialPreviewReceiptV1 = z.infer<typeof rawEngineAgentInitialPreviewReceiptV1Schema>;

export const rawEngineAgentPreviewRefreshReceiptV1Schema = z
  .object({
    colorPipeline: z
      .object({
        encodedProfile: z.literal('srgb-preview'),
        outputProfile: z.literal('srgb'),
        previewTransform: z.literal('editor-preview-to-srgb-jpeg'),
        workingSpace: z.literal('rawengine-scene-linear'),
      })
      .strict(),
    contentHash: z.string().regex(/^sha256:[a-f0-9]{16,64}$/u),
    graphRevision: z.string().trim().min(1),
    imagePath: z.string().trim().min(1),
    preview: z
      .object({
        accessScope: z.literal('local_private'),
        artifactId: z.string().trim().min(1),
        encodedFormat: z.literal('jpeg'),
        height: z.number().int().positive(),
        includesOriginalRaw: z.literal(false),
        longEdgePx: z.number().int().min(256).max(2048),
        mediaType: z.literal('image/jpeg'),
        previewRef: z.string().trim().min(1),
        purpose: z.enum(['detail_review', 'refresh']),
        quality: z.number().min(0.5).max(0.95),
        recipeHash: z.string().trim().min(1),
        renderHash: z.string().trim().min(1),
        width: z.number().int().positive(),
      })
      .strict(),
    proofContext: z
      .object({
        expectedRecipeHash: z.string().trim().min(1),
        sourceToolName: z.string().trim().min(1),
        stale: z.boolean(),
        transport: z.literal('codex_app_server'),
      })
      .strict(),
    requestId: z.string().trim().min(1),
    schemaVersion: z.literal(1),
    sessionId: z.string().trim().min(1),
    toolName: z.literal('rawengine.agent.preview.render'),
    turn: z.number().int().positive(),
  })
  .strict()
  .refine((receipt) => receipt.proofContext.expectedRecipeHash === receipt.preview.recipeHash, {
    message: 'Refresh receipt expected recipe hash must match the preview recipe hash.',
    path: ['proofContext', 'expectedRecipeHash'],
  });

export type RawEngineAgentPreviewRefreshReceiptV1 = z.infer<typeof rawEngineAgentPreviewRefreshReceiptV1Schema>;

export const rawEngineLocalAppServerBasicToneDryRunCommandV1Schema = toneColorCommandEnvelopeV1Schema.superRefine(
  (command, context) => {
    if (command.commandType !== 'toneColor.setBasicTone') {
      context.addIssue({
        code: 'custom',
        message: 'Local app-server bridge currently supports basic-tone dry-runs only.',
        path: ['commandType'],
      });
    }

    if (!command.dryRun) {
      context.addIssue({
        code: 'custom',
        message: 'Local app-server bridge dry-run handler rejects mutating tone/color commands.',
        path: ['dryRun'],
      });
    }

    if (command.approval.approvalClass !== ApprovalClass.PreviewOnly) {
      context.addIssue({
        code: 'custom',
        message: 'Local app-server bridge dry-run handler requires preview-only approval.',
        path: ['approval', 'approvalClass'],
      });
    }
  },
);

export const rawEngineLocalAppServerBasicToneCommandV1Schema = toneColorCommandEnvelopeV1Schema.superRefine(
  (command, context) => {
    if (command.commandType !== 'toneColor.setBasicTone') {
      context.addIssue({
        code: 'custom',
        message: 'Local app-server bridge currently supports basic-tone commands only.',
        path: ['commandType'],
      });
    }
  },
);

export const rawEngineLocalAppServerHslCommandV1Schema = toneColorCommandEnvelopeV1Schema.superRefine(
  (command, context) => {
    if (command.commandType !== 'toneColor.adjustHsl') {
      context.addIssue({
        code: 'custom',
        message: 'Local app-server bridge expected an HSL/selective-color command.',
        path: ['commandType'],
      });
    }
  },
);

export const rawEngineLocalAppServerSkinToneUniformityCommandV1Schema = toneColorCommandEnvelopeV1Schema.superRefine(
  (command, context) => {
    if (command.commandType !== 'toneColor.adjustSkinToneUniformity') {
      context.addIssue({
        code: 'custom',
        message: 'Local app-server bridge expected a skin-tone uniformity command.',
        path: ['commandType'],
      });
    }
  },
);

export type RawEngineLocalAppServerToolRegistryQueryV1 = z.infer<
  typeof rawEngineLocalAppServerToolRegistryQueryV1Schema
>;
export type RawEngineLocalAppServerProjectMetadataQueryV1 = z.infer<
  typeof rawEngineLocalAppServerProjectMetadataQueryV1Schema
>;
export type RawEngineLocalAppServerSelectedImagesQueryV1 = z.infer<
  typeof rawEngineLocalAppServerSelectedImagesQueryV1Schema
>;
export type RawEngineLocalAppServerImageMetadataQueryV1 = z.infer<
  typeof rawEngineLocalAppServerImageMetadataQueryV1Schema
>;
export type RawEngineLocalAppServerEditorStateQueryV1 = z.infer<typeof rawEngineLocalAppServerEditorStateQueryV1Schema>;
export type RawEngineLocalAppServerProjectMetadataResultV1 = z.infer<
  typeof rawEngineLocalAppServerProjectMetadataResultV1Schema
>;
export type RawEngineLocalAppServerSelectedImagesResultV1 = z.infer<
  typeof rawEngineLocalAppServerSelectedImagesResultV1Schema
>;
export type RawEngineLocalAppServerImageMetadataResultV1 = z.infer<
  typeof rawEngineLocalAppServerImageMetadataResultV1Schema
>;
export type RawEngineLocalAppServerEditorStateResultV1 = z.infer<
  typeof rawEngineLocalAppServerEditorStateResultV1Schema
>;
export type RawEngineLocalAppServerBasicToneDryRunCommandV1 = z.infer<
  typeof rawEngineLocalAppServerBasicToneDryRunCommandV1Schema
>;
export type RawEngineLocalAppServerBasicToneCommandV1 = z.infer<typeof rawEngineLocalAppServerBasicToneCommandV1Schema>;
export type RawEngineLocalAppServerHslCommandV1 = z.infer<typeof rawEngineLocalAppServerHslCommandV1Schema>;
export type RawEngineLocalAppServerSkinToneUniformityCommandV1 = z.infer<
  typeof rawEngineLocalAppServerSkinToneUniformityCommandV1Schema
>;

export const rawEngineLocalAppServerAiToolCommandV1Schema = aiToolCommandEnvelopeV1Schema;

export type RawEngineLocalAppServerAiToolCommandV1 = z.infer<typeof rawEngineLocalAppServerAiToolCommandV1Schema>;

export const rawEngineLocalAppServerAiEnhancementCommandV1Schema = aiEnhancementCommandEnvelopeV1Schema;

export type RawEngineLocalAppServerAiEnhancementCommandV1 = z.infer<
  typeof rawEngineLocalAppServerAiEnhancementCommandV1Schema
>;

export const rawEngineLocalAppServerComputationalMergeCommandV1Schema = computationalMergeCommandEnvelopeV1Schema;

export type RawEngineLocalAppServerComputationalMergeCommandV1 = z.infer<
  typeof rawEngineLocalAppServerComputationalMergeCommandV1Schema
>;

export const rawEngineLocalAppServerComputationalMergeDerivedSourceOpenRequestV1Schema =
  computationalMergeDerivedSourceOpenRequestV1Schema;

export type RawEngineLocalAppServerComputationalMergeDerivedSourceOpenRequestV1 = z.infer<
  typeof rawEngineLocalAppServerComputationalMergeDerivedSourceOpenRequestV1Schema
>;

export const rawEngineLocalAppServerDetailEffectsCommandV1Schema = detailEffectsCommandEnvelopeV1Schema;

export type RawEngineLocalAppServerDetailEffectsCommandV1 = z.infer<
  typeof rawEngineLocalAppServerDetailEffectsCommandV1Schema
>;

export const rawEngineLocalAppServerLensProfileCommandV1Schema = lensProfileCommandEnvelopeV1Schema;

export type RawEngineLocalAppServerLensProfileCommandV1 = z.infer<
  typeof rawEngineLocalAppServerLensProfileCommandV1Schema
>;

export const rawEngineLocalAppServerLayerMaskCommandV1Schema = layerMaskCommandEnvelopeV1Schema.superRefine(
  (command, context) => {
    if (
      command.commandType !== 'layerMask.createGradientMask' ||
      command.parameters.gradient.gradientKind !== 'linear'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Local app-server bridge currently supports linear gradient layer-mask commands only.',
        path: ['commandType'],
      });
    }
  },
);

export type RawEngineLocalAppServerLayerMaskCommandV1 = z.infer<typeof rawEngineLocalAppServerLayerMaskCommandV1Schema>;

type BasicToneCommandV1 = Extract<ToneColorCommandEnvelopeV1, { commandType: 'toneColor.setBasicTone' }>;
type BasicToneAdjustmentParameterKeyV1 = Exclude<
  keyof BasicToneCommandV1['parameters'],
  'acceptedDryRunPlanHash' | 'acceptedDryRunPlanId'
>;

const rawEngineLocalAppServerAuditCommandProbeV1Schema = z.looseObject({
  approval: z
    .looseObject({
      state: z.string().trim().min(1),
    })
    .optional(),
  commandId: z.string().trim().min(1),
  commandType: z.string().trim().min(1),
  correlationId: z.string().trim().min(1),
  dryRun: z.boolean(),
  expectedGraphRevision: z.string().trim().min(1).optional(),
  parameters: z
    .looseObject({
      acceptedDryRunPlanHash: z.string().trim().min(1).optional(),
      acceptedDryRunPlanId: z.string().trim().min(1).optional(),
      providerClass: z.enum(['local_model', 'self_hosted_connector', 'cloud_service']).optional(),
      providerId: z.string().trim().min(1).optional(),
    })
    .optional(),
});

const AI_COMMAND_TYPE_TO_APP_SERVER_TOOL_NAME = {
  'ai.enhancement.apply': 'ai.enhancement.apply_command',
  'ai.enhancement.dryRun': 'ai.enhancement.dry_run_command',
  'ai.mask.applySubject': 'ai.mask.apply_subject',
  'ai.mask.generateSubject': 'ai.mask.dry_run_subject',
  'detailEffects.applyAdjustments': 'detail.effects.apply_command',
  'detailEffects.dryRunAdjustments': 'detail.effects.dry_run_command',
  'lensProfile.applyCorrection': 'lensprofile.apply_command',
  'lensProfile.dryRunCorrection': 'lensprofile.dry_run_command',
  [RawEngineLocalAppServerCommandType.EditorStateQuery]: 'agent.editor_state.query',
  [RawEngineLocalAppServerCommandType.ImageMetadataQuery]: 'agent.image_metadata.query',
  [RawEngineLocalAppServerCommandType.ProjectMetadataQuery]: 'agent.project_metadata.query',
  [RawEngineLocalAppServerCommandType.SelectedImagesQuery]: 'agent.selected_images.query',
} as const satisfies Partial<Record<string, string>>;

const AI_COMMAND_TYPE_TO_APP_SERVER_TOOL_NAME_LOOKUP = new Map<string, string>(
  Object.entries(AI_COMMAND_TYPE_TO_APP_SERVER_TOOL_NAME),
);

const RAW_ENGINE_LOCAL_APP_SERVER_EXECUTABLE_TOOL_NAMES = new Set([
  'agent.editor_state.query',
  'agent.image_metadata.query',
  'agent.project_metadata.query',
  'agent.selected_images.query',
  'ai.enhancement.apply_command',
  'ai.enhancement.dry_run_command',
  'ai.mask.apply_subject',
  'ai.mask.dry_run_subject',
  'computationalmerge.focus_stack.apply_command',
  'computationalmerge.focus_stack.dry_run_command',
  'computationalmerge.focus_stack.open_derived_source',
  'computationalmerge.hdr.apply_command',
  'computationalmerge.hdr.dry_run_command',
  'computationalmerge.hdr.open_derived_source',
  'computationalmerge.panorama.apply_command',
  'computationalmerge.panorama.dry_run_command',
  'computationalmerge.panorama.open_derived_source',
  'computationalmerge.super_resolution.apply_command',
  'computationalmerge.super_resolution.dry_run_command',
  'computationalmerge.super_resolution.open_derived_source',
  'detail.effects.apply_command',
  'detail.effects.dry_run_command',
  'layermask.apply_command',
  'layermask.dry_run_command',
  'lensprofile.apply_command',
  'lensprofile.dry_run_command',
  'tonecolor.apply_command',
  'tonecolor.dry_run_command',
]);

export const filterRawEngineLocalAppServerExecutableToolRegistry = (
  registry: RawEngineToolRegistryV1,
): RawEngineToolRegistryV1 =>
  rawEngineToolRegistryV1Schema.parse({
    ...registry,
    tools: registry.tools.filter((tool) => RAW_ENGINE_LOCAL_APP_SERVER_EXECUTABLE_TOOL_NAMES.has(tool.toolName)),
  });

const rawEngineLocalAppServerAuditResultProbeV1Schema = z.looseObject({
  mutates: z.boolean().optional(),
  appliedGraphRevision: z.string().trim().min(1).optional(),
  sourceGraphRevision: z.string().trim().min(1).optional(),
  warnings: z.array(z.string().trim().min(1)),
});

const DEFAULT_LOCAL_PROJECT_LIBRARY_SNAPSHOT: ProjectLibrarySnapshotV1 = projectLibrarySnapshotV1Schema.parse({
  activeAlbumId: 'album_selects',
  albums: [
    {
      children: [
        {
          id: 'album_selects',
          images: ['/photos/session/IMG_0001.CR3'],
          name: 'Client Selects',
          type: 'album',
        },
      ],
      id: 'group_client',
      name: 'Client',
      type: 'group',
    },
  ],
  currentFolderPath: '/photos/session',
  filterCriteria: {
    colors: ['green'],
    editedStatus: 'all',
    rating: 3,
    rawStatus: 'rawOnly',
  },
  folders: [
    {
      children: [],
      hasSubdirs: false,
      imageCount: 1,
      isDir: true,
      name: 'session',
      path: '/photos/session',
    },
  ],
  imageList: [
    {
      exif: {
        ISO: '400',
        LensModel: 'Sample 50mm',
      },
      isEdited: true,
      isVirtualCopy: false,
      modified: 1_717_351_200,
      path: '/photos/session/IMG_0001.CR3',
      rating: 4,
      tags: ['select', 'portrait'],
    },
  ],
  libraryActivePath: '/photos/session/IMG_0001.CR3',
  multiSelectedPaths: ['/photos/session/IMG_0001.CR3'],
  pinnedFolders: [],
  rootPaths: ['/photos/session'],
  schemaVersion: 1,
  sortCriteria: {
    key: 'rating',
    label: 'Rating',
    order: 'desc',
  },
});

export const rawEngineLocalAppServerAuditEventV1Schema = z
  .object({
    approvalState: z.string().trim().min(1).optional(),
    appliedGraphRevision: z.string().trim().min(1).optional(),
    commandId: z.string().trim().min(1),
    commandType: z.string().trim().min(1),
    correlationId: z.string().trim().min(1),
    dryRun: z.boolean(),
    eventId: z.string().trim().min(1),
    expectedGraphRevision: z.string().trim().min(1).optional(),
    mutates: z.boolean(),
    sourceGraphRevision: z.string().trim().min(1).optional(),
    requestId: z.string().trim().min(1).optional(),
    status: z.enum(['blocked', 'completed', 'rejected']),
    timestampIso: z.iso.datetime(),
    toolName: z.string().trim().min(1).optional(),
    warnings: z.array(z.string().trim().min(1)),
    acceptedDryRun: z
      .object({
        planHash: z.string().trim().min(1),
        planId: z.string().trim().min(1),
      })
      .strict()
      .optional(),
    providerFallback: z
      .object({
        effectiveProviderClass: z.literal('local_model'),
        effectiveProviderId: z.literal('cpu'),
        executionDisposition: z.literal('blocked'),
        fallbackReason: z.enum(['provider_unavailable']),
        reasonCode: z.enum(['connector_unavailable', 'cloud_unavailable', 'provider_unavailable']),
        requestedProviderClass: z.enum(['local_model', 'self_hosted_connector', 'cloud_service']),
        requestedProviderId: z.string().trim().min(1),
        routingFallbackApplied: z.boolean(),
        userVisibleMessage: z.string().trim().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();

export type RawEngineLocalAppServerAuditEventV1 = z.infer<typeof rawEngineLocalAppServerAuditEventV1Schema>;

const BASIC_TONE_PARAMETER_DIFF_PATHS = {
  blackPoint: '/parameters/blackPoint',
  clarity: '/parameters/clarity',
  contrast: '/parameters/contrast',
  exposureEv: '/parameters/exposureEv',
  highlights: '/parameters/highlights',
  saturation: '/parameters/saturation',
  shadows: '/parameters/shadows',
  whitePoint: '/parameters/whitePoint',
} as const satisfies Record<BasicToneAdjustmentParameterKeyV1, string>;

const stableBasicToneHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
};

const DETAIL_EFFECTS_PATCH_KEYS = [
  'chromaticAberrationBlueYellow',
  'chromaticAberrationRedCyan',
  'clarity',
  'colorNoiseReduction',
  'deblurEnabled',
  'deblurSigmaPx',
  'deblurStrength',
  'dehaze',
  'dustSpotMinRadiusPx',
  'dustSpotOverlayEnabled',
  'dustSpotSensitivity',
  'flareAmount',
  'glowAmount',
  'grainAmount',
  'grainRoughness',
  'grainSize',
  'halationAmount',
  'localContrastHaloGuard',
  'localContrastMidtoneMask',
  'localContrastRadiusPx',
  'lumaNoiseReduction',
  'sharpness',
  'sharpnessThreshold',
  'structure',
  'vignetteAmount',
  'vignetteFeather',
  'vignetteMidpoint',
  'vignetteRoundness',
] as const satisfies ReadonlyArray<keyof DetailEffectsPatchV1>;

type DetailEffectsCommandV1 = Extract<
  DetailEffectsCommandEnvelopeV1,
  { commandType: 'detailEffects.dryRunAdjustments' | 'detailEffects.applyAdjustments' }
>;

const buildDetailEffectsPlanPatch = (command: DetailEffectsCommandV1): Partial<DetailEffectsPatchV1> =>
  Object.fromEntries(
    DETAIL_EFFECTS_PATCH_KEYS.flatMap((key) =>
      command.parameters[key] === undefined ? [] : [[key, command.parameters[key]]],
    ),
  );

const LENS_PROFILE_PATCH_KEYS = [
  'lensCorrectionMode',
  'lensDistortionAmount',
  'lensDistortionEnabled',
  'lensDistortionParams',
  'lensMaker',
  'lensModel',
  'lensTcaAmount',
  'lensTcaEnabled',
  'lensVignetteAmount',
  'lensVignetteEnabled',
] as const satisfies ReadonlyArray<keyof LensProfilePatchV1>;

type LensProfileCommandV1 = Extract<
  LensProfileCommandEnvelopeV1,
  { commandType: 'lensProfile.dryRunCorrection' | 'lensProfile.applyCorrection' }
>;

const buildLensProfilePlanPatch = (command: LensProfileCommandV1): Partial<LensProfilePatchV1> =>
  Object.fromEntries(
    LENS_PROFILE_PATCH_KEYS.flatMap((key) =>
      command.parameters[key] === undefined ? [] : [[key, command.parameters[key]]],
    ),
  );

const buildDetailEffectsPlanKey = (command: DetailEffectsCommandV1): string =>
  JSON.stringify([command.expectedGraphRevision, command.target, buildDetailEffectsPlanPatch(command)]);

const buildDetailEffectsPlanId = (command: DetailEffectsCommandV1): string =>
  `dryrun_detail_effects_${stableBasicToneHash(buildDetailEffectsPlanKey(command))}`;

const buildDetailEffectsPlanHash = (command: DetailEffectsCommandV1): string =>
  `sha256:detail-effects:${stableBasicToneHash(
    `${buildDetailEffectsPlanId(command)}:${buildDetailEffectsPlanKey(command)}`,
  )}`;

const buildDetailEffectsDryRunResult = (
  command: Extract<DetailEffectsCommandEnvelopeV1, { commandType: 'detailEffects.dryRunAdjustments' }>,
): z.infer<typeof detailEffectsDryRunResultV1Schema> =>
  detailEffectsDryRunResultV1Schema.parse({
    commandId: command.commandId,
    commandType: command.commandType,
    correlationId: command.correlationId,
    dryRun: true,
    dryRunPlanHash: buildDetailEffectsPlanHash(command),
    dryRunPlanId: buildDetailEffectsPlanId(command),
    mutates: false,
    parameterDiff: DETAIL_EFFECTS_PATCH_KEYS.flatMap((key) =>
      command.parameters[key] === undefined
        ? []
        : [
            {
              nodeId: null,
              path: `/parameters/${key}`,
              value: command.parameters[key],
            },
          ],
    ),
    predictedGraphRevision: `${command.expectedGraphRevision}:preview:${command.commandId}`,
    previewArtifacts: [],
    schemaVersion: command.schemaVersion,
    sourceGraphRevision: command.expectedGraphRevision,
    warnings: [],
  });

const buildDetailEffectsMutationResult = (
  command: Extract<DetailEffectsCommandEnvelopeV1, { commandType: 'detailEffects.applyAdjustments' }>,
): z.infer<typeof detailEffectsMutationResultV1Schema> =>
  detailEffectsMutationResultV1Schema.parse({
    appliedGraphRevision: `${command.expectedGraphRevision}:detail_effects:${command.commandId}`,
    changedNodeIds: DETAIL_EFFECTS_PATCH_KEYS.flatMap((key) =>
      command.parameters[key] === undefined ? [] : [`detail_effects:${key}:${command.target.kind}`],
    ),
    commandId: command.commandId,
    commandType: command.commandType,
    correlationId: command.correlationId,
    dryRun: false,
    dryRunPlanHash: command.parameters.acceptedDryRunPlanHash,
    dryRunPlanId: command.parameters.acceptedDryRunPlanId,
    mutates: true,
    provenanceEntryIds: [`prov_detail_effects_${command.commandId}`],
    schemaVersion: command.schemaVersion,
    sourceGraphRevision: command.expectedGraphRevision,
    undoRevision: command.expectedGraphRevision,
    warnings: [],
  });

const buildLensProfilePlanKey = (command: LensProfileCommandV1): string =>
  JSON.stringify([command.expectedGraphRevision, command.target, buildLensProfilePlanPatch(command)]);

const buildLensProfilePlanId = (command: LensProfileCommandV1): string =>
  `dryrun_lens_profile_${stableBasicToneHash(buildLensProfilePlanKey(command))}`;

const buildLensProfilePlanHash = (command: LensProfileCommandV1): string =>
  `sha256:lens-profile:${stableBasicToneHash(
    `${buildLensProfilePlanId(command)}:${buildLensProfilePlanKey(command)}`,
  )}`;

const buildLensProfileDryRunResult = (
  command: Extract<LensProfileCommandEnvelopeV1, { commandType: 'lensProfile.dryRunCorrection' }>,
): z.infer<typeof lensProfileDryRunResultV1Schema> =>
  lensProfileDryRunResultV1Schema.parse({
    commandId: command.commandId,
    commandType: command.commandType,
    correlationId: command.correlationId,
    dryRun: true,
    dryRunPlanHash: buildLensProfilePlanHash(command),
    dryRunPlanId: buildLensProfilePlanId(command),
    mutates: false,
    parameterDiff: LENS_PROFILE_PATCH_KEYS.flatMap((key) =>
      command.parameters[key] === undefined
        ? []
        : [
            {
              nodeId: null,
              path: `/parameters/${key}`,
              value: command.parameters[key],
            },
          ],
    ),
    predictedGraphRevision: `${command.expectedGraphRevision}:preview:${command.commandId}`,
    previewArtifacts: [],
    schemaVersion: command.schemaVersion,
    sourceGraphRevision: command.expectedGraphRevision,
    warnings: [],
  });

const buildLensProfileMutationResult = (
  command: Extract<LensProfileCommandEnvelopeV1, { commandType: 'lensProfile.applyCorrection' }>,
): z.infer<typeof lensProfileMutationResultV1Schema> =>
  lensProfileMutationResultV1Schema.parse({
    appliedGraphRevision: `${command.expectedGraphRevision}:lens_profile:${command.commandId}`,
    changedNodeIds: LENS_PROFILE_PATCH_KEYS.flatMap((key) =>
      command.parameters[key] === undefined ? [] : [`lens_profile:${key}:${command.target.kind}`],
    ),
    commandId: command.commandId,
    commandType: command.commandType,
    correlationId: command.correlationId,
    dryRun: false,
    dryRunPlanHash: command.parameters.acceptedDryRunPlanHash,
    dryRunPlanId: command.parameters.acceptedDryRunPlanId,
    mutates: true,
    provenanceEntryIds: [`prov_lens_profile_${command.commandId}`],
    schemaVersion: command.schemaVersion,
    sourceGraphRevision: command.expectedGraphRevision,
    undoRevision: command.expectedGraphRevision,
    warnings: [],
  });

const buildBasicTonePlanId = (command: BasicToneCommandV1): string =>
  `dryrun_basic_tone_${stableBasicToneHash(buildBasicTonePlanKey(command))}`;

const buildBasicTonePlanHash = (command: BasicToneCommandV1): string =>
  `sha256:basic-tone:${stableBasicToneHash(`${buildBasicTonePlanId(command)}:${buildBasicTonePlanKey(command)}`)}`;

const buildBasicToneDryRunResult = (command: BasicToneCommandV1): ToneColorDryRunResultV1 =>
  toneColorDryRunResultV1Schema.parse({
    colorPipeline: command.colorPipeline,
    commandId: command.commandId,
    commandType: command.commandType,
    correlationId: command.correlationId,
    dryRun: true,
    dryRunPlanHash: buildBasicTonePlanHash(command),
    dryRunPlanId: buildBasicTonePlanId(command),
    mutates: false,
    parameterDiff: Object.entries(BASIC_TONE_PARAMETER_DIFF_PATHS).map(([key, path]) => ({
      module: 'basic_tone',
      path,
      value: command.parameters[key as BasicToneAdjustmentParameterKeyV1],
    })),
    predictedGraphRevision: `${command.expectedGraphRevision}:preview:${command.commandId}`,
    previewArtifacts: [],
    schemaVersion: command.schemaVersion,
    sourceGraphRevision: command.expectedGraphRevision,
    warnings: [],
  });

const buildBasicTonePlanKey = (command: BasicToneCommandV1): string =>
  JSON.stringify([
    command.expectedGraphRevision,
    command.target,
    Object.fromEntries(
      Object.keys(BASIC_TONE_PARAMETER_DIFF_PATHS).map((key) => [
        key,
        command.parameters[key as BasicToneAdjustmentParameterKeyV1],
      ]),
    ),
  ]);

const buildBasicToneMutationResult = (command: BasicToneCommandV1): ToneColorMutationResultV1 =>
  toneColorMutationResultV1Schema.parse({
    appliedGraphRevision: `${command.expectedGraphRevision}:apply:${command.commandId}`,
    changedNodeIds: [`tone_color_basic:${command.target.kind}`],
    colorPipeline: command.colorPipeline,
    commandId: command.commandId,
    commandType: command.commandType,
    correlationId: command.correlationId,
    dryRun: false,
    mutates: true,
    schemaVersion: command.schemaVersion,
    sourceGraphRevision: command.expectedGraphRevision,
    undoRevision: command.expectedGraphRevision,
    warnings: [],
  });

const HSL_PARAMETER_DIFF_PATHS = [
  ['hueShiftDegrees', 'hueShiftDegrees'],
  ['saturation', 'saturation'],
  ['luminance', 'luminance'],
] as const satisfies ReadonlyArray<
  readonly [keyof Extract<ToneColorCommandEnvelopeV1, { commandType: 'toneColor.adjustHsl' }>['parameters'], string]
>;

const HSL_RANGE_CONTROL_DIFF_PATHS = [
  ['centerHueDegrees', 'centerHueDegrees'],
  ['widthDegrees', 'widthDegrees'],
  ['falloffSmoothness', 'falloffSmoothness'],
] as const satisfies ReadonlyArray<
  readonly [
    keyof NonNullable<
      Extract<ToneColorCommandEnvelopeV1, { commandType: 'toneColor.adjustHsl' }>['parameters']['rangeControl']
    >,
    string,
  ]
>;

const SUPPORTED_HSL_BANDS = new Set<ToneColorHslBandV1>([
  'red',
  'orange',
  'yellow',
  'green',
  'aqua',
  'blue',
  'purple',
  'magenta',
]);

const buildHslWarnings = (band: ToneColorHslBandV1): string[] =>
  SUPPORTED_HSL_BANDS.has(band) ? [] : [`Unsupported HSL/selective-color band: ${band}.`];

const buildHslDryRunResult = (
  command: Extract<ToneColorCommandEnvelopeV1, { commandType: 'toneColor.adjustHsl' }>,
): ToneColorDryRunResultV1 =>
  toneColorDryRunResultV1Schema.parse({
    colorPipeline: command.colorPipeline,
    commandId: command.commandId,
    commandType: command.commandType,
    correlationId: command.correlationId,
    dryRun: true,
    mutates: false,
    parameterDiff: [
      ...HSL_PARAMETER_DIFF_PATHS.map(([key, path]) => ({
        module: 'hsl',
        path: `/parameters/${command.parameters.band}/${path}`,
        previousValue: 0,
        value: command.parameters[key],
      })),
      ...(command.parameters.rangeControl === undefined
        ? []
        : HSL_RANGE_CONTROL_DIFF_PATHS.map(([key, path]) => ({
            module: 'hsl',
            path: `/parameters/${command.parameters.band}/rangeControl/${path}`,
            previousValue: null,
            value: command.parameters.rangeControl?.[key] ?? null,
          }))),
    ],
    predictedGraphRevision: `${command.expectedGraphRevision}:preview:${command.commandId}`,
    previewArtifacts: [],
    schemaVersion: command.schemaVersion,
    sourceGraphRevision: command.expectedGraphRevision,
    warnings: buildHslWarnings(command.parameters.band),
  });

const buildHslPlanKey = (
  command: Extract<ToneColorCommandEnvelopeV1, { commandType: 'toneColor.adjustHsl' }>,
): string => JSON.stringify([command.expectedGraphRevision, command.target, command.parameters]);

const buildHslMutationResult = (
  command: Extract<ToneColorCommandEnvelopeV1, { commandType: 'toneColor.adjustHsl' }>,
): ToneColorMutationResultV1 =>
  toneColorMutationResultV1Schema.parse({
    appliedGraphRevision: `${command.expectedGraphRevision}:apply:${command.commandId}`,
    changedNodeIds: [`tone_color_hsl:${command.parameters.band}:${command.target.kind}`],
    colorPipeline: command.colorPipeline,
    commandId: command.commandId,
    commandType: command.commandType,
    correlationId: command.correlationId,
    dryRun: false,
    mutates: true,
    schemaVersion: command.schemaVersion,
    sourceGraphRevision: command.expectedGraphRevision,
    undoRevision: command.expectedGraphRevision,
    warnings: buildHslWarnings(command.parameters.band),
  });

const SKIN_TONE_UNIFORMITY_PARAMETER_DIFF_PATHS = [
  'hueUniformity',
  'saturationUniformity',
  'luminanceUniformity',
  'targetHueDegrees',
  'targetSaturation',
  'targetLuminance',
  'maxHueShiftDegrees',
] as const satisfies ReadonlyArray<
  keyof Extract<ToneColorCommandEnvelopeV1, { commandType: 'toneColor.adjustSkinToneUniformity' }>['parameters']
>;

const SKIN_TONE_UNIFORMITY_WARNINGS = [
  'Experimental skin-tone uniformity command: bounded runtime proof with private RAW preview/export coverage; no Capture One equivalence or measured portrait accuracy claim.',
] as const;

const buildSkinToneUniformityDryRunResult = (
  command: Extract<ToneColorCommandEnvelopeV1, { commandType: 'toneColor.adjustSkinToneUniformity' }>,
): ToneColorDryRunResultV1 =>
  toneColorDryRunResultV1Schema.parse({
    colorPipeline: command.colorPipeline,
    commandId: command.commandId,
    commandType: command.commandType,
    correlationId: command.correlationId,
    dryRun: true,
    mutates: false,
    parameterDiff: SKIN_TONE_UNIFORMITY_PARAMETER_DIFF_PATHS.map((key) => ({
      module: 'skin_tone_uniformity',
      path: `/parameters/skinToneUniformity/${key}`,
      previousValue: 0,
      value: command.parameters[key],
    })),
    predictedGraphRevision: `${command.expectedGraphRevision}:preview:${command.commandId}`,
    previewArtifacts: [],
    schemaVersion: command.schemaVersion,
    sourceGraphRevision: command.expectedGraphRevision,
    warnings: [...SKIN_TONE_UNIFORMITY_WARNINGS],
  });

const buildSkinToneUniformityPlanKey = (
  command: Extract<ToneColorCommandEnvelopeV1, { commandType: 'toneColor.adjustSkinToneUniformity' }>,
): string => JSON.stringify([command.expectedGraphRevision, command.target, command.parameters]);

const buildSkinToneUniformityMutationResult = (
  command: Extract<ToneColorCommandEnvelopeV1, { commandType: 'toneColor.adjustSkinToneUniformity' }>,
): ToneColorMutationResultV1 =>
  toneColorMutationResultV1Schema.parse({
    appliedGraphRevision: `${command.expectedGraphRevision}:apply:${command.commandId}`,
    changedNodeIds: [`tone_color_skin_uniformity:${command.target.kind}`],
    colorPipeline: command.colorPipeline,
    commandId: command.commandId,
    commandType: command.commandType,
    correlationId: command.correlationId,
    dryRun: false,
    mutates: true,
    schemaVersion: command.schemaVersion,
    sourceGraphRevision: command.expectedGraphRevision,
    undoRevision: command.expectedGraphRevision,
    warnings: [...SKIN_TONE_UNIFORMITY_WARNINGS],
  });

const buildAiToolPlanId = (command: RawEngineLocalAppServerAiToolCommandV1): string =>
  `dryrun_${command.parameters.capability}_${command.commandId}`;

const buildAiToolPlanHash = (command: RawEngineLocalAppServerAiToolCommandV1): string =>
  `sha256:${[
    command.expectedGraphRevision,
    command.target.imagePath,
    command.parameters.capability,
    command.parameters.maskName,
    command.parameters.modelId,
    command.parameters.sourceContentHash,
  ].join(':')}`;

const buildAiToolPlanKey = (
  command: Pick<RawEngineLocalAppServerAiToolCommandV1, 'expectedGraphRevision' | 'parameters' | 'target'>,
): string =>
  JSON.stringify([
    command.expectedGraphRevision,
    command.target,
    command.parameters.capability,
    command.parameters.maskName,
    command.parameters.modelId,
    command.parameters.modelVersion,
    command.parameters.sourceContentHash,
  ]);

const buildSyntheticAiMaskPreview = (
  command: RawEngineLocalAppServerAiToolCommandV1,
): { contentHash: string; coverageRatio: number; rows: string[] } => {
  const seed = [
    command.expectedGraphRevision,
    command.target.imagePath,
    command.parameters.capability,
    command.parameters.maskName,
    command.parameters.modelId,
    command.parameters.sourceContentHash,
  ].join('|');
  const rows = Array.from({ length: 8 }, (_, rowIndex) => {
    let row = '';
    for (let columnIndex = 0; columnIndex < 8; columnIndex += 1) {
      const charCode = seed.charCodeAt((rowIndex * 8 + columnIndex) % seed.length);
      const on = (charCode + rowIndex * 17 + columnIndex * 31) % 5 !== 0;
      row += on ? 'f' : '0';
    }
    return row;
  });
  let enabledPixels = 0;
  for (const row of rows) {
    for (const pixel of Array.from(row)) {
      if (pixel !== '0') enabledPixels += 1;
    }
  }
  if (enabledPixels === 0) {
    rows[0] = 'f0000000';
    enabledPixels = 1;
  }
  return {
    contentHash: `sha256:synthetic-ai-mask-${rows.join('')}`,
    coverageRatio: enabledPixels / 64,
    rows,
  };
};

const buildAiToolDryRunResult = (
  command: RawEngineLocalAppServerAiToolCommandV1,
): z.infer<typeof aiToolDryRunResultV1Schema> => {
  const preview = buildSyntheticAiMaskPreview(command);
  return aiToolDryRunResultV1Schema.parse({
    commandId: command.commandId,
    commandType: 'ai.mask.generateSubject',
    correlationId: command.correlationId,
    dryRunPlanHash: buildAiToolPlanHash(command),
    dryRunPlanId: buildAiToolPlanId(command),
    maskArtifacts: [
      {
        artifactId: `artifact_${command.parameters.capability}_${command.commandId}_mask`,
        contentHash: preview.contentHash,
        dimensions: {
          height: preview.rows.length,
          width: preview.rows[0]?.length ?? 0,
        },
        kind: 'mask',
        storage: 'temp_cache',
      },
    ],
    maskCoverageRatio: preview.coverageRatio,
    maskPreviewRows: preview.rows,
    modelId: command.parameters.modelId,
    modelVersion: command.parameters.modelVersion,
    previewArtifacts: [
      {
        artifactId: `artifact_${command.parameters.capability}_${command.commandId}_preview`,
        contentHash: command.parameters.sourceContentHash,
        dimensions: {
          height: 1080,
          width: 1620,
        },
        kind: 'preview',
        storage: 'temp_cache',
      },
    ],
    providerClass: command.parameters.providerClass,
    providerId: command.parameters.providerId,
    schemaVersion: command.schemaVersion,
    sourceContentHash: command.parameters.sourceContentHash,
    warnings: ['Synthetic AI mask app-server proof: no real RAW model inference claim.'],
  });
};

const buildAiToolMutationResult = (
  command: RawEngineLocalAppServerAiToolCommandV1,
): z.infer<typeof aiToolApplyResultV1Schema> => {
  const acceptedDryRunPlanHash = command.parameters.acceptedDryRunPlanHash;
  const acceptedDryRunPlanId = command.parameters.acceptedDryRunPlanId;
  if (acceptedDryRunPlanHash === undefined || acceptedDryRunPlanId === undefined) {
    throw new Error('Local app-server bridge AI mask apply requires an accepted dry-run plan.');
  }

  return aiToolApplyResultV1Schema.parse({
    appliedGraphRevision: [command.expectedGraphRevision, 'ai_mask', command.commandId].join(':'),
    changedMaskIds: [`mask_${command.parameters.capability}_${command.commandId}`],
    commandId: command.commandId,
    commandType: 'ai.mask.applySubject',
    correlationId: command.correlationId,
    dryRunPlanHash: acceptedDryRunPlanHash,
    dryRunPlanId: acceptedDryRunPlanId,
    outputArtifacts: [
      {
        artifactId: `artifact_${command.parameters.capability}_${command.commandId}_sidecar`,
        contentHash: command.parameters.sourceContentHash,
        dimensions: {
          height: 1080,
          width: 1620,
        },
        kind: 'mask',
        storage: 'sidecar_artifact',
      },
    ],
    provenanceEntryIds: [`prov_${command.parameters.capability}_${command.commandId}`],
    schemaVersion: command.schemaVersion,
    sourceGraphRevision: command.expectedGraphRevision,
    warnings: ['Synthetic AI mask app-server proof: no real RAW model inference claim.'],
  });
};

const buildAiEnhancementPlanId = (command: RawEngineLocalAppServerAiEnhancementCommandV1): string =>
  `dryrun_${command.parameters.capability}_${command.commandId}`;

const buildAiEnhancementPlanHash = (command: RawEngineLocalAppServerAiEnhancementCommandV1): string =>
  `sha256:${[
    command.expectedGraphRevision,
    command.target.imagePath,
    command.parameters.capability,
    command.parameters.modelId,
    command.parameters.sourceContentHash,
    command.parameters.strength,
  ].join(':')}`;

const buildAiEnhancementPlanKey = (
  command: Pick<RawEngineLocalAppServerAiEnhancementCommandV1, 'expectedGraphRevision' | 'parameters' | 'target'>,
): string =>
  JSON.stringify([
    command.expectedGraphRevision,
    command.target,
    command.parameters.capability,
    command.parameters.modelId,
    command.parameters.modelVersion,
    command.parameters.sourceContentHash,
    command.parameters.strength,
    command.parameters.regionMaskArtifactId ?? null,
  ]);

const buildAiEnhancementDryRunResult = (
  command: RawEngineLocalAppServerAiEnhancementCommandV1,
): z.infer<typeof aiEnhancementDryRunResultV1Schema> =>
  aiEnhancementDryRunResultV1Schema.parse({
    commandId: command.commandId,
    commandType: command.commandType,
    correlationId: command.correlationId,
    dryRunPlanHash: buildAiEnhancementPlanHash(command),
    dryRunPlanId: buildAiEnhancementPlanId(command),
    enhancementArtifacts: [
      {
        artifactId: `artifact_${command.parameters.capability}_${command.commandId}_enhancement`,
        contentHash: command.parameters.sourceContentHash,
        dimensions: {
          height: 1080,
          width: 1620,
        },
        kind: command.parameters.capability === 'inpaint' ? 'generated_patch' : 'denoise_output',
        storage: 'temp_cache',
      },
    ],
    modelId: command.parameters.modelId,
    modelVersion: command.parameters.modelVersion,
    previewArtifacts: [
      {
        artifactId: `artifact_${command.parameters.capability}_${command.commandId}_preview`,
        contentHash: command.parameters.sourceContentHash,
        dimensions: {
          height: 1080,
          width: 1620,
        },
        kind: 'preview',
        storage: 'temp_cache',
      },
    ],
    providerClass: command.parameters.providerClass,
    providerId: command.parameters.providerId,
    schemaVersion: command.schemaVersion,
    sourceContentHash: command.parameters.sourceContentHash,
    warnings: [],
  });

const buildAiEnhancementMutationResult = (
  command: RawEngineLocalAppServerAiEnhancementCommandV1,
): z.infer<typeof aiEnhancementApplyResultV1Schema> => {
  const acceptedDryRunPlanHash = command.parameters.acceptedDryRunPlanHash;
  const acceptedDryRunPlanId = command.parameters.acceptedDryRunPlanId;
  if (acceptedDryRunPlanHash === undefined || acceptedDryRunPlanId === undefined) {
    throw new Error('Local app-server bridge AI enhancement apply requires an accepted dry-run plan.');
  }

  return aiEnhancementApplyResultV1Schema.parse({
    appliedGraphRevision: [command.expectedGraphRevision, 'ai', command.commandId].join(':'),
    changedEditNodeIds: [`edit_node_${command.parameters.capability}_${command.target.kind}`],
    commandId: command.commandId,
    commandType: command.commandType,
    correlationId: command.correlationId,
    dryRunPlanHash: acceptedDryRunPlanHash,
    dryRunPlanId: acceptedDryRunPlanId,
    outputArtifacts: [
      {
        artifactId: `artifact_${command.parameters.capability}_${command.commandId}_output`,
        contentHash: command.parameters.sourceContentHash,
        dimensions: {
          height: 1080,
          width: 1620,
        },
        kind: command.parameters.capability === 'inpaint' ? 'generated_patch' : 'denoise_output',
        storage: 'sidecar_artifact',
      },
    ],
    provenanceEntryIds: [`prov_${command.parameters.capability}_${command.commandId}`],
    schemaVersion: command.schemaVersion,
    sourceGraphRevision: command.expectedGraphRevision,
    warnings: [],
  });
};

const buildProjectMetadataResult = (
  snapshot: ProjectLibrarySnapshotV1,
): RawEngineLocalAppServerProjectMetadataResultV1 =>
  rawEngineLocalAppServerProjectMetadataResultV1Schema.parse({
    activeAlbumId: snapshot.activeAlbumId,
    currentFolderPath: snapshot.currentFolderPath,
    filterCriteria: snapshot.filterCriteria,
    imageCount: snapshot.imageList.length,
    libraryActivePath: snapshot.libraryActivePath,
    pinnedFolderCount: snapshot.pinnedFolders.length,
    rootPaths: snapshot.rootPaths,
    selectedCount: snapshot.multiSelectedPaths.length,
    sortCriteria: snapshot.sortCriteria,
  });

const buildSelectedImagesResult = (
  snapshot: ProjectLibrarySnapshotV1,
): RawEngineLocalAppServerSelectedImagesResultV1 => {
  const selectedPaths = new Set(snapshot.multiSelectedPaths);
  return rawEngineLocalAppServerSelectedImagesResultV1Schema.parse({
    images: snapshot.imageList.filter((image) => selectedPaths.has(image.path)),
    selectedPaths: snapshot.multiSelectedPaths,
  });
};

const buildImageMetadataResult = (
  snapshot: ProjectLibrarySnapshotV1,
  imagePath: string,
): RawEngineLocalAppServerImageMetadataResultV1 => {
  const image = snapshot.imageList.find((candidate) => candidate.path === imagePath);
  if (image === undefined) {
    throw new Error(`Local app-server bridge has no image metadata for ${imagePath}.`);
  }

  return rawEngineLocalAppServerImageMetadataResultV1Schema.parse({ image });
};

const buildEditorStateResult = (snapshot: ProjectLibrarySnapshotV1): RawEngineLocalAppServerEditorStateResultV1 =>
  rawEngineLocalAppServerEditorStateResultV1Schema.parse({
    activeImagePath: snapshot.libraryActivePath,
    currentFolderPath: snapshot.currentFolderPath,
    selectedImagePaths: snapshot.multiSelectedPaths,
    visibleImageCount: snapshot.imageList.length,
  });

const computationalMergeFamilyForCommand = (
  command: ComputationalMergeCommandEnvelopeV1,
): ComputationalMergeFamilyV1 => {
  switch (command.commandType) {
    case 'computationalMerge.createFocusStack':
      return 'focus_stack';
    case 'computationalMerge.createHdr':
      return 'hdr';
    case 'computationalMerge.createPanorama':
      return 'panorama';
    case 'computationalMerge.createSuperResolution':
      return 'super_resolution';
  }
};

const computationalMergeCommandTypeForFamily = (
  family: ComputationalMergeFamilyV1,
): ComputationalMergeCommandTypeV1 => {
  switch (family) {
    case 'focus_stack':
      return 'computationalMerge.createFocusStack';
    case 'hdr':
      return 'computationalMerge.createHdr';
    case 'panorama':
      return 'computationalMerge.createPanorama';
    case 'super_resolution':
      return 'computationalMerge.createSuperResolution';
  }
};

const buildLocalComputationalMergeRuntimeManifest = () => ({
  schemaVersion: 1,
  serverRuntime: 'openai_app_server',
  tools: (['focus_stack', 'hdr', 'panorama', 'super_resolution'] as const).flatMap((family) => {
    const commandType = computationalMergeCommandTypeForFamily(family);
    return [
      {
        allowedCommandTypes: [commandType],
        approvalClass: ApprovalClass.PreviewOnly,
        auditEvents: ['computational_merge_dry_run_requested', 'computational_merge_dry_run_completed'],
        description: `Preview a local ${family} computational merge and return a non-mutating dry-run plan.`,
        executionMode: 'dry_run_command',
        inputSchemaName: 'ComputationalMergeCommandEnvelopeV1',
        localOnly: true,
        mutates: false,
        outputSchemaName: 'ComputationalMergeDryRunResultV1',
        recordsProvenance: true,
        requiresDryRunPlan: false,
        returnsArtifactHandles: true,
        toolName: `computationalmerge.${family}.dry_run_command`,
      },
      {
        allowedCommandTypes: [commandType],
        approvalClass: ApprovalClass.EditApply,
        auditEvents: ['computational_merge_apply_requested', 'computational_merge_apply_completed'],
        description: `Apply an accepted local ${family} computational merge dry-run plan.`,
        executionMode: 'apply_dry_run_plan',
        inputSchemaName: 'ComputationalMergeCommandEnvelopeV1',
        localOnly: true,
        mutates: true,
        outputSchemaName: 'ComputationalMergeMutationResultV1',
        recordsProvenance: true,
        requiresDryRunPlan: true,
        returnsArtifactHandles: true,
        toolName: `computationalmerge.${family}.apply_command`,
      },
    ];
  }),
});

const localComputationalMergeRuntimeManifest = buildLocalComputationalMergeRuntimeManifest();

const computationalMergeToolNameForCommand = (command: ComputationalMergeCommandEnvelopeV1): string =>
  `computationalmerge.${computationalMergeFamilyForCommand(command)}.${
    command.dryRun ? 'dry_run_command' : 'apply_command'
  }`;

const buildComputationalMergeRuntimeRequest = (command: ComputationalMergeCommandEnvelopeV1): unknown => {
  switch (command.commandType) {
    case 'computationalMerge.createHdr':
      return buildHdrRuntimeRequest(command);
    case 'computationalMerge.createPanorama':
      return buildPanoramaRuntimeRequest(command);
    case 'computationalMerge.createFocusStack':
      return buildFocusRuntimeRequest(command);
    case 'computationalMerge.createSuperResolution':
      return buildSuperResolutionRuntimeRequest(command);
  }
};

const buildHdrRuntimeRequest = (
  command: Extract<ComputationalMergeCommandEnvelopeV1, { commandType: 'computationalMerge.createHdr' }>,
) => {
  const width = 48;
  const height = 36;
  const scene = createHdrScene(width, height);
  const frames = command.parameters.sources.map((source, index) => {
    const exposureEv = source.exposureEv ?? index - 1;
    return {
      contentHash: `sha256:local-app-server-hdr-${source.sourceIndex}`,
      exposureEv,
      graphRevision: `${command.expectedGraphRevision}:source:${source.sourceIndex}`,
      height,
      pixels: shiftFloat64Frame(renderHdrBracket(scene, exposureEv), width, height, index - 1, index % 2 === 0 ? 1 : 0),
      sourceIndex: source.sourceIndex,
      width,
    };
  });

  return {
    clipThreshold: 0.99,
    command,
    frames,
    motionThreshold: 0.03,
    outputArtifactId: `artifact_${command.commandId}_output`,
    previewArtifactId: `artifact_${command.commandId}_preview`,
    searchRadiusPx: 5,
    sensorWhiteRadiance: 1,
  };
};

const buildPanoramaRuntimeRequest = (
  command: Extract<ComputationalMergeCommandEnvelopeV1, { commandType: 'computationalMerge.createPanorama' }>,
) => {
  const sourceFrames = command.parameters.sources.map((source) => ({
    contentHash: `sha256:local-app-server-panorama-${source.sourceIndex}`,
    expectedOffsetX: source.sourceIndex * 48,
    expectedOffsetY: source.sourceIndex % 2 === 0 ? 0 : 2,
    graphRevision: `${command.expectedGraphRevision}:source:${source.sourceIndex}`,
    height: 48,
    sourceIndex: source.sourceIndex,
    width: 72,
  }));

  return {
    artifactCreatedAt: '2026-06-22T12:00:00.000Z',
    command,
    connectedSourceIndices: command.parameters.sources.map((source) => source.sourceIndex),
    outputArtifactId: `artifact_${command.commandId}_output`,
    previewArtifactId: `artifact_${command.commandId}_preview`,
    seed: `rawengine-local-app-server-${command.commandId}`,
    sourceFrames,
  };
};

const buildFocusRuntimeRequest = (
  command: Extract<ComputationalMergeCommandEnvelopeV1, { commandType: 'computationalMerge.createFocusStack' }>,
) => {
  const width = 72;
  const height = 48;
  const sourceCount = command.parameters.sources.length;
  const regionWidth = Math.floor(width / sourceCount);
  const sourceRegions = command.parameters.sources.map((source, index) => ({
    height,
    sourceIndex: source.sourceIndex,
    width: index === sourceCount - 1 ? width - regionWidth * index : regionWidth,
    x: regionWidth * index,
    y: 0,
  }));
  const frames = command.parameters.sources.map((source, index) => ({
    contentHash: `sha256:local-app-server-focus-${source.sourceIndex}`,
    focusDistanceMm: source.focusDistanceMm ?? 180 + index * 60,
    graphRevision: `${command.expectedGraphRevision}:source:${source.sourceIndex}`,
    height,
    pixels: createFocusFrame(width, height, source.sourceIndex, sourceRegions),
    sourceIndex: source.sourceIndex,
    translationX: 0,
    translationY: 0,
    width,
  }));
  const cells = sourceRegions.map((region) => ({
    height: region.height,
    lowConfidence: false,
    sourceScores: command.parameters.sources.map((source) => ({
      relativeConfidence: source.sourceIndex === region.sourceIndex ? 1 : 0.01,
      sourceIndex: source.sourceIndex,
    })),
    width: region.width,
    x: region.x,
    y: region.y,
  }));

  return {
    artifactCreatedAt: '2026-06-22T12:00:00.000Z',
    cells,
    command,
    depthConfidenceArtifactId: `artifact_${command.commandId}_depth_confidence`,
    frames,
    outputArtifactId: `artifact_${command.commandId}_output`,
    previewArtifactId: `artifact_${command.commandId}_preview`,
    retouchLayerArtifactId: `artifact_${command.commandId}_retouch`,
    sharpnessMapArtifactId: `artifact_${command.commandId}_sharpness`,
  };
};

const buildSuperResolutionRuntimeRequest = (
  command: Extract<ComputationalMergeCommandEnvelopeV1, { commandType: 'computationalMerge.createSuperResolution' }>,
) => {
  const scale = Math.min(2, Math.floor(command.parameters.outputScale));
  const lowWidth = 24;
  const lowHeight = 18;
  const highWidth = lowWidth * scale;
  const highHeight = lowHeight * scale;
  const truth = createSuperResolutionTruth(highWidth, highHeight);
  const frames = command.parameters.sources.map((source, index) => ({
    contentHash: `sha256:local-app-server-sr-${source.sourceIndex}`,
    graphRevision: `${command.expectedGraphRevision}:source:${source.sourceIndex}`,
    height: lowHeight,
    pixels: downsampleSuperResolutionTruth(
      truth,
      highWidth,
      lowWidth,
      lowHeight,
      index % scale,
      Math.floor(index / scale) % scale,
      scale,
    ),
    shiftX: index % scale,
    shiftY: Math.floor(index / scale) % scale,
    sourceIndex: source.sourceIndex,
    width: lowWidth,
  }));

  return {
    command,
    confidenceMapArtifactId: `artifact_${command.commandId}_support_map`,
    frames,
    outputArtifactId: `artifact_${command.commandId}_output`,
    previewArtifactId: `artifact_${command.commandId}_preview`,
  };
};

const createHdrScene = (width: number, height: number): Float64Array => {
  const pixels = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels[y * width + x] = 0.03 + (x / Math.max(1, width - 1)) * 0.11 + (x > 25 && y > 10 && y < 22 ? 0.14 : 0);
    }
  }
  return pixels;
};

const renderHdrBracket = (scenePixels: Float64Array, exposureEv: number): Float64Array => {
  const pixels = new Float64Array(scenePixels.length);
  for (let index = 0; index < scenePixels.length; index += 1) {
    pixels[index] = Math.min(1, (scenePixels[index] ?? 0) * 2 ** exposureEv);
  }
  return pixels;
};

const shiftFloat64Frame = (
  image: Float64Array,
  width: number,
  height: number,
  shiftX: number,
  shiftY: number,
): Float64Array => {
  const shifted = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = x - shiftX;
      const sourceY = y - shiftY;
      if (sourceX >= 0 && sourceX < width && sourceY >= 0 && sourceY < height) {
        shifted[y * width + x] = image[sourceY * width + sourceX] ?? 0;
      }
    }
  }
  return shifted;
};

const createFocusFrame = (
  width: number,
  height: number,
  sourceIndex: number,
  sourceRegions: Array<{ sourceIndex: number; width: number; x: number }>,
): Float32Array => {
  const pixels = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const localPattern = ((x * 7 + y * 11 + sourceIndex * 19) % 31) / 255;
      const sourceRegion = sourceRegions.find((region) => x >= region.x && x < region.x + region.width);
      const focusBoost = sourceRegion?.sourceIndex === sourceIndex ? 0.72 : 0.08;
      pixels[y * width + x] = Math.min(1, 0.12 + localPattern + focusBoost);
    }
  }
  return pixels;
};

const createSuperResolutionTruth = (width: number, height: number): Float32Array => {
  const pixels = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels[y * width + x] = Math.max(
        0,
        Math.min(1, (x / width) * 0.35 + (y / height) * 0.25 + (x % 3 === 0 ? 0.28 : 0.08)),
      );
    }
  }
  return pixels;
};

const downsampleSuperResolutionTruth = (
  truthPixels: Float32Array,
  highWidth: number,
  lowWidth: number,
  lowHeight: number,
  shiftX: number,
  shiftY: number,
  scale: number,
): Float32Array => {
  const pixels = new Float32Array(lowWidth * lowHeight);
  for (let y = 0; y < lowHeight; y += 1) {
    for (let x = 0; x < lowWidth; x += 1) {
      pixels[y * lowWidth + x] = truthPixels[(y * scale + shiftY) * highWidth + x * scale + shiftX] ?? 0;
    }
  }
  return pixels;
};

export class RawEngineLocalAppServerBridge {
  readonly #acceptedAiEnhancementDryRunPlanKeys: Map<string, { planHash: string; planId: string }> = new Map();
  readonly #acceptedAiToolDryRunPlanKeys: Map<string, { planHash: string; planId: string }> = new Map();
  readonly #acceptedBasicToneDryRunPlanKeys: Map<string, { planHash: string; planId: string }> = new Map();
  readonly #acceptedDetailEffectsDryRunPlanKeys: Map<string, { planHash: string; planId: string }> = new Map();
  readonly #acceptedLensProfileDryRunPlanKeys: Map<string, { planHash: string; planId: string }> = new Map();
  readonly #acceptedHslDryRunPlanKeys: Set<string> = new Set<string>();
  readonly #acceptedSkinToneUniformityDryRunPlanKeys: Set<string> = new Set<string>();
  readonly #auditEvents: Array<RawEngineLocalAppServerAuditEventV1> = [];
  readonly #availableAiProviderIds: ReadonlySet<string>;
  readonly #commandBus: EditCommandBus;
  readonly #computationalMergeRuntimeBuses = {
    focus_stack: new FocusStackAppServerRuntimeToolBusV1(localComputationalMergeRuntimeManifest),
    hdr: new HdrAppServerRuntimeToolBusV1(localComputationalMergeRuntimeManifest),
    panorama: new PanoramaAppServerRuntimeToolBusV1(localComputationalMergeRuntimeManifest),
    super_resolution: new SuperResolutionAppServerRuntimeToolBusV1(localComputationalMergeRuntimeManifest),
  };
  readonly #linearGradientMaskRuntime = new LinearGradientMaskCommandRuntime({ height: 512, width: 768 });
  readonly #projectLibrarySnapshot: ProjectLibrarySnapshotV1;
  readonly #toolRegistry: RawEngineToolRegistryV1;

  constructor(
    options: {
      availableAiProviderIds?: readonly string[];
      commandBus?: EditCommandBus;
      projectLibrarySnapshot?: ProjectLibrarySnapshotV1;
      toolRegistry?: RawEngineToolRegistryV1;
    } = {},
  ) {
    this.#availableAiProviderIds = new Set(options.availableAiProviderIds ?? ['rawengine-local-ai']);
    this.#commandBus = options.commandBus ?? new EditCommandBus();
    this.#projectLibrarySnapshot = projectLibrarySnapshotV1Schema.parse(
      options.projectLibrarySnapshot ?? DEFAULT_LOCAL_PROJECT_LIBRARY_SNAPSHOT,
    );
    this.#toolRegistry = filterRawEngineLocalAppServerExecutableToolRegistry(
      options.toolRegistry ?? rawEngineDefaultToolRegistryV1,
    );
    this.#registerHandlers();
  }

  async dispatch(command: unknown, context?: EditCommandBusContext): Promise<EditCommandDispatchResult> {
    const result = await this.#commandBus.dispatch(command, context);
    this.#recordAuditEvent(command, result, context);
    return result;
  }

  listCommandTypes(): string[] {
    return this.#commandBus.listCommandTypes();
  }

  listAuditEvents(): Array<RawEngineLocalAppServerAuditEventV1> {
    return this.#auditEvents.map((event) => rawEngineLocalAppServerAuditEventV1Schema.parse(event));
  }

  #recordAuditEvent(
    command: unknown,
    result: EditCommandDispatchResult,
    context: EditCommandBusContext | undefined,
  ): void {
    const commandProbe = rawEngineLocalAppServerAuditCommandProbeV1Schema.safeParse(command);
    if (!commandProbe.success) return;

    const resultProbe = result.ok
      ? rawEngineLocalAppServerAuditResultProbeV1Schema.safeParse(result.result)
      : ({ success: false } satisfies { success: false });
    const warnings = resultProbe.success ? resultProbe.data.warnings : [];
    const mutates = resultProbe.success ? (resultProbe.data.mutates ?? !commandProbe.data.dryRun) : false;
    const timestampIso = (context?.now ?? (() => new Date()))().toISOString();
    const providerFallback = this.#buildProviderFallback(commandProbe.data);
    const appServerToolName = AI_COMMAND_TYPE_TO_APP_SERVER_TOOL_NAME_LOOKUP.get(commandProbe.data.commandType);
    const status = result.ok ? 'completed' : providerFallback === undefined ? 'rejected' : 'blocked';

    this.#auditEvents.push(
      rawEngineLocalAppServerAuditEventV1Schema.parse({
        ...(resultProbe.success && resultProbe.data.appliedGraphRevision !== undefined
          ? { appliedGraphRevision: resultProbe.data.appliedGraphRevision }
          : {}),
        ...(commandProbe.data.parameters?.acceptedDryRunPlanHash === undefined ||
        commandProbe.data.parameters.acceptedDryRunPlanId === undefined
          ? {}
          : {
              acceptedDryRun: {
                planHash: commandProbe.data.parameters.acceptedDryRunPlanHash,
                planId: commandProbe.data.parameters.acceptedDryRunPlanId,
              },
            }),
        ...(commandProbe.data.approval?.state === undefined ? {} : { approvalState: commandProbe.data.approval.state }),
        commandId: commandProbe.data.commandId,
        commandType: commandProbe.data.commandType,
        correlationId: commandProbe.data.correlationId,
        dryRun: commandProbe.data.dryRun,
        eventId: `audit_${this.#auditEvents.length + 1}_${commandProbe.data.commandId}`,
        ...(commandProbe.data.expectedGraphRevision === undefined
          ? {}
          : { expectedGraphRevision: commandProbe.data.expectedGraphRevision }),
        mutates,
        ...(providerFallback === undefined || result.ok ? {} : { providerFallback }),
        ...(context?.requestId === undefined ? {} : { requestId: context.requestId }),
        ...(resultProbe.success && resultProbe.data.sourceGraphRevision !== undefined
          ? { sourceGraphRevision: resultProbe.data.sourceGraphRevision }
          : {}),
        status,
        timestampIso,
        ...(appServerToolName === undefined ? {} : { toolName: appServerToolName }),
        warnings:
          providerFallback === undefined || result.ok ? warnings : [...warnings, providerFallback.userVisibleMessage],
      }),
    );
  }

  #buildProviderFallback(
    command: z.infer<typeof rawEngineLocalAppServerAuditCommandProbeV1Schema>,
  ): RawEngineLocalAppServerAuditEventV1['providerFallback'] {
    if (
      command.parameters?.providerClass === undefined ||
      command.parameters.providerId === undefined ||
      this.#availableAiProviderIds.has(command.parameters.providerId)
    ) {
      return undefined;
    }

    const reasonCode =
      command.parameters.providerClass === 'self_hosted_connector'
        ? 'connector_unavailable'
        : command.parameters.providerClass === 'cloud_service'
          ? 'cloud_unavailable'
          : 'provider_unavailable';

    return {
      effectiveProviderClass: 'local_model',
      effectiveProviderId: 'cpu',
      executionDisposition: 'blocked',
      fallbackReason: 'provider_unavailable',
      reasonCode,
      requestedProviderClass: command.parameters.providerClass,
      requestedProviderId: command.parameters.providerId,
      routingFallbackApplied: true,
      userVisibleMessage: `AI provider ${command.parameters.providerId} is unavailable; no pixels were sent and no edit was applied.`,
    };
  }

  #assertAiProviderAvailable(
    command: RawEngineLocalAppServerAiToolCommandV1 | RawEngineLocalAppServerAiEnhancementCommandV1,
  ): void {
    const providerFallback = this.#buildProviderFallback(command);
    if (providerFallback === undefined) return;

    throw new Error(providerFallback.userVisibleMessage);
  }

  #dispatchComputationalMergeCommand(command: RawEngineLocalAppServerComputationalMergeCommandV1): unknown {
    const family = computationalMergeFamilyForCommand(command);
    return this.#computationalMergeRuntimeBuses[family].execute({
      request: buildComputationalMergeRuntimeRequest(command),
      toolName: computationalMergeToolNameForCommand(command),
    });
  }

  #registerHandlers(): void {
    this.#commandBus.register({
      commandType: RawEngineLocalAppServerCommandType.ToolRegistryQuery,
      execute: () => this.#toolRegistry,
      schema: rawEngineLocalAppServerToolRegistryQueryV1Schema,
    });

    this.#commandBus.register({
      commandType: RawEngineLocalAppServerCommandType.ProjectMetadataQuery,
      execute: () => buildProjectMetadataResult(this.#projectLibrarySnapshot),
      schema: rawEngineLocalAppServerProjectMetadataQueryV1Schema,
    });

    this.#commandBus.register({
      commandType: RawEngineLocalAppServerCommandType.SelectedImagesQuery,
      execute: () => buildSelectedImagesResult(this.#projectLibrarySnapshot),
      schema: rawEngineLocalAppServerSelectedImagesQueryV1Schema,
    });

    this.#commandBus.register({
      commandType: RawEngineLocalAppServerCommandType.ImageMetadataQuery,
      execute: (command) => buildImageMetadataResult(this.#projectLibrarySnapshot, command.imagePath),
      schema: rawEngineLocalAppServerImageMetadataQueryV1Schema,
    });

    this.#commandBus.register({
      commandType: RawEngineLocalAppServerCommandType.EditorStateQuery,
      execute: () => buildEditorStateResult(this.#projectLibrarySnapshot),
      schema: rawEngineLocalAppServerEditorStateQueryV1Schema,
    });

    this.#commandBus.register({
      commandType: 'toneColor.setBasicTone',
      execute: (command) => {
        const parsedCommand = rawEngineLocalAppServerBasicToneCommandV1Schema.parse(command);
        if (parsedCommand.commandType !== 'toneColor.setBasicTone') {
          throw new Error('Local app-server bridge expected a basic-tone command after schema validation.');
        }
        if (parsedCommand.dryRun) {
          const dryRunResult = buildBasicToneDryRunResult(parsedCommand);
          if (dryRunResult.dryRunPlanHash === undefined || dryRunResult.dryRunPlanId === undefined) {
            throw new Error('Local app-server bridge basic-tone dry-run did not produce a plan identity.');
          }

          this.#acceptedBasicToneDryRunPlanKeys.set(buildBasicTonePlanKey(parsedCommand), {
            planHash: dryRunResult.dryRunPlanHash,
            planId: dryRunResult.dryRunPlanId,
          });
          return dryRunResult;
        }

        const plan = this.#acceptedBasicToneDryRunPlanKeys.get(buildBasicTonePlanKey(parsedCommand));
        if (
          plan === undefined ||
          plan.planHash !== parsedCommand.parameters.acceptedDryRunPlanHash ||
          plan.planId !== parsedCommand.parameters.acceptedDryRunPlanId
        ) {
          throw new Error('Local app-server bridge rejected basic-tone apply without a matching accepted dry-run.');
        }

        return buildBasicToneMutationResult(parsedCommand);
      },
      schema: rawEngineLocalAppServerBasicToneCommandV1Schema,
    });

    this.#commandBus.register({
      commandType: 'toneColor.adjustHsl',
      execute: (command) => {
        const parsedCommand = rawEngineLocalAppServerHslCommandV1Schema.parse(command);
        if (parsedCommand.commandType !== 'toneColor.adjustHsl') {
          throw new Error('Local app-server bridge expected an HSL/selective-color command after schema validation.');
        }
        if (parsedCommand.dryRun) {
          const dryRunResult = buildHslDryRunResult(parsedCommand);
          this.#acceptedHslDryRunPlanKeys.add(buildHslPlanKey(parsedCommand));
          return dryRunResult;
        }

        const planKey = buildHslPlanKey(parsedCommand);
        if (!this.#acceptedHslDryRunPlanKeys.has(planKey)) {
          throw new Error('Local app-server bridge rejected HSL/selective-color apply without a matching dry-run.');
        }

        return buildHslMutationResult(parsedCommand);
      },
      schema: rawEngineLocalAppServerHslCommandV1Schema,
    });

    this.#commandBus.register({
      commandType: 'toneColor.adjustSkinToneUniformity',
      execute: (command) => {
        const parsedCommand = rawEngineLocalAppServerSkinToneUniformityCommandV1Schema.parse(command);
        if (parsedCommand.commandType !== 'toneColor.adjustSkinToneUniformity') {
          throw new Error('Local app-server bridge expected a skin-tone uniformity command after schema validation.');
        }
        if (parsedCommand.dryRun) {
          const dryRunResult = buildSkinToneUniformityDryRunResult(parsedCommand);
          this.#acceptedSkinToneUniformityDryRunPlanKeys.add(buildSkinToneUniformityPlanKey(parsedCommand));
          return dryRunResult;
        }

        const planKey = buildSkinToneUniformityPlanKey(parsedCommand);
        if (!this.#acceptedSkinToneUniformityDryRunPlanKeys.has(planKey)) {
          throw new Error('Local app-server bridge rejected skin-tone uniformity apply without a matching dry-run.');
        }

        return buildSkinToneUniformityMutationResult(parsedCommand);
      },
      schema: rawEngineLocalAppServerSkinToneUniformityCommandV1Schema,
    });

    this.#commandBus.register({
      commandType: 'detailEffects.dryRunAdjustments',
      execute: (command) => {
        const parsedCommand = rawEngineLocalAppServerDetailEffectsCommandV1Schema.parse(command);
        if (parsedCommand.commandType !== 'detailEffects.dryRunAdjustments') {
          throw new Error('Local app-server bridge expected a detail/effects dry-run command.');
        }

        const dryRunResult = buildDetailEffectsDryRunResult(parsedCommand);
        this.#acceptedDetailEffectsDryRunPlanKeys.set(buildDetailEffectsPlanKey(parsedCommand), {
          planHash: dryRunResult.dryRunPlanHash,
          planId: dryRunResult.dryRunPlanId,
        });
        return dryRunResult;
      },
      schema: rawEngineLocalAppServerDetailEffectsCommandV1Schema,
    });

    this.#commandBus.register({
      commandType: 'detailEffects.applyAdjustments',
      execute: (command) => {
        const parsedCommand = rawEngineLocalAppServerDetailEffectsCommandV1Schema.parse(command);
        if (parsedCommand.commandType !== 'detailEffects.applyAdjustments') {
          throw new Error('Local app-server bridge expected a detail/effects apply command.');
        }

        const plan = this.#acceptedDetailEffectsDryRunPlanKeys.get(buildDetailEffectsPlanKey(parsedCommand));
        if (
          plan === undefined ||
          plan.planHash !== parsedCommand.parameters.acceptedDryRunPlanHash ||
          plan.planId !== parsedCommand.parameters.acceptedDryRunPlanId
        ) {
          throw new Error('Local app-server bridge rejected detail/effects apply without a matching accepted dry-run.');
        }

        return buildDetailEffectsMutationResult(parsedCommand);
      },
      schema: rawEngineLocalAppServerDetailEffectsCommandV1Schema,
    });

    this.#commandBus.register({
      commandType: 'lensProfile.dryRunCorrection',
      execute: (command) => {
        const parsedCommand = rawEngineLocalAppServerLensProfileCommandV1Schema.parse(command);
        if (parsedCommand.commandType !== 'lensProfile.dryRunCorrection') {
          throw new Error('Local app-server bridge expected a lens/profile dry-run command.');
        }

        const dryRunResult = buildLensProfileDryRunResult(parsedCommand);
        this.#acceptedLensProfileDryRunPlanKeys.set(buildLensProfilePlanKey(parsedCommand), {
          planHash: dryRunResult.dryRunPlanHash,
          planId: dryRunResult.dryRunPlanId,
        });
        return dryRunResult;
      },
      schema: rawEngineLocalAppServerLensProfileCommandV1Schema,
    });

    this.#commandBus.register({
      commandType: 'lensProfile.applyCorrection',
      execute: (command) => {
        const parsedCommand = rawEngineLocalAppServerLensProfileCommandV1Schema.parse(command);
        if (parsedCommand.commandType !== 'lensProfile.applyCorrection') {
          throw new Error('Local app-server bridge expected a lens/profile apply command.');
        }

        const plan = this.#acceptedLensProfileDryRunPlanKeys.get(buildLensProfilePlanKey(parsedCommand));
        if (
          plan === undefined ||
          plan.planHash !== parsedCommand.parameters.acceptedDryRunPlanHash ||
          plan.planId !== parsedCommand.parameters.acceptedDryRunPlanId
        ) {
          throw new Error('Local app-server bridge rejected lens/profile apply without a matching accepted dry-run.');
        }

        return buildLensProfileMutationResult(parsedCommand);
      },
      schema: rawEngineLocalAppServerLensProfileCommandV1Schema,
    });

    this.#commandBus.register({
      commandType: 'ai.mask.generateSubject',
      execute: (command) => {
        const parsedCommand = rawEngineLocalAppServerAiToolCommandV1Schema.parse(command);
        if (parsedCommand.commandType !== 'ai.mask.generateSubject') {
          throw new Error('Local app-server bridge expected an AI mask dry-run command.');
        }
        this.#assertAiProviderAvailable(parsedCommand);

        const dryRunResult = buildAiToolDryRunResult(parsedCommand);
        this.#acceptedAiToolDryRunPlanKeys.set(buildAiToolPlanKey(parsedCommand), {
          planHash: dryRunResult.dryRunPlanHash,
          planId: dryRunResult.dryRunPlanId,
        });
        return dryRunResult;
      },
      schema: rawEngineLocalAppServerAiToolCommandV1Schema,
    });

    this.#commandBus.register({
      commandType: 'ai.mask.applySubject',
      execute: (command) => {
        const parsedCommand = rawEngineLocalAppServerAiToolCommandV1Schema.parse(command);
        if (parsedCommand.commandType !== 'ai.mask.applySubject') {
          throw new Error('Local app-server bridge expected an AI mask apply command.');
        }
        this.#assertAiProviderAvailable(parsedCommand);

        const plan = this.#acceptedAiToolDryRunPlanKeys.get(buildAiToolPlanKey(parsedCommand));
        if (
          plan === undefined ||
          plan.planHash !== parsedCommand.parameters.acceptedDryRunPlanHash ||
          plan.planId !== parsedCommand.parameters.acceptedDryRunPlanId
        ) {
          throw new Error('Local app-server bridge rejected AI mask apply without a matching dry-run.');
        }

        return buildAiToolMutationResult(parsedCommand);
      },
      schema: rawEngineLocalAppServerAiToolCommandV1Schema,
    });

    this.#commandBus.register({
      commandType: 'layerMask.createGradientMask',
      execute: (command) => {
        const parsedCommand = rawEngineLocalAppServerLayerMaskCommandV1Schema.parse(command);
        if (
          parsedCommand.commandType !== 'layerMask.createGradientMask' ||
          parsedCommand.parameters.gradient.gradientKind !== 'linear'
        ) {
          throw new Error('Local app-server bridge expected a linear gradient layer-mask command.');
        }

        return this.#linearGradientMaskRuntime.dispatch(parsedCommand satisfies LayerMaskCommandEnvelopeV1);
      },
      schema: rawEngineLocalAppServerLayerMaskCommandV1Schema,
    });

    this.#commandBus.register({
      commandType: 'ai.enhancement.dryRun',
      execute: (command) => {
        const parsedCommand = rawEngineLocalAppServerAiEnhancementCommandV1Schema.parse(command);
        if (parsedCommand.commandType !== 'ai.enhancement.dryRun') {
          throw new Error('Local app-server bridge expected an AI enhancement dry-run command.');
        }
        this.#assertAiProviderAvailable(parsedCommand);

        const dryRunResult = buildAiEnhancementDryRunResult(parsedCommand);
        this.#acceptedAiEnhancementDryRunPlanKeys.set(buildAiEnhancementPlanKey(parsedCommand), {
          planHash: dryRunResult.dryRunPlanHash,
          planId: dryRunResult.dryRunPlanId,
        });
        return dryRunResult;
      },
      schema: rawEngineLocalAppServerAiEnhancementCommandV1Schema,
    });

    this.#commandBus.register({
      commandType: 'ai.enhancement.apply',
      execute: (command) => {
        const parsedCommand = rawEngineLocalAppServerAiEnhancementCommandV1Schema.parse(command);
        if (parsedCommand.commandType !== 'ai.enhancement.apply') {
          throw new Error('Local app-server bridge expected an AI enhancement apply command.');
        }
        this.#assertAiProviderAvailable(parsedCommand);

        const plan = this.#acceptedAiEnhancementDryRunPlanKeys.get(buildAiEnhancementPlanKey(parsedCommand));
        if (
          plan === undefined ||
          plan.planHash !== parsedCommand.parameters.acceptedDryRunPlanHash ||
          plan.planId !== parsedCommand.parameters.acceptedDryRunPlanId
        ) {
          throw new Error('Local app-server bridge rejected AI enhancement apply without a matching dry-run.');
        }

        return buildAiEnhancementMutationResult(parsedCommand);
      },
      schema: rawEngineLocalAppServerAiEnhancementCommandV1Schema,
    });

    for (const commandType of [
      'computationalMerge.createFocusStack',
      'computationalMerge.createHdr',
      'computationalMerge.createPanorama',
      'computationalMerge.createSuperResolution',
    ] as const) {
      this.#commandBus.register({
        commandType,
        execute: (command) => this.#dispatchComputationalMergeCommand(command),
        schema: rawEngineLocalAppServerComputationalMergeCommandV1Schema,
      });
    }
  }
}

export const dispatchRawEngineLocalAppServerComputationalMergeDerivedSourceOpen = (
  request: ComputationalMergeDerivedSourceOpenRequestV1,
): unknown => openComputationalMergeDerivedSourceV1(request);

export const createRawEngineLocalAppServerBridge = (
  options: { availableAiProviderIds?: readonly string[]; projectLibrarySnapshot?: ProjectLibrarySnapshotV1 } = {},
): RawEngineLocalAppServerBridge => new RawEngineLocalAppServerBridge(options);

export const buildRawEngineLocalAppServerBridgeCapabilities = (
  bridge = createRawEngineLocalAppServerBridge(),
): {
  commandTypes: string[];
  mutatingCommands: boolean;
  runtimeStatus: 'basic_tone_hsl_skin_tone_ai_mask_and_ai_enhancement_dry_run_apply';
} => {
  const commandTypes = bridge.listCommandTypes().sort((left, right) => left.localeCompare(right));

  return {
    commandTypes,
    mutatingCommands:
      commandTypes.includes('ai.enhancement.apply') ||
      commandTypes.includes('ai.mask.applySubject') ||
      commandTypes.includes('toneColor.adjustHsl') ||
      commandTypes.includes('toneColor.adjustSkinToneUniformity') ||
      commandTypes.includes('toneColor.setBasicTone'),
    runtimeStatus: 'basic_tone_hsl_skin_tone_ai_mask_and_ai_enhancement_dry_run_apply',
  };
};

export const buildRawEngineLocalAppServerToolRegistryQuery = (
  requestId: string,
): RawEngineLocalAppServerToolRegistryQueryV1 =>
  rawEngineLocalAppServerToolRegistryQueryV1Schema.parse({
    commandType: RawEngineLocalAppServerCommandType.ToolRegistryQuery,
    requestId,
  });

export const rawEngineLocalAppServerBridgeCapabilities = Object.freeze(
  buildRawEngineLocalAppServerBridgeCapabilities(),
);
