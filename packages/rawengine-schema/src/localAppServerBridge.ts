import { z } from 'zod';

import { EditCommandBus, type EditCommandBusContext, type EditCommandDispatchResult } from './editCommandBus.js';
import {
  ApprovalClass,
  rawEngineToolRegistryV1Schema,
  toneColorCommandEnvelopeV1Schema,
  toneColorDryRunResultV1Schema,
  type RawEngineToolRegistryV1,
  type ToneColorCommandEnvelopeV1,
  type ToneColorDryRunResultV1,
} from './rawEngineSchemas.js';
import { sampleToolRegistryV1 } from './samplePayloads.js';

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

export type RawEngineLocalAppServerToolRegistryQueryV1 = z.infer<
  typeof rawEngineLocalAppServerToolRegistryQueryV1Schema
>;
export type RawEngineLocalAppServerBasicToneDryRunCommandV1 = z.infer<
  typeof rawEngineLocalAppServerBasicToneDryRunCommandV1Schema
>;

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

export class RawEngineLocalAppServerBridge {
  readonly #commandBus: EditCommandBus;
  readonly #toolRegistry: RawEngineToolRegistryV1;

  constructor(options: { commandBus?: EditCommandBus; toolRegistry?: RawEngineToolRegistryV1 } = {}) {
    this.#commandBus = options.commandBus ?? new EditCommandBus();
    this.#toolRegistry = rawEngineToolRegistryV1Schema.parse(options.toolRegistry ?? sampleToolRegistryV1);
    this.#registerHandlers();
  }

  dispatch<TResult = unknown>(
    command: unknown,
    context?: EditCommandBusContext,
  ): Promise<EditCommandDispatchResult<TResult>> {
    return this.#commandBus.dispatch<TResult>(command, context);
  }

  listCommandTypes(): string[] {
    return this.#commandBus.listCommandTypes();
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
        const parsedCommand = rawEngineLocalAppServerBasicToneDryRunCommandV1Schema.parse(command);
        if (parsedCommand.commandType !== 'toneColor.setBasicTone') {
          throw new Error('Local app-server bridge expected a basic-tone command after schema validation.');
        }
        return buildBasicToneDryRunResult(parsedCommand);
      },
      schema: rawEngineLocalAppServerBasicToneDryRunCommandV1Schema,
    });
  }
}

export const createRawEngineLocalAppServerBridge = (): RawEngineLocalAppServerBridge =>
  new RawEngineLocalAppServerBridge();

export const buildRawEngineLocalAppServerToolRegistryQuery = (
  requestId: string,
): RawEngineLocalAppServerToolRegistryQueryV1 =>
  rawEngineLocalAppServerToolRegistryQueryV1Schema.parse({
    commandType: RawEngineLocalAppServerCommandType.ToolRegistryQuery,
    requestId,
  });

export const rawEngineLocalAppServerBridgeCapabilities = Object.freeze({
  commandTypes: [RawEngineLocalAppServerCommandType.ToolRegistryQuery, 'toneColor.setBasicTone'],
  mutatingCommands: false,
  runtimeStatus: 'local_bridge_scaffold',
});
