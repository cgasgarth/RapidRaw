import { z } from 'zod';

import { EditCommandBus, type EditCommandBusContext, type EditCommandDispatchResult } from './editCommandBus.js';
import {
  ApprovalClass,
  aiEnhancementApplyResultV1Schema,
  aiEnhancementCommandEnvelopeV1Schema,
  aiEnhancementDryRunResultV1Schema,
  aiToolApplyResultV1Schema,
  aiToolCommandEnvelopeV1Schema,
  aiToolDryRunResultV1Schema,
  toneColorCommandEnvelopeV1Schema,
  toneColorDryRunResultV1Schema,
  toneColorMutationResultV1Schema,
  type RawEngineToolRegistryV1,
  type ToneColorHslBandV1,
  type ToneColorCommandEnvelopeV1,
  type ToneColorDryRunResultV1,
  type ToneColorMutationResultV1,
} from './rawEngineSchemas.js';
import { rawEngineDefaultToolRegistryV1 } from './toolRegistry.js';

export const RawEngineLocalAppServerCommandType = {
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
  parameters: z
    .looseObject({
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
} as const satisfies Partial<Record<string, string>>;

const AI_COMMAND_TYPE_TO_APP_SERVER_TOOL_NAME_LOOKUP = new Map<string, string>(
  Object.entries(AI_COMMAND_TYPE_TO_APP_SERVER_TOOL_NAME),
);

const rawEngineLocalAppServerAuditResultProbeV1Schema = z.looseObject({
  mutates: z.boolean().optional(),
  warnings: z.array(z.string().trim().min(1)),
});

export const rawEngineLocalAppServerAuditEventV1Schema = z
  .object({
    approvalState: z.string().trim().min(1).optional(),
    commandId: z.string().trim().min(1),
    commandType: z.string().trim().min(1),
    correlationId: z.string().trim().min(1),
    dryRun: z.boolean(),
    eventId: z.string().trim().min(1),
    mutates: z.boolean(),
    requestId: z.string().trim().min(1).optional(),
    status: z.enum(['blocked', 'completed', 'rejected']),
    timestampIso: z.iso.datetime(),
    toolName: z.string().trim().min(1).optional(),
    warnings: z.array(z.string().trim().min(1)),
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
} as const satisfies Record<
  keyof Extract<ToneColorCommandEnvelopeV1, { commandType: 'toneColor.setBasicTone' }>['parameters'],
  string
>;

const buildBasicToneDryRunResult = (
  command: Extract<ToneColorCommandEnvelopeV1, { commandType: 'toneColor.setBasicTone' }>,
): ToneColorDryRunResultV1 =>
  toneColorDryRunResultV1Schema.parse({
    colorPipeline: command.colorPipeline,
    commandId: command.commandId,
    commandType: command.commandType,
    correlationId: command.correlationId,
    dryRun: true,
    mutates: false,
    parameterDiff: Object.entries(BASIC_TONE_PARAMETER_DIFF_PATHS).map(([key, path]) => ({
      module: 'basic_tone',
      path,
      value: command.parameters[key as keyof typeof BASIC_TONE_PARAMETER_DIFF_PATHS],
    })),
    predictedGraphRevision: `${command.expectedGraphRevision}:preview:${command.commandId}`,
    previewArtifacts: [],
    schemaVersion: command.schemaVersion,
    sourceGraphRevision: command.expectedGraphRevision,
    warnings: [],
  });

const buildBasicTonePlanKey = (
  command: Extract<ToneColorCommandEnvelopeV1, { commandType: 'toneColor.setBasicTone' }>,
): string => JSON.stringify([command.expectedGraphRevision, command.target, command.parameters]);

const buildBasicToneMutationResult = (
  command: Extract<ToneColorCommandEnvelopeV1, { commandType: 'toneColor.setBasicTone' }>,
): ToneColorMutationResultV1 =>
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
    parameterDiff: HSL_PARAMETER_DIFF_PATHS.map(([key, path]) => ({
      module: 'hsl',
      path: `/parameters/${command.parameters.band}/${path}`,
      previousValue: 0,
      value: command.parameters[key],
    })),
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

const buildAiToolDryRunResult = (
  command: RawEngineLocalAppServerAiToolCommandV1,
): z.infer<typeof aiToolDryRunResultV1Schema> =>
  aiToolDryRunResultV1Schema.parse({
    commandId: command.commandId,
    commandType: 'ai.mask.generateSubject',
    correlationId: command.correlationId,
    dryRunPlanHash: buildAiToolPlanHash(command),
    dryRunPlanId: buildAiToolPlanId(command),
    maskArtifacts: [
      {
        artifactId: `artifact_${command.parameters.capability}_${command.commandId}_mask`,
        contentHash: command.parameters.sourceContentHash,
        dimensions: {
          height: 1080,
          width: 1620,
        },
        kind: 'mask',
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
    warnings: ['Synthetic AI mask app-server proof: no real RAW model inference claim.'],
  });

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

export class RawEngineLocalAppServerBridge {
  readonly #acceptedAiEnhancementDryRunPlanKeys: Map<string, { planHash: string; planId: string }> = new Map();
  readonly #acceptedAiToolDryRunPlanKeys: Map<string, { planHash: string; planId: string }> = new Map();
  readonly #acceptedBasicToneDryRunPlanKeys: Set<string> = new Set<string>();
  readonly #acceptedHslDryRunPlanKeys: Set<string> = new Set<string>();
  readonly #acceptedSkinToneUniformityDryRunPlanKeys: Set<string> = new Set<string>();
  readonly #auditEvents: Array<RawEngineLocalAppServerAuditEventV1> = [];
  readonly #availableAiProviderIds: ReadonlySet<string>;
  readonly #commandBus: EditCommandBus;
  readonly #toolRegistry: RawEngineToolRegistryV1;

  constructor(
    options: {
      availableAiProviderIds?: readonly string[];
      commandBus?: EditCommandBus;
      toolRegistry?: RawEngineToolRegistryV1;
    } = {},
  ) {
    this.#availableAiProviderIds = new Set(options.availableAiProviderIds ?? ['rawengine-local-ai']);
    this.#commandBus = options.commandBus ?? new EditCommandBus();
    this.#toolRegistry = options.toolRegistry ?? rawEngineDefaultToolRegistryV1;
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
        ...(commandProbe.data.approval?.state === undefined ? {} : { approvalState: commandProbe.data.approval.state }),
        commandId: commandProbe.data.commandId,
        commandType: commandProbe.data.commandType,
        correlationId: commandProbe.data.correlationId,
        dryRun: commandProbe.data.dryRun,
        eventId: `audit_${this.#auditEvents.length + 1}_${commandProbe.data.commandId}`,
        mutates,
        ...(providerFallback === undefined || result.ok ? {} : { providerFallback }),
        ...(context?.requestId === undefined ? {} : { requestId: context.requestId }),
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

  #registerHandlers(): void {
    this.#commandBus.register({
      commandType: RawEngineLocalAppServerCommandType.ToolRegistryQuery,
      execute: () => this.#toolRegistry,
      schema: rawEngineLocalAppServerToolRegistryQueryV1Schema,
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
          this.#acceptedBasicToneDryRunPlanKeys.add(buildBasicTonePlanKey(parsedCommand));
          return dryRunResult;
        }

        const planKey = buildBasicTonePlanKey(parsedCommand);
        if (!this.#acceptedBasicToneDryRunPlanKeys.has(planKey)) {
          throw new Error('Local app-server bridge rejected basic-tone apply without a matching dry-run.');
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
  }
}

export const createRawEngineLocalAppServerBridge = (
  options: { availableAiProviderIds?: readonly string[] } = {},
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
