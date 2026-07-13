import { invoke } from '@tauri-apps/api/core';
import { z } from 'zod';
import { beginStaticStartup } from '../../product/startupBootstrap';
import { Invokes } from '../../tauri/commands';

const startupPhaseSchema = z.enum([
  'processStarted',
  'minimalSettingsLoaded',
  'windowCreated',
  'windowVisible',
  'coreCommandsReady',
  'libraryServicesReady',
  'gpuReady',
  'optionalServicesReady',
  'frontendShellVisible',
  'frontendInteractive',
  'frontendSettingsHydrated',
  'frontendLibraryReady',
  'frontendEditorReady',
]);

export const startupTraceSnapshotSchema = z
  .object({
    criticalPathOrderValid: z.boolean(),
    firstPaintBudgetMet: z.boolean().nullable(),
    firstPaintBudgetMs: z.number().int().positive(),
    phases: z.array(
      z
        .object({
          detail: z.string().nullable().optional(),
          elapsedMs: z.number().int().nonnegative(),
          phase: startupPhaseSchema,
          status: z.enum(['ok', 'degraded', 'failed']),
        })
        .strict(),
    ),
    processId: z.number().int().positive(),
    traceId: z.string().startsWith('startup:'),
  })
  .strict();

export type StartupTraceSnapshot = z.infer<typeof startupTraceSnapshotSchema>;
export type FrontendStartupPhase = 'editorReady' | 'interactive' | 'libraryReady' | 'settingsHydrated' | 'shellVisible';
export type StartupPhaseStatus = 'degraded' | 'failed' | 'ok';

type InvokeCommand = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export interface FrontendStartupReporter {
  mark: (
    phase: Exclude<FrontendStartupPhase, 'shellVisible'>,
    status?: StartupPhaseStatus,
    detail?: string | null,
  ) => Promise<StartupTraceSnapshot>;
  start: () => Promise<string>;
}

export const createFrontendStartupReporter = (
  invokeCommand: InvokeCommand = invoke as InvokeCommand,
  establishedTraceId?: () => Promise<string>,
): FrontendStartupReporter => {
  let traceIdPromise: Promise<string> | null = null;

  const record = async (
    traceId: string,
    phase: FrontendStartupPhase,
    status: StartupPhaseStatus,
    detail: string | null,
  ): Promise<StartupTraceSnapshot> => {
    const snapshot = startupTraceSnapshotSchema.parse(
      await invokeCommand<unknown>(Invokes.RecordFrontendStartupPhase, {
        detail,
        phase,
        status,
        traceId,
      }),
    );
    if (snapshot.traceId !== traceId) throw new Error('startup_trace_correlation_mismatch');
    return snapshot;
  };

  const start = (): Promise<string> => {
    if (establishedTraceId) return (traceIdPromise ??= establishedTraceId());
    traceIdPromise ??= invokeCommand<void>(Invokes.FrontendReady)
      .then(() => invokeCommand<unknown>(Invokes.GetStartupTrace))
      .then((value) => startupTraceSnapshotSchema.parse(value))
      .then(async (snapshot) => {
        // FrontendReady and GetStartupTrace have already completed two full
        // frontend→native→frontend round trips. Publish the resulting mounted
        // and interactive receipts together so trace bookkeeping does not add
        // another serialized IPC interval to the measured response.
        await Promise.all([
          record(snapshot.traceId, 'shellVisible', 'ok', 'react-root-mounted'),
          record(snapshot.traceId, 'interactive', 'ok', 'react-ipc-round-trips-complete'),
        ]);
        return snapshot.traceId;
      });
    return traceIdPromise;
  };

  return {
    mark: async (phase, status = 'ok', detail = null) => record(await start(), phase, status, detail),
    start,
  };
};

export const frontendStartupReporter = createFrontendStartupReporter(invoke as InvokeCommand, beginStaticStartup);
