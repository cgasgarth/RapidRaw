import {
  buildRawEngineLocalAppServerToolRegistryQuery,
  createRawEngineLocalAppServerBridge,
  dispatchRawEngineLocalAppServerComputationalMergeDerivedSourceOpen,
  RawEngineLocalAppServerCommandType,
  rawEngineLocalAppServerComputationalMergeDerivedSourceOpenRequestV1Schema,
} from '../../packages/rawengine-schema/src/localAppServerBridge';
import {
  type RawEngineToolRegistryV1,
  rawEngineAppServerToolCallValidationV1Schema,
  rawEngineToolRegistryV1Schema,
  toneColorCommandEnvelopeV1Schema,
} from '../../packages/rawengine-schema/src/rawEngineSchemas';
import { rawEngineDefaultToolRegistryV1 } from '../../packages/rawengine-schema/src/toolRegistry';
import {
  AgentRuntimeId,
  type RawEngineAppServerAuditEntry,
  RawEngineAppServerAuditOutcome,
  type RawEngineAppServerCapabilitiesReplay,
  type RawEngineAppServerCapabilitiesRequest,
  type RawEngineAppServerCapabilitiesResponse,
  type RawEngineAppServerClientInfo,
  type RawEngineAppServerHealthReplay,
  type RawEngineAppServerHealthRequest,
  type RawEngineAppServerHealthResponse,
  type RawEngineAppServerHostManifest,
  type RawEngineAppServerHostRequest,
  type RawEngineAppServerHostResponse,
  type RawEngineAppServerHostResponseEnvelope,
  RawEngineAppServerHostToolName,
  RawEngineAppServerLifecyclePhase,
  type RawEngineAppServerLifecycleReplay,
  type RawEngineAppServerLifecycleState,
  RawEngineAppServerProtocol,
  RawEngineAppServerResponseStatus,
  type RawEngineAppServerRouteCatalogEntry,
  type RawEngineAppServerRouteCatalogReplay,
  type RawEngineAppServerRouteCatalogRequest,
  type RawEngineAppServerRouteCatalogResponse,
  type RawEngineAppServerRouteFamily,
  RawEngineAppServerRouteMode,
  type RawEngineAppServerRouteMode as RawEngineAppServerRouteModeValue,
  type RawEngineAppServerStructuredError,
  RawEngineAppServerSupervisorEventKind,
  RawEngineAppServerSupervisorPhase,
  type RawEngineAppServerSupervisorState,
  type RawEngineAppServerToolDispatchRequest,
  type RawEngineAppServerToolDispatchResponse,
  RawEngineAppServerToolKind,
  RawEngineAppServerTransport,
  rawEngineAppServerAuditEntrySchema,
  rawEngineAppServerCapabilitiesReplaySchema,
  rawEngineAppServerCapabilitiesResponseSchema,
  rawEngineAppServerHealthReplaySchema,
  rawEngineAppServerHealthResponseSchema,
  rawEngineAppServerHostManifestSchema,
  rawEngineAppServerHostRequestSchema,
  rawEngineAppServerHostResponseEnvelopeSchema,
  rawEngineAppServerHostResponseSchema,
  rawEngineAppServerLifecycleReplaySchema,
  rawEngineAppServerLifecycleStateSchema,
  rawEngineAppServerRouteCatalogEntrySchema,
  rawEngineAppServerRouteCatalogReplaySchema,
  rawEngineAppServerRouteCatalogResponseSchema,
  rawEngineAppServerStructuredErrorSchema,
  rawEngineAppServerSupervisorStateSchema,
  rawEngineAppServerToolDispatchResponseSchema,
} from '../schemas/agent/agentRuntimeSchemas';
import { useEditorStore } from '../store/useEditorStore';
import {
  AGENT_CURRENT_IMAGE_PREVIEW_LOOP_APPLY_REVIEW_INPUT_SCHEMA_NAME,
  AGENT_CURRENT_IMAGE_PREVIEW_LOOP_APPLY_REVIEW_OUTPUT_SCHEMA_NAME,
  AGENT_CURRENT_IMAGE_PREVIEW_LOOP_APPLY_REVIEW_TOOL_NAME,
  AGENT_CURRENT_IMAGE_PREVIEW_LOOP_INPUT_SCHEMA_NAME,
  AGENT_CURRENT_IMAGE_PREVIEW_LOOP_OUTPUT_SCHEMA_NAME,
  AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME,
  agentCurrentImagePreviewLoopApplyReviewRequestSchema,
  agentCurrentImagePreviewLoopRequestSchema,
  applyAgentCurrentImagePreviewLoopReviewedEdit,
  runAgentCurrentImagePreviewLoop,
} from './agent/context/agentCurrentImagePreviewLoop';
import { buildAgentImageContextSnapshot } from './agent/context/agentImageContextSnapshot';
import {
  AGENT_PREVIEW_COMPARE_INPUT_SCHEMA_NAME,
  AGENT_PREVIEW_COMPARE_OUTPUT_SCHEMA_NAME,
  AGENT_PREVIEW_COMPARE_TOOL_NAME,
  AGENT_PREVIEW_RENDER_INPUT_SCHEMA_NAME,
  AGENT_PREVIEW_RENDER_OUTPUT_SCHEMA_NAME,
  AGENT_PREVIEW_RENDER_TOOL_NAME,
  AGENT_STATE_GET_INPUT_SCHEMA_NAME,
  AGENT_STATE_GET_OUTPUT_SCHEMA_NAME,
  AGENT_STATE_GET_TOOL_NAME,
  agentPreviewCompareRequestSchema,
  agentPreviewRenderRequestSchema,
  agentStateGetRequestSchema,
  getAgentReadOnlyState,
  getRawEngineImagePreview,
  RAW_ENGINE_IMAGE_GET_PREVIEW_INPUT_SCHEMA_NAME,
  RAW_ENGINE_IMAGE_GET_PREVIEW_OUTPUT_SCHEMA_NAME,
  RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME,
  rawEngineImageGetPreviewRequestSchema,
  renderAgentPreviewCompare,
  renderAgentReadOnlyPreview,
} from './agent/context/agentReadOnlyAppServerTools';
import {
  AGENT_LAYER_CREATE_INPUT_SCHEMA_NAME,
  AGENT_LAYER_CREATE_OUTPUT_SCHEMA_NAME,
  AGENT_LAYER_CREATE_TOOL_NAME,
  AGENT_LAYER_SCOPED_ADJUST_INPUT_SCHEMA_NAME,
  AGENT_LAYER_SCOPED_ADJUST_OUTPUT_SCHEMA_NAME,
  AGENT_LAYER_SCOPED_ADJUST_TOOL_NAME,
  AGENT_MASK_CREATE_OR_UPDATE_INPUT_SCHEMA_NAME,
  AGENT_MASK_CREATE_OR_UPDATE_OUTPUT_SCHEMA_NAME,
  AGENT_MASK_CREATE_OR_UPDATE_TOOL_NAME,
  AGENT_OBJECT_SELECTION_APPLY_INPUT_SCHEMA_NAME,
  AGENT_OBJECT_SELECTION_APPLY_OUTPUT_SCHEMA_NAME,
  AGENT_OBJECT_SELECTION_APPLY_TOOL_NAME,
  agentLayerCreateRequestSchema,
  agentLayerScopedAdjustRequestSchema,
  agentMaskCreateOrUpdateRequestSchema,
  agentObjectSelectionApplyRequestSchema,
  applyAgentBrushMaskCreateOrUpdate,
  applyAgentLayerCreate,
  applyAgentLayerScopedAdjustments,
  applyAgentObjectSelection,
} from './agent/layers/agentLayerMaskTools';
import {
  AGENT_EXPORT_PROOF_INPUT_SCHEMA_NAME,
  AGENT_EXPORT_PROOF_OUTPUT_SCHEMA_NAME,
  AGENT_EXPORT_PROOF_TOOL_NAME,
  AGENT_FINAL_EXPORT_INPUT_SCHEMA_NAME,
  AGENT_FINAL_EXPORT_OUTPUT_SCHEMA_NAME,
  AGENT_FINAL_EXPORT_TOOL_NAME,
  agentExportProofRequestSchema,
  agentFinalExportRequestSchema,
  buildAgentExportProof,
  buildAgentFinalExport,
} from './agent/safety/agentExportProofTool';
import {
  applyBasicToneCommandToLiveEditor,
  dryRunBasicToneCommandInLiveEditor,
} from './agent/session/agentLiveBasicTone';
import {
  AGENT_HISTORY_ROLLBACK_INPUT_SCHEMA_NAME,
  AGENT_HISTORY_ROLLBACK_OUTPUT_SCHEMA_NAME,
  AGENT_HISTORY_ROLLBACK_TOOL_NAME,
  agentHistoryRollbackRequestSchema,
  rollbackAgentSessionHistory,
} from './agent/session/agentSessionHistory';
import {
  AGENT_ADJUSTMENTS_APPLY_INPUT_SCHEMA_NAME,
  AGENT_ADJUSTMENTS_APPLY_OUTPUT_SCHEMA_NAME,
  AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
  AGENT_ADJUSTMENTS_DRY_RUN_INPUT_SCHEMA_NAME,
  AGENT_ADJUSTMENTS_DRY_RUN_OUTPUT_SCHEMA_NAME,
  AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME,
  agentAdjustmentsApplyRequestSchema,
  agentAdjustmentsDryRunRequestSchema,
  applyAgentGlobalAdjustments,
  dryRunAgentGlobalAdjustments,
} from './agent/tools/agentAdjustmentApplyTool';
import {
  AGENT_COLOR_APPLY_INPUT_SCHEMA_NAME,
  AGENT_COLOR_APPLY_OUTPUT_SCHEMA_NAME,
  AGENT_COLOR_APPLY_TOOL_NAME,
  agentColorApplyRequestSchema,
  applyAgentColor,
} from './agent/tools/agentColorApplyTool';
import {
  AGENT_CURVE_LEVELS_APPLY_INPUT_SCHEMA_NAME,
  AGENT_CURVE_LEVELS_APPLY_OUTPUT_SCHEMA_NAME,
  AGENT_CURVE_LEVELS_APPLY_TOOL_NAME,
  agentCurveLevelsApplyRequestSchema,
  applyAgentCurveLevels,
} from './agent/tools/agentCurveLevelsApplyTool';
import {
  AGENT_DETAIL_EFFECTS_APPLY_INPUT_SCHEMA_NAME,
  AGENT_DETAIL_EFFECTS_APPLY_OUTPUT_SCHEMA_NAME,
  AGENT_DETAIL_EFFECTS_APPLY_TOOL_NAME,
  agentDetailEffectsApplyRequestSchema,
  applyAgentDetailEffects,
} from './agent/tools/agentDetailEffectsApplyTool';
import {
  AGENT_GEOMETRY_APPLY_INPUT_SCHEMA_NAME,
  AGENT_GEOMETRY_APPLY_OUTPUT_SCHEMA_NAME,
  AGENT_GEOMETRY_APPLY_TOOL_NAME,
  agentGeometryApplyRequestSchema,
  applyAgentGeometry,
} from './agent/tools/agentGeometryApplyTool';
import {
  AGENT_LENS_PROFILE_APPLY_INPUT_SCHEMA_NAME,
  AGENT_LENS_PROFILE_APPLY_OUTPUT_SCHEMA_NAME,
  AGENT_LENS_PROFILE_APPLY_TOOL_NAME,
  agentLensProfileApplyRequestSchema,
  applyAgentLensProfile,
} from './agent/tools/agentLensProfileApplyTool';
import {
  AGENT_RETOUCH_APPLY_INPUT_SCHEMA_NAME,
  AGENT_RETOUCH_APPLY_OUTPUT_SCHEMA_NAME,
  AGENT_RETOUCH_APPLY_TOOL_NAME,
  agentRetouchApplyRequestSchema,
  applyAgentRetouch,
} from './agent/tools/agentRetouchApplyTool';
import {
  AGENT_TONE_ADJUSTMENT_APPLY_INPUT_SCHEMA_NAME,
  AGENT_TONE_ADJUSTMENT_APPLY_OUTPUT_SCHEMA_NAME,
  AGENT_TONE_ADJUSTMENT_APPLY_TOOL_NAME,
  AGENT_TONE_ADJUSTMENT_DRY_RUN_INPUT_SCHEMA_NAME,
  AGENT_TONE_ADJUSTMENT_DRY_RUN_OUTPUT_SCHEMA_NAME,
  AGENT_TONE_ADJUSTMENT_DRY_RUN_TOOL_NAME,
  agentToneAdjustmentApplyRequestSchema,
  agentToneAdjustmentDryRunRequestSchema,
  applyAgentToneAdjustment,
  dryRunAgentToneAdjustment,
} from './agent/tools/agentToneAdjustmentTool';
import { AI_APP_SERVER_TOOL_ROUTES } from './ai/aiAppServerToolRoutes';
import { COMPUTATIONAL_MERGE_APP_SERVER_ROUTES } from './computational-merge/computationalMergeAppServerRoutes';
import { DETAIL_APP_SERVER_ROUTES } from './detail/detailAppServerRoutes';
import { FILM_LOOK_APP_SERVER_ROUTE_MANIFEST } from './film-look/filmLookAppServerRoutes';
import {
  dispatchNegativeLabAgentAppServerTool,
  NEGATIVE_LAB_AGENT_APPLY_TOOL_NAME,
  NEGATIVE_LAB_AGENT_PREVIEW_TOOL_NAME,
} from './negative-lab/app-server/negativeLabAgentAppServerToolDispatch';
import {
  buildNegativeLabAgentQcProofReadOnly,
  inspectNegativeLabAgentReadOnly,
  NEGATIVE_LAB_AGENT_CONVERSION_PLAN_TOOL_NAME,
  NEGATIVE_LAB_AGENT_INSPECT_TOOL_NAME,
  NEGATIVE_LAB_AGENT_QC_PROOF_TOOL_NAME,
  NEGATIVE_LAB_AGENT_READ_ONLY_TOOL_NAMES,
  NEGATIVE_LAB_AGENT_ROLL_NORMALIZATION_PLAN_TOOL_NAME,
  NEGATIVE_LAB_AGENT_STOCK_FAMILY_PLAN_TOOL_NAME,
  negativeLabAgentConversionPlanRequestSchema,
  negativeLabAgentInspectRequestSchema,
  negativeLabAgentQcProofRequestSchema,
  negativeLabAgentRollNormalizationPlanRequestSchema,
  negativeLabAgentStockFamilyPlanRequestSchema,
  planNegativeLabAgentConversionReadOnly,
  planNegativeLabAgentRollNormalizationReadOnly,
  planNegativeLabAgentStockFamilyReadOnly,
} from './negative-lab/app-server/negativeLabAgentReadOnlyAppServerTools';
import { NEGATIVE_LAB_APP_SERVER_ROUTE_MANIFEST } from './negative-lab/app-server/negativeLabAppServerRoutes';
import { ToneColorAppServerRouteStatus, ToneColorAppServerToolName } from './toneColorAppServerRouteIds';
import { TONE_COLOR_APP_SERVER_ROUTES } from './toneColorAppServerRoutes';

export const RAW_ENGINE_APP_SERVER_HOST_MANIFEST = rawEngineAppServerHostManifestSchema.parse({
  protocol: RawEngineAppServerProtocol.CodexAppServer,
  schemaVersion: 1,
  tools: [
    {
      inputSchemaName: 'RawEngineAppServerHealthRequestV1',
      mutates: false,
      outputSchemaName: 'RawEngineAppServerHealthResponseV1',
      toolKind: RawEngineAppServerToolKind.Read,
      toolName: RawEngineAppServerHostToolName.Health,
    },
    {
      inputSchemaName: 'RawEngineAppServerCapabilitiesRequestV1',
      mutates: false,
      outputSchemaName: 'RawEngineAppServerCapabilitiesResponseV1',
      toolKind: RawEngineAppServerToolKind.Read,
      toolName: RawEngineAppServerHostToolName.Capabilities,
    },
    {
      inputSchemaName: 'RawEngineAppServerRouteCatalogRequestV1',
      mutates: false,
      outputSchemaName: 'RawEngineAppServerRouteCatalogResponseV1',
      toolKind: RawEngineAppServerToolKind.Read,
      toolName: RawEngineAppServerHostToolName.RouteCatalog,
    },
    {
      inputSchemaName: 'RawEngineAppServerToolDispatchRequestV1',
      mutates: true,
      outputSchemaName: 'RawEngineAppServerToolDispatchResponseV1',
      toolKind: RawEngineAppServerToolKind.Command,
      toolName: RawEngineAppServerHostToolName.DispatchTool,
    },
  ],
  transport: RawEngineAppServerTransport.StdioJsonl,
});

export const createRawEngineAppServerLifecycleState = ({
  connectionId,
}: {
  connectionId: string;
}): RawEngineAppServerLifecycleState =>
  rawEngineAppServerLifecycleStateSchema.parse({
    clientInfo: null,
    connectionId,
    initializedAtIso: null,
    phase: RawEngineAppServerLifecyclePhase.Created,
    schemaVersion: 1,
    stoppedAtIso: null,
    transport: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.transport,
  });

export const initializeRawEngineAppServerLifecycle = ({
  clientInfo,
  state,
  timestampIso,
}: {
  clientInfo: RawEngineAppServerClientInfo;
  state: RawEngineAppServerLifecycleState;
  timestampIso: string;
}): RawEngineAppServerLifecycleState => {
  if (state.phase !== RawEngineAppServerLifecyclePhase.Created) {
    throw new Error(`RawEngine app-server lifecycle cannot initialize from ${state.phase}.`);
  }

  return rawEngineAppServerLifecycleStateSchema.parse({
    ...state,
    clientInfo,
    initializedAtIso: timestampIso,
    phase: RawEngineAppServerLifecyclePhase.Initialized,
  });
};

export const stopRawEngineAppServerLifecycle = ({
  state,
  timestampIso,
}: {
  state: RawEngineAppServerLifecycleState;
  timestampIso: string;
}): RawEngineAppServerLifecycleState => {
  if (state.phase === RawEngineAppServerLifecyclePhase.Created) {
    throw new Error('RawEngine app-server lifecycle cannot stop before initialize.');
  }

  return rawEngineAppServerLifecycleStateSchema.parse({
    ...state,
    phase: RawEngineAppServerLifecyclePhase.Stopped,
    stoppedAtIso: timestampIso,
  });
};

export const assertRawEngineAppServerLifecycleReady = (state: RawEngineAppServerLifecycleState): void => {
  if (state.phase !== RawEngineAppServerLifecyclePhase.Initialized) {
    throw new Error(`RawEngine app-server request rejected while lifecycle is ${state.phase}.`);
  }
};

const appendRawEngineAppServerSupervisorEvent = ({
  kind,
  phase,
  state,
  timestampIso,
}: {
  kind: RawEngineAppServerSupervisorState['auditEvents'][number]['kind'];
  phase: RawEngineAppServerSupervisorState['phase'];
  state: RawEngineAppServerSupervisorState;
  timestampIso: string;
}): RawEngineAppServerSupervisorState['auditEvents'] => [...state.auditEvents, { kind, phase, timestampIso }];

export const createRawEngineAppServerSupervisorState = ({
  command,
  supervisorId,
  timestampIso,
}: {
  command: string[];
  supervisorId: string;
  timestampIso: string;
}): RawEngineAppServerSupervisorState =>
  rawEngineAppServerSupervisorStateSchema.parse({
    auditEvents: [
      {
        kind: RawEngineAppServerSupervisorEventKind.Created,
        phase: RawEngineAppServerSupervisorPhase.Idle,
        timestampIso,
      },
    ],
    cancellationRequestedAtIso: null,
    command,
    error: null,
    lastTransitionAtIso: timestampIso,
    phase: RawEngineAppServerSupervisorPhase.Idle,
    processId: null,
    schemaVersion: 1,
    startedAtIso: null,
    stoppedAtIso: null,
    supervisorId,
    transport: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.transport,
  });

export const startRawEngineAppServerSupervisor = ({
  processId,
  state,
  timestampIso,
}: {
  processId: number;
  state: RawEngineAppServerSupervisorState;
  timestampIso: string;
}): RawEngineAppServerSupervisorState => {
  if (
    state.phase !== RawEngineAppServerSupervisorPhase.Idle &&
    state.phase !== RawEngineAppServerSupervisorPhase.Stopped
  ) {
    throw new Error(`RawEngine app-server supervisor cannot start from ${state.phase}.`);
  }

  return rawEngineAppServerSupervisorStateSchema.parse({
    ...state,
    auditEvents: appendRawEngineAppServerSupervisorEvent({
      kind: RawEngineAppServerSupervisorEventKind.Start,
      phase: RawEngineAppServerSupervisorPhase.Starting,
      state,
      timestampIso,
    }),
    error: null,
    lastTransitionAtIso: timestampIso,
    phase: RawEngineAppServerSupervisorPhase.Starting,
    processId,
    startedAtIso: timestampIso,
    stoppedAtIso: null,
  });
};

export const markRawEngineAppServerSupervisorReady = ({
  state,
  timestampIso,
}: {
  state: RawEngineAppServerSupervisorState;
  timestampIso: string;
}): RawEngineAppServerSupervisorState => {
  if (state.phase !== RawEngineAppServerSupervisorPhase.Starting) {
    throw new Error(`RawEngine app-server supervisor cannot become ready from ${state.phase}.`);
  }

  return rawEngineAppServerSupervisorStateSchema.parse({
    ...state,
    auditEvents: appendRawEngineAppServerSupervisorEvent({
      kind: RawEngineAppServerSupervisorEventKind.Ready,
      phase: RawEngineAppServerSupervisorPhase.Running,
      state,
      timestampIso,
    }),
    lastTransitionAtIso: timestampIso,
    phase: RawEngineAppServerSupervisorPhase.Running,
  });
};

export const cancelRawEngineAppServerSupervisor = ({
  state,
  timestampIso,
}: {
  state: RawEngineAppServerSupervisorState;
  timestampIso: string;
}): RawEngineAppServerSupervisorState => {
  if (
    state.phase !== RawEngineAppServerSupervisorPhase.Running &&
    state.phase !== RawEngineAppServerSupervisorPhase.Starting
  ) {
    throw new Error(`RawEngine app-server supervisor cannot cancel from ${state.phase}.`);
  }

  return rawEngineAppServerSupervisorStateSchema.parse({
    ...state,
    auditEvents: appendRawEngineAppServerSupervisorEvent({
      kind: RawEngineAppServerSupervisorEventKind.Cancel,
      phase: RawEngineAppServerSupervisorPhase.Stopping,
      state,
      timestampIso,
    }),
    cancellationRequestedAtIso: timestampIso,
    lastTransitionAtIso: timestampIso,
    phase: RawEngineAppServerSupervisorPhase.Stopping,
  });
};

export const stopRawEngineAppServerSupervisor = ({
  state,
  timestampIso,
}: {
  state: RawEngineAppServerSupervisorState;
  timestampIso: string;
}): RawEngineAppServerSupervisorState => {
  if (
    state.phase !== RawEngineAppServerSupervisorPhase.Running &&
    state.phase !== RawEngineAppServerSupervisorPhase.Starting &&
    state.phase !== RawEngineAppServerSupervisorPhase.Stopping
  ) {
    throw new Error(`RawEngine app-server supervisor cannot stop from ${state.phase}.`);
  }

  return rawEngineAppServerSupervisorStateSchema.parse({
    ...state,
    auditEvents: appendRawEngineAppServerSupervisorEvent({
      kind: RawEngineAppServerSupervisorEventKind.Stop,
      phase: RawEngineAppServerSupervisorPhase.Stopped,
      state,
      timestampIso,
    }),
    lastTransitionAtIso: timestampIso,
    phase: RawEngineAppServerSupervisorPhase.Stopped,
    processId: null,
    stoppedAtIso: timestampIso,
  });
};

export const failRawEngineAppServerSupervisor = ({
  error,
  state,
  timestampIso,
}: {
  error: RawEngineAppServerStructuredError;
  state: RawEngineAppServerSupervisorState;
  timestampIso: string;
}): RawEngineAppServerSupervisorState => {
  const parsedError = rawEngineAppServerStructuredErrorSchema.parse(error);
  if (
    state.phase !== RawEngineAppServerSupervisorPhase.Starting &&
    state.phase !== RawEngineAppServerSupervisorPhase.Running &&
    state.phase !== RawEngineAppServerSupervisorPhase.Stopping
  ) {
    throw new Error(`RawEngine app-server supervisor cannot fail from ${state.phase}.`);
  }

  return rawEngineAppServerSupervisorStateSchema.parse({
    ...state,
    auditEvents: appendRawEngineAppServerSupervisorEvent({
      kind: RawEngineAppServerSupervisorEventKind.Fail,
      phase: RawEngineAppServerSupervisorPhase.Stopped,
      state,
      timestampIso,
    }),
    error: parsedError,
    lastTransitionAtIso: timestampIso,
    phase: RawEngineAppServerSupervisorPhase.Stopped,
    processId: null,
    stoppedAtIso: timestampIso,
  });
};

export const buildRawEngineAppServerLifecycleReplay = ({
  clientInfo,
  connectionId,
  createdAtIso,
  initializedAtIso,
  stoppedAtIso,
}: {
  clientInfo: RawEngineAppServerClientInfo;
  connectionId: string;
  createdAtIso: string;
  initializedAtIso: string;
  stoppedAtIso: string;
}): RawEngineAppServerLifecycleReplay => {
  const created = createRawEngineAppServerLifecycleState({ connectionId });
  const initialized = initializeRawEngineAppServerLifecycle({
    clientInfo,
    state: created,
    timestampIso: initializedAtIso,
  });
  assertRawEngineAppServerLifecycleReady(initialized);
  const stopped = stopRawEngineAppServerLifecycle({ state: initialized, timestampIso: stoppedAtIso });

  return rawEngineAppServerLifecycleReplaySchema.parse({
    connectionId,
    events: [
      { phase: created.phase, timestampIso: createdAtIso },
      { phase: initialized.phase, timestampIso: initializedAtIso },
      { phase: stopped.phase, timestampIso: stoppedAtIso },
    ],
    finalState: stopped,
    schemaVersion: 1,
  });
};

const uniqueSorted = (values: Iterable<string>): string[] => [...new Set(values)].sort((a, b) => a.localeCompare(b));

const aiRuntimeCheckScriptsForRoute = (route: (typeof AI_APP_SERVER_TOOL_ROUTES)[number]): string[] => {
  const checks = new Set<string>(['check:ai-app-server-routes']);

  if (route.toolCapability?.endsWith('_mask')) {
    checks.add('check:ai-mask-app-server-tool');
    checks.add('check:ai-mask-capabilities');
    checks.add('check:ai-people-masks');
    if (route.executionMode === 'apply_dry_run_plan') checks.add('check:ai-people-apply-plan');
  }

  if (route.toolCapability === 'denoise') {
    checks.add('check:ai-denoise-app-server-tool');
    checks.add('check:ai-denoise-runtime-apply');
  }

  return uniqueSorted(checks);
};

const filmLookRuntimeCheckScripts = ['check:film-look-app-server-routes'];
const negativeLabRuntimeCheckScripts = ['check:negative-lab-app-server-routes'];

const buildRouteCatalogEntry = ({
  commandName,
  family,
  inputSchemaNames,
  modes,
  outputSchemaNames,
  runtimeCheckScripts,
  toolNames,
}: {
  commandName: string;
  family: RawEngineAppServerRouteFamily;
  inputSchemaNames: Iterable<string>;
  modes: Iterable<RawEngineAppServerRouteModeValue>;
  outputSchemaNames: Iterable<string>;
  runtimeCheckScripts?: Iterable<string>;
  toolNames: Iterable<string>;
}): RawEngineAppServerRouteCatalogEntry =>
  rawEngineAppServerRouteCatalogEntrySchema.parse({
    commandName,
    family,
    inputSchemaNames: uniqueSorted(inputSchemaNames),
    modes: uniqueSorted(modes),
    outputSchemaNames: uniqueSorted(outputSchemaNames),
    runtimeCheckScripts: uniqueSorted(runtimeCheckScripts ?? []),
    toolNames: uniqueSorted(toolNames),
  });

export const buildRawEngineAppServerRouteCatalog = (): RawEngineAppServerRouteCatalogEntry[] => {
  const catalog: RawEngineAppServerRouteCatalogEntry[] = [];
  catalog.push(
    buildRouteCatalogEntry({
      commandName: AGENT_STATE_GET_TOOL_NAME,
      family: 'agent',
      inputSchemaNames: [AGENT_STATE_GET_INPUT_SCHEMA_NAME],
      modes: [RawEngineAppServerRouteMode.Read],
      outputSchemaNames: [AGENT_STATE_GET_OUTPUT_SCHEMA_NAME],
      runtimeCheckScripts: ['check:agent-readonly-tools'],
      toolNames: [AGENT_STATE_GET_TOOL_NAME],
    }),
    buildRouteCatalogEntry({
      commandName: AGENT_PREVIEW_RENDER_TOOL_NAME,
      family: 'agent',
      inputSchemaNames: [AGENT_PREVIEW_RENDER_INPUT_SCHEMA_NAME],
      modes: [RawEngineAppServerRouteMode.Read],
      outputSchemaNames: [AGENT_PREVIEW_RENDER_OUTPUT_SCHEMA_NAME],
      runtimeCheckScripts: ['check:agent-readonly-tools'],
      toolNames: [AGENT_PREVIEW_RENDER_TOOL_NAME],
    }),
    buildRouteCatalogEntry({
      commandName: RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME,
      family: 'agent',
      inputSchemaNames: [RAW_ENGINE_IMAGE_GET_PREVIEW_INPUT_SCHEMA_NAME],
      modes: [RawEngineAppServerRouteMode.Read],
      outputSchemaNames: [RAW_ENGINE_IMAGE_GET_PREVIEW_OUTPUT_SCHEMA_NAME],
      runtimeCheckScripts: ['check:agent-readonly-tools'],
      toolNames: [RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME],
    }),
    buildRouteCatalogEntry({
      commandName: AGENT_PREVIEW_COMPARE_TOOL_NAME,
      family: 'agent',
      inputSchemaNames: [AGENT_PREVIEW_COMPARE_INPUT_SCHEMA_NAME],
      modes: [RawEngineAppServerRouteMode.Read],
      outputSchemaNames: [AGENT_PREVIEW_COMPARE_OUTPUT_SCHEMA_NAME],
      runtimeCheckScripts: ['check:agent-preview-compare-loop'],
      toolNames: [AGENT_PREVIEW_COMPARE_TOOL_NAME],
    }),
    buildRouteCatalogEntry({
      commandName: AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME,
      family: 'agent',
      inputSchemaNames: [AGENT_ADJUSTMENTS_DRY_RUN_INPUT_SCHEMA_NAME],
      modes: [RawEngineAppServerRouteMode.DryRunCommand],
      outputSchemaNames: [AGENT_ADJUSTMENTS_DRY_RUN_OUTPUT_SCHEMA_NAME],
      runtimeCheckScripts: ['check:agent-adjustments-apply'],
      toolNames: [AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME],
    }),
    buildRouteCatalogEntry({
      commandName: AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
      family: 'agent',
      inputSchemaNames: [AGENT_ADJUSTMENTS_APPLY_INPUT_SCHEMA_NAME],
      modes: [RawEngineAppServerRouteMode.ApplyDryRunPlan],
      outputSchemaNames: [AGENT_ADJUSTMENTS_APPLY_OUTPUT_SCHEMA_NAME],
      runtimeCheckScripts: ['check:agent-adjustments-apply'],
      toolNames: [AGENT_ADJUSTMENTS_APPLY_TOOL_NAME],
    }),
    buildRouteCatalogEntry({
      commandName: AGENT_TONE_ADJUSTMENT_DRY_RUN_TOOL_NAME,
      family: 'agent',
      inputSchemaNames: [AGENT_TONE_ADJUSTMENT_DRY_RUN_INPUT_SCHEMA_NAME],
      modes: [RawEngineAppServerRouteMode.DryRunCommand],
      outputSchemaNames: [AGENT_TONE_ADJUSTMENT_DRY_RUN_OUTPUT_SCHEMA_NAME],
      runtimeCheckScripts: ['check:agent-tone-adjustment-tool'],
      toolNames: [AGENT_TONE_ADJUSTMENT_DRY_RUN_TOOL_NAME],
    }),
    buildRouteCatalogEntry({
      commandName: AGENT_TONE_ADJUSTMENT_APPLY_TOOL_NAME,
      family: 'agent',
      inputSchemaNames: [AGENT_TONE_ADJUSTMENT_APPLY_INPUT_SCHEMA_NAME],
      modes: [RawEngineAppServerRouteMode.ApplyDryRunPlan],
      outputSchemaNames: [AGENT_TONE_ADJUSTMENT_APPLY_OUTPUT_SCHEMA_NAME],
      runtimeCheckScripts: ['check:agent-tone-adjustment-tool'],
      toolNames: [AGENT_TONE_ADJUSTMENT_APPLY_TOOL_NAME],
    }),
    buildRouteCatalogEntry({
      commandName: AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME,
      family: 'agent',
      inputSchemaNames: [AGENT_CURRENT_IMAGE_PREVIEW_LOOP_INPUT_SCHEMA_NAME],
      modes: [RawEngineAppServerRouteMode.ApplyDryRunPlan],
      outputSchemaNames: [AGENT_CURRENT_IMAGE_PREVIEW_LOOP_OUTPUT_SCHEMA_NAME],
      runtimeCheckScripts: ['check:agent-selected-image-preview-loop'],
      toolNames: [AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME],
    }),
    buildRouteCatalogEntry({
      commandName: AGENT_CURRENT_IMAGE_PREVIEW_LOOP_APPLY_REVIEW_TOOL_NAME,
      family: 'agent',
      inputSchemaNames: [AGENT_CURRENT_IMAGE_PREVIEW_LOOP_APPLY_REVIEW_INPUT_SCHEMA_NAME],
      modes: [RawEngineAppServerRouteMode.ApplyDryRunPlan],
      outputSchemaNames: [AGENT_CURRENT_IMAGE_PREVIEW_LOOP_APPLY_REVIEW_OUTPUT_SCHEMA_NAME],
      runtimeCheckScripts: ['check:agent-selected-image-preview-loop'],
      toolNames: [AGENT_CURRENT_IMAGE_PREVIEW_LOOP_APPLY_REVIEW_TOOL_NAME],
    }),
    buildRouteCatalogEntry({
      commandName: AGENT_COLOR_APPLY_TOOL_NAME,
      family: 'agent',
      inputSchemaNames: [AGENT_COLOR_APPLY_INPUT_SCHEMA_NAME],
      modes: [RawEngineAppServerRouteMode.ApplyDryRunPlan],
      outputSchemaNames: [AGENT_COLOR_APPLY_OUTPUT_SCHEMA_NAME],
      runtimeCheckScripts: ['check:agent-color-apply'],
      toolNames: [AGENT_COLOR_APPLY_TOOL_NAME],
    }),
    buildRouteCatalogEntry({
      commandName: AGENT_CURVE_LEVELS_APPLY_TOOL_NAME,
      family: 'agent',
      inputSchemaNames: [AGENT_CURVE_LEVELS_APPLY_INPUT_SCHEMA_NAME],
      modes: [RawEngineAppServerRouteMode.ApplyDryRunPlan],
      outputSchemaNames: [AGENT_CURVE_LEVELS_APPLY_OUTPUT_SCHEMA_NAME],
      runtimeCheckScripts: ['check:agent-curve-levels-apply'],
      toolNames: [AGENT_CURVE_LEVELS_APPLY_TOOL_NAME],
    }),
    buildRouteCatalogEntry({
      commandName: AGENT_DETAIL_EFFECTS_APPLY_TOOL_NAME,
      family: 'agent',
      inputSchemaNames: [AGENT_DETAIL_EFFECTS_APPLY_INPUT_SCHEMA_NAME],
      modes: [RawEngineAppServerRouteMode.ApplyDryRunPlan],
      outputSchemaNames: [AGENT_DETAIL_EFFECTS_APPLY_OUTPUT_SCHEMA_NAME],
      runtimeCheckScripts: ['check:agent-detail-effects-apply'],
      toolNames: [AGENT_DETAIL_EFFECTS_APPLY_TOOL_NAME],
    }),
    buildRouteCatalogEntry({
      commandName: AGENT_HISTORY_ROLLBACK_TOOL_NAME,
      family: 'agent',
      inputSchemaNames: [AGENT_HISTORY_ROLLBACK_INPUT_SCHEMA_NAME],
      modes: [RawEngineAppServerRouteMode.ApplyDryRunPlan],
      outputSchemaNames: [AGENT_HISTORY_ROLLBACK_OUTPUT_SCHEMA_NAME],
      runtimeCheckScripts: ['check:agent-session-history-rollback'],
      toolNames: [AGENT_HISTORY_ROLLBACK_TOOL_NAME],
    }),
    buildRouteCatalogEntry({
      commandName: NEGATIVE_LAB_AGENT_PREVIEW_TOOL_NAME,
      family: 'negative_lab',
      inputSchemaNames: ['NegativeLabCommandEnvelopeV1'],
      modes: [RawEngineAppServerRouteMode.DryRunCommand],
      outputSchemaNames: ['NegativeLabDryRunResultV1'],
      runtimeCheckScripts: ['check:negative-lab-agent-apply-rollback', 'check:negative-lab-app-server-routes'],
      toolNames: [NEGATIVE_LAB_AGENT_PREVIEW_TOOL_NAME],
    }),
    buildRouteCatalogEntry({
      commandName: NEGATIVE_LAB_AGENT_APPLY_TOOL_NAME,
      family: 'negative_lab',
      inputSchemaNames: ['NegativeLabApplyPlanRequestV1'],
      modes: [RawEngineAppServerRouteMode.ApplyDryRunPlan],
      outputSchemaNames: ['NegativeLabApplyResultV1'],
      runtimeCheckScripts: ['check:negative-lab-agent-apply-rollback', 'check:negative-lab-app-server-routes'],
      toolNames: [NEGATIVE_LAB_AGENT_APPLY_TOOL_NAME],
    }),
    buildRouteCatalogEntry({
      commandName: NEGATIVE_LAB_AGENT_INSPECT_TOOL_NAME,
      family: 'negative_lab',
      inputSchemaNames: ['NegativeLabAgentInspectRequestV1'],
      modes: [RawEngineAppServerRouteMode.Read],
      outputSchemaNames: ['NegativeLabAgentInspectResponseV1'],
      runtimeCheckScripts: [
        'bun tests/integration/checks/negative-lab/check-negative-lab-agent-readonly-tools.ts',
        'check:negative-lab-app-server-routes',
      ],
      toolNames: [NEGATIVE_LAB_AGENT_INSPECT_TOOL_NAME],
    }),
    buildRouteCatalogEntry({
      commandName: NEGATIVE_LAB_AGENT_CONVERSION_PLAN_TOOL_NAME,
      family: 'negative_lab',
      inputSchemaNames: ['NegativeLabAgentConversionPlanRequestV1'],
      modes: [RawEngineAppServerRouteMode.Read],
      outputSchemaNames: ['NegativeLabAgentConversionPlanResponseV1'],
      runtimeCheckScripts: [
        'bun tests/integration/checks/negative-lab/check-negative-lab-agent-readonly-tools.ts',
        'check:negative-lab-app-server-routes',
      ],
      toolNames: [NEGATIVE_LAB_AGENT_CONVERSION_PLAN_TOOL_NAME],
    }),
    buildRouteCatalogEntry({
      commandName: NEGATIVE_LAB_AGENT_ROLL_NORMALIZATION_PLAN_TOOL_NAME,
      family: 'negative_lab',
      inputSchemaNames: ['NegativeLabAgentRollNormalizationPlanRequestV1'],
      modes: [RawEngineAppServerRouteMode.Read],
      outputSchemaNames: ['NegativeLabAgentRollNormalizationPlanResponseV1'],
      runtimeCheckScripts: [
        'bun tests/integration/checks/negative-lab/check-negative-lab-agent-readonly-tools.ts',
        'check:negative-lab-app-server-routes',
      ],
      toolNames: [NEGATIVE_LAB_AGENT_ROLL_NORMALIZATION_PLAN_TOOL_NAME],
    }),
    buildRouteCatalogEntry({
      commandName: NEGATIVE_LAB_AGENT_QC_PROOF_TOOL_NAME,
      family: 'negative_lab',
      inputSchemaNames: ['NegativeLabAgentQcProofRequestV1'],
      modes: [RawEngineAppServerRouteMode.Read],
      outputSchemaNames: ['NegativeLabAgentQcProofResponseV1'],
      runtimeCheckScripts: [
        'bun tests/integration/checks/negative-lab/check-negative-lab-agent-readonly-tools.ts',
        'check:negative-lab-app-server-routes',
      ],
      toolNames: [NEGATIVE_LAB_AGENT_QC_PROOF_TOOL_NAME],
    }),
    buildRouteCatalogEntry({
      commandName: NEGATIVE_LAB_AGENT_STOCK_FAMILY_PLAN_TOOL_NAME,
      family: 'negative_lab',
      inputSchemaNames: ['NegativeLabAgentStockFamilyPlanRequestV1'],
      modes: [RawEngineAppServerRouteMode.Read],
      outputSchemaNames: ['NegativeLabAgentStockFamilyPlanResponseV1'],
      runtimeCheckScripts: [
        'bun tests/integration/checks/negative-lab/check-negative-lab-agent-readonly-tools.ts',
        'check:negative-lab-app-server-routes',
      ],
      toolNames: [NEGATIVE_LAB_AGENT_STOCK_FAMILY_PLAN_TOOL_NAME],
    }),
    buildRouteCatalogEntry({
      commandName: AGENT_GEOMETRY_APPLY_TOOL_NAME,
      family: 'agent',
      inputSchemaNames: [AGENT_GEOMETRY_APPLY_INPUT_SCHEMA_NAME],
      modes: [RawEngineAppServerRouteMode.ApplyDryRunPlan],
      outputSchemaNames: [AGENT_GEOMETRY_APPLY_OUTPUT_SCHEMA_NAME],
      runtimeCheckScripts: ['check:agent-geometry-apply'],
      toolNames: [AGENT_GEOMETRY_APPLY_TOOL_NAME],
    }),
    buildRouteCatalogEntry({
      commandName: AGENT_LENS_PROFILE_APPLY_TOOL_NAME,
      family: 'agent',
      inputSchemaNames: [AGENT_LENS_PROFILE_APPLY_INPUT_SCHEMA_NAME],
      modes: [RawEngineAppServerRouteMode.ApplyDryRunPlan],
      outputSchemaNames: [AGENT_LENS_PROFILE_APPLY_OUTPUT_SCHEMA_NAME],
      runtimeCheckScripts: ['check:agent-lens-profile-apply'],
      toolNames: [AGENT_LENS_PROFILE_APPLY_TOOL_NAME],
    }),
    buildRouteCatalogEntry({
      commandName: AGENT_LAYER_CREATE_TOOL_NAME,
      family: 'agent',
      inputSchemaNames: [AGENT_LAYER_CREATE_INPUT_SCHEMA_NAME],
      modes: [RawEngineAppServerRouteMode.ApplyDryRunPlan],
      outputSchemaNames: [AGENT_LAYER_CREATE_OUTPUT_SCHEMA_NAME],
      runtimeCheckScripts: ['check:agent-layer-mask-tools'],
      toolNames: [AGENT_LAYER_CREATE_TOOL_NAME],
    }),
    buildRouteCatalogEntry({
      commandName: AGENT_MASK_CREATE_OR_UPDATE_TOOL_NAME,
      family: 'agent',
      inputSchemaNames: [AGENT_MASK_CREATE_OR_UPDATE_INPUT_SCHEMA_NAME],
      modes: [RawEngineAppServerRouteMode.ApplyDryRunPlan],
      outputSchemaNames: [AGENT_MASK_CREATE_OR_UPDATE_OUTPUT_SCHEMA_NAME],
      runtimeCheckScripts: ['check:agent-layer-mask-tools'],
      toolNames: [AGENT_MASK_CREATE_OR_UPDATE_TOOL_NAME],
    }),
    buildRouteCatalogEntry({
      commandName: AGENT_LAYER_SCOPED_ADJUST_TOOL_NAME,
      family: 'agent',
      inputSchemaNames: [AGENT_LAYER_SCOPED_ADJUST_INPUT_SCHEMA_NAME],
      modes: [RawEngineAppServerRouteMode.ApplyDryRunPlan],
      outputSchemaNames: [AGENT_LAYER_SCOPED_ADJUST_OUTPUT_SCHEMA_NAME],
      runtimeCheckScripts: ['check:agent-layer-mask-tools'],
      toolNames: [AGENT_LAYER_SCOPED_ADJUST_TOOL_NAME],
    }),
    buildRouteCatalogEntry({
      commandName: AGENT_OBJECT_SELECTION_APPLY_TOOL_NAME,
      family: 'agent',
      inputSchemaNames: [AGENT_OBJECT_SELECTION_APPLY_INPUT_SCHEMA_NAME],
      modes: [RawEngineAppServerRouteMode.ApplyDryRunPlan],
      outputSchemaNames: [AGENT_OBJECT_SELECTION_APPLY_OUTPUT_SCHEMA_NAME],
      runtimeCheckScripts: ['check:agent-object-selection-apply'],
      toolNames: [AGENT_OBJECT_SELECTION_APPLY_TOOL_NAME],
    }),
    buildRouteCatalogEntry({
      commandName: AGENT_RETOUCH_APPLY_TOOL_NAME,
      family: 'agent',
      inputSchemaNames: [AGENT_RETOUCH_APPLY_INPUT_SCHEMA_NAME],
      modes: [RawEngineAppServerRouteMode.ApplyDryRunPlan],
      outputSchemaNames: [AGENT_RETOUCH_APPLY_OUTPUT_SCHEMA_NAME],
      runtimeCheckScripts: ['check:agent-retouch-apply'],
      toolNames: [AGENT_RETOUCH_APPLY_TOOL_NAME],
    }),
    buildRouteCatalogEntry({
      commandName: AGENT_EXPORT_PROOF_TOOL_NAME,
      family: 'agent',
      inputSchemaNames: [AGENT_EXPORT_PROOF_INPUT_SCHEMA_NAME],
      modes: [RawEngineAppServerRouteMode.Read],
      outputSchemaNames: [AGENT_EXPORT_PROOF_OUTPUT_SCHEMA_NAME],
      runtimeCheckScripts: ['check:agent-export-proof'],
      toolNames: [AGENT_EXPORT_PROOF_TOOL_NAME],
    }),
    buildRouteCatalogEntry({
      commandName: AGENT_FINAL_EXPORT_TOOL_NAME,
      family: 'agent',
      inputSchemaNames: [AGENT_FINAL_EXPORT_INPUT_SCHEMA_NAME],
      modes: [RawEngineAppServerRouteMode.ApplyDryRunPlan],
      outputSchemaNames: [AGENT_FINAL_EXPORT_OUTPUT_SCHEMA_NAME],
      runtimeCheckScripts: ['check:agent-export-proof', 'check:agent-selected-image-export-output'],
      toolNames: [AGENT_FINAL_EXPORT_TOOL_NAME],
    }),
  );

  const mappedToneColorRoutes = TONE_COLOR_APP_SERVER_ROUTES.filter(
    (route) => route.status === ToneColorAppServerRouteStatus.Mapped,
  );
  const toneColorCommandNames = uniqueSorted(mappedToneColorRoutes.map((route) => route.commandType));
  for (const commandName of toneColorCommandNames) {
    const routes = mappedToneColorRoutes.filter((route) => route.commandType === commandName);
    catalog.push(
      buildRouteCatalogEntry({
        commandName,
        family: 'tone_color',
        inputSchemaNames: routes.map((route) => route.inputSchemaName),
        modes: routes.map((route) => route.executionMode),
        outputSchemaNames: routes.map((route) => route.outputSchemaName),
        runtimeCheckScripts: routes.map((route) => route.runtimeCheckScript),
        toolNames: routes.map((route) => route.toolName),
      }),
    );
  }

  const computationalCommandNames = uniqueSorted(
    COMPUTATIONAL_MERGE_APP_SERVER_ROUTES.map((route) => route.commandType),
  );
  for (const commandName of computationalCommandNames) {
    const routes = COMPUTATIONAL_MERGE_APP_SERVER_ROUTES.filter((route) => route.commandType === commandName);
    catalog.push(
      buildRouteCatalogEntry({
        commandName,
        family: 'computational_merge',
        inputSchemaNames: routes.map((route) => route.inputSchemaName),
        modes: routes.map((route) => route.executionMode),
        outputSchemaNames: routes.map((route) => route.outputSchemaName),
        runtimeCheckScripts: [
          ...routes.map((route) => route.runtimeCheckScript),
          'check:computational-merge-route-e2e',
        ],
        toolNames: routes.map((route) => route.toolName),
      }),
    );
  }

  for (const route of FILM_LOOK_APP_SERVER_ROUTE_MANIFEST.routes) {
    catalog.push(
      buildRouteCatalogEntry({
        commandName: route.commandName,
        family: 'film_look',
        inputSchemaNames: [route.inputSchemaName],
        modes: [RawEngineAppServerRouteMode.HostCommand],
        outputSchemaNames: [route.outputSchemaName],
        runtimeCheckScripts: filmLookRuntimeCheckScripts,
        toolNames: [route.commandName],
      }),
    );
  }

  for (const route of NEGATIVE_LAB_APP_SERVER_ROUTE_MANIFEST.routes) {
    catalog.push(
      buildRouteCatalogEntry({
        commandName: route.commandName,
        family: 'negative_lab',
        inputSchemaNames: [route.inputSchemaName],
        modes: [RawEngineAppServerRouteMode.HostCommand],
        outputSchemaNames: [route.outputSchemaName],
        runtimeCheckScripts: negativeLabRuntimeCheckScripts,
        toolNames: [route.commandName],
      }),
    );
  }

  for (const route of AI_APP_SERVER_TOOL_ROUTES.filter((candidate) => candidate.status === 'mapped')) {
    catalog.push(
      buildRouteCatalogEntry({
        commandName: route.sourceOperation,
        family: 'ai',
        inputSchemaNames: route.commandSchemaName === undefined ? ['AiToolRouteCommandV1'] : [route.commandSchemaName],
        modes: route.executionMode === undefined ? [RawEngineAppServerRouteMode.MappedInvoke] : [route.executionMode],
        outputSchemaNames: route.outputSchemaName === undefined ? ['AiToolRouteResultV1'] : [route.outputSchemaName],
        runtimeCheckScripts: aiRuntimeCheckScriptsForRoute(route),
        toolNames: route.appServerToolName === undefined ? [route.sourceOperation] : [route.appServerToolName],
      }),
    );
  }

  for (const route of DETAIL_APP_SERVER_ROUTES) {
    catalog.push(
      buildRouteCatalogEntry({
        commandName: route.commandType,
        family: 'detail',
        inputSchemaNames: [route.inputSchemaName],
        modes: [route.executionMode],
        outputSchemaNames: [route.outputSchemaName],
        runtimeCheckScripts: [route.runtimeCheckScript],
        toolNames: [route.toolName],
      }),
    );
  }

  return catalog.sort((left, right) =>
    `${left.family}:${left.commandName}`.localeCompare(`${right.family}:${right.commandName}`),
  );
};

export const buildRawEngineAppServerHealthResponse = ({
  requestId,
}: RawEngineAppServerHealthRequest): RawEngineAppServerHealthResponse =>
  rawEngineAppServerHealthResponseSchema.parse({
    manifestToolCount: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.tools.length,
    requestId,
    runtime: AgentRuntimeId.AppServer,
    status: RawEngineAppServerResponseStatus.Ok,
    transport: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.transport,
  });

export const buildRawEngineAppServerCapabilitiesResponse = ({
  requestId,
}: RawEngineAppServerCapabilitiesRequest): RawEngineAppServerCapabilitiesResponse =>
  rawEngineAppServerCapabilitiesResponseSchema.parse({
    requestId,
    runtime: AgentRuntimeId.AppServer,
    status: RawEngineAppServerResponseStatus.Ok,
    tools: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.tools,
    transport: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.transport,
  });

export const buildRawEngineAppServerRouteCatalogResponse = ({
  requestId,
}: RawEngineAppServerRouteCatalogRequest): RawEngineAppServerRouteCatalogResponse =>
  rawEngineAppServerRouteCatalogResponseSchema.parse({
    requestId,
    routes: buildRawEngineAppServerRouteCatalog(),
    runtime: AgentRuntimeId.AppServer,
    status: RawEngineAppServerResponseStatus.Ok,
    transport: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.transport,
  });

const getCommandType = (command: unknown): string | undefined => {
  if (typeof command !== 'object' || command === null) return undefined;
  const record = command as Record<string, unknown>;
  const nestedCommand = record['command'];
  const commandType =
    typeof record['commandType'] === 'string'
      ? record['commandType']
      : typeof nestedCommand === 'object' && nestedCommand !== null
        ? (nestedCommand as Record<string, unknown>)['commandType']
        : undefined;
  return typeof commandType === 'string' && commandType.trim().length > 0 ? commandType : undefined;
};

const COMPUTATIONAL_MERGE_COMMAND_TYPE_TO_FAMILY = new Map<string, string>([
  ['computationalMerge.createFocusStack', 'focus_stack'],
  ['computationalMerge.createHdr', 'hdr'],
  ['computationalMerge.createPanorama', 'panorama'],
  ['computationalMerge.createSuperResolution', 'super_resolution'],
]);

const localBridgeToolMatchesCommand = ({
  commandType,
  dryRun,
  runtimeToolName,
}: {
  commandType: string | undefined;
  dryRun: boolean | undefined;
  runtimeToolName: string;
}): boolean => {
  if (runtimeToolName === 'agent.project_metadata.query') {
    return commandType === RawEngineLocalAppServerCommandType.ProjectMetadataQuery;
  }
  if (runtimeToolName === 'agent.selected_images.query') {
    return commandType === RawEngineLocalAppServerCommandType.SelectedImagesQuery;
  }
  if (runtimeToolName === 'agent.image_metadata.query') {
    return commandType === RawEngineLocalAppServerCommandType.ImageMetadataQuery;
  }
  if (runtimeToolName === 'agent.editor_state.query') {
    return commandType === RawEngineLocalAppServerCommandType.EditorStateQuery;
  }
  if (runtimeToolName === 'tonecolor.dry_run_command') {
    return commandType?.startsWith('toneColor.') === true && dryRun === true;
  }
  if (runtimeToolName === 'tonecolor.apply_command') {
    return commandType?.startsWith('toneColor.') === true && dryRun === false;
  }
  if (runtimeToolName === 'layermask.dry_run_command') {
    return commandType?.startsWith('layerMask.') === true && dryRun === true;
  }
  if (runtimeToolName === 'layermask.apply_command') {
    return commandType?.startsWith('layerMask.') === true && dryRun === false;
  }
  if (runtimeToolName === 'ai.mask.dry_run_subject')
    return commandType === 'ai.mask.generateSubject' && dryRun === true;
  if (runtimeToolName === 'ai.mask.apply_subject') return commandType === 'ai.mask.applySubject' && dryRun === false;
  if (runtimeToolName === 'ai.enhancement.dry_run_command') {
    return commandType === 'ai.enhancement.dryRun' && dryRun === true;
  }
  if (runtimeToolName === 'ai.enhancement.apply_command') {
    return commandType === 'ai.enhancement.apply' && dryRun === false;
  }
  if (runtimeToolName.startsWith('computationalmerge.')) {
    const family = commandType === undefined ? undefined : COMPUTATIONAL_MERGE_COMMAND_TYPE_TO_FAMILY.get(commandType);
    if (family === undefined || !runtimeToolName.startsWith(`computationalmerge.${family}.`)) return false;
    if (runtimeToolName.endsWith('.dry_run_command')) return dryRun === true;
    if (runtimeToolName.endsWith('.apply_command')) return dryRun === false;
    if (runtimeToolName.endsWith('.open_derived_source')) return dryRun === false;
  }
  return false;
};

const getDryRunFlag = (command: unknown): boolean | undefined => {
  if (typeof command !== 'object' || command === null) return undefined;
  const record = command as Record<string, unknown>;
  const nestedCommand = record['command'];
  const dryRun =
    typeof record['dryRun'] === 'boolean'
      ? record['dryRun']
      : typeof nestedCommand === 'object' && nestedCommand !== null
        ? (nestedCommand as Record<string, unknown>)['dryRun']
        : undefined;
  return typeof dryRun === 'boolean' ? dryRun : undefined;
};

const getApprovalRequirement = (command: unknown): unknown => {
  if (typeof command !== 'object' || command === null || !('approval' in command)) return undefined;
  return command.approval;
};

const mergeRawEngineToolRegistries = (...registries: RawEngineToolRegistryV1[]): RawEngineToolRegistryV1 =>
  rawEngineToolRegistryV1Schema.parse({
    schemaVersion: 1,
    tools: [...new Map(registries.flatMap((registry) => registry.tools).map((tool) => [tool.toolName, tool])).values()],
  });

const buildRawEngineAppServerToolCallValidationRejection = ({
  activeRegistry,
  request,
}: {
  activeRegistry: RawEngineToolRegistryV1;
  request: RawEngineAppServerToolDispatchRequest;
}): RawEngineAppServerToolDispatchResponse | null => {
  const declaredToolName = request.toolCall?.toolName ?? request.runtimeToolName;
  const toolDefinition = activeRegistry.tools.find((tool) => tool.toolName === declaredToolName);
  if (
    request.toolCall === undefined &&
    (declaredToolName.startsWith('rawengine.agent.') || declaredToolName === RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME)
  ) {
    return null;
  }

  const fallbackApproval = {
    approvalClass: toolDefinition?.approvalClass ?? 'safe_read',
    reason: 'Host validation fallback for malformed app-server command arguments.',
    state: toolDefinition?.mutates ? 'pending' : 'not_required',
  };
  const validation = rawEngineAppServerToolCallValidationV1Schema.safeParse({
    registry: activeRegistry,
    schemaVersion: 1,
    toolCall: {
      approval: request.toolCall?.approval ?? getApprovalRequirement(request.arguments) ?? fallbackApproval,
      arguments: request.arguments,
      dryRun: request.toolCall?.dryRun ?? getDryRunFlag(request.arguments) ?? Boolean(toolDefinition?.requiresDryRun),
      inputSchemaName: request.toolCall?.inputSchemaName ?? toolDefinition?.inputSchemaName ?? 'CommandEnvelopeV1',
      ...(request.toolCall?.itemId === undefined ? {} : { itemId: request.toolCall.itemId }),
      jsonRpcRequestId: request.toolCall?.jsonRpcRequestId ?? request.requestId,
      protocol: 'codex_app_server_json_rpc',
      schemaVersion: 1,
      threadId: request.toolCall?.threadId ?? `thread_${request.requestId}`,
      toolKind: request.toolCall?.toolKind ?? toolDefinition?.toolKind ?? 'apply',
      toolName: declaredToolName,
      transport: 'stdio',
      turnId: request.toolCall?.turnId ?? `turn_${request.requestId}`,
    },
  });

  if (validation.success) return null;

  return rawEngineAppServerToolDispatchResponseSchema.parse({
    commandType: getCommandType(request.arguments) ?? request.runtimeToolName,
    dispatchStatus: 'rejected',
    message: `App-server tool call validation rejected ${request.runtimeToolName}.`,
    requestId: request.requestId,
    runtime: AgentRuntimeId.AppServer,
    runtimeToolName: request.runtimeToolName,
    schemaIssues: validation.error.issues.map((issue) => ({
      message: issue.message,
      path: issue.path.map((part) => String(part)),
    })),
    status: RawEngineAppServerResponseStatus.Ok,
    transport: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.transport,
  });
};

const rejectToolDispatch = ({
  commandType,
  message,
  request,
}: {
  commandType?: string;
  message: string;
  request: RawEngineAppServerToolDispatchRequest;
}): RawEngineAppServerToolDispatchResponse =>
  rawEngineAppServerToolDispatchResponseSchema.parse({
    ...(commandType === undefined ? {} : { commandType }),
    dispatchStatus: 'rejected',
    message,
    requestId: request.requestId,
    runtime: AgentRuntimeId.AppServer,
    runtimeToolName: request.runtimeToolName,
    status: RawEngineAppServerResponseStatus.Ok,
    transport: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.transport,
  });

const APPROVED_AGENT_APP_SERVER_TOOL_NAMES = new Set<string>([
  AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
  AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME,
  AGENT_TONE_ADJUSTMENT_APPLY_TOOL_NAME,
  AGENT_TONE_ADJUSTMENT_DRY_RUN_TOOL_NAME,
  AGENT_CURRENT_IMAGE_PREVIEW_LOOP_APPLY_REVIEW_TOOL_NAME,
  AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME,
  AGENT_COLOR_APPLY_TOOL_NAME,
  AGENT_CURVE_LEVELS_APPLY_TOOL_NAME,
  AGENT_DETAIL_EFFECTS_APPLY_TOOL_NAME,
  AGENT_EXPORT_PROOF_TOOL_NAME,
  AGENT_FINAL_EXPORT_TOOL_NAME,
  AGENT_GEOMETRY_APPLY_TOOL_NAME,
  AGENT_HISTORY_ROLLBACK_TOOL_NAME,
  AGENT_LAYER_CREATE_TOOL_NAME,
  AGENT_LAYER_SCOPED_ADJUST_TOOL_NAME,
  AGENT_LENS_PROFILE_APPLY_TOOL_NAME,
  AGENT_MASK_CREATE_OR_UPDATE_TOOL_NAME,
  AGENT_OBJECT_SELECTION_APPLY_TOOL_NAME,
  AGENT_PREVIEW_COMPARE_TOOL_NAME,
  AGENT_PREVIEW_RENDER_TOOL_NAME,
  AGENT_RETOUCH_APPLY_TOOL_NAME,
  AGENT_STATE_GET_TOOL_NAME,
  RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME,
  NEGATIVE_LAB_AGENT_APPLY_TOOL_NAME,
  ...NEGATIVE_LAB_AGENT_READ_ONLY_TOOL_NAMES,
  NEGATIVE_LAB_AGENT_PREVIEW_TOOL_NAME,
  ToneColorAppServerToolName.ApplyCommand,
  ToneColorAppServerToolName.DryRunCommand,
]);

const hasAgentSessionIntent = ({
  arguments: args,
  runtimeToolName,
}: RawEngineAppServerToolDispatchRequest): boolean => {
  if (runtimeToolName.startsWith('rawengine.agent.')) return true;
  if (typeof args !== 'object' || args === null) return false;
  const actor =
    'actor' in args && typeof args.actor === 'object' && args.actor !== null
      ? (args.actor as Record<string, unknown>)
      : null;
  return (
    ('sessionId' in args && typeof args.sessionId === 'string' && args.sessionId.trim().length > 0) ||
    ('operationId' in args && typeof args.operationId === 'string' && args.operationId.trim().length > 0) ||
    (actor !== null &&
      actor['id'] === 'rapidraw-ui' &&
      actor['kind'] === 'ui' &&
      typeof actor['sessionId'] === 'string' &&
      actor['sessionId'].trim().length > 0)
  );
};

export const isApprovedAgentAppServerToolName = (runtimeToolName: string): boolean =>
  APPROVED_AGENT_APP_SERVER_TOOL_NAMES.has(runtimeToolName);

const rawEngineAppServerLocalBridge = createRawEngineLocalAppServerBridge();

const validateDraftSessionForDispatch = (request: RawEngineAppServerToolDispatchRequest): string | null => {
  const draftSession = request.draftSession;
  if (draftSession === undefined) return null;
  if (!isApprovedAgentAppServerToolName(request.runtimeToolName)) {
    return 'Draft agent sessions can only dispatch approved typed agent app-server tools.';
  }
  if (draftSession.status !== 'active') return 'Draft agent session is cancelled.';

  const state = useEditorStore.getState();
  if (state.selectedImage === null) return 'Draft agent session requires a selected image.';
  if (state.selectedImage.path !== draftSession.selectedImagePath) {
    return 'Draft agent session selected image does not match the active editor image.';
  }
  const snapshot = buildAgentImageContextSnapshot();
  if (snapshot.initialPreview.recipeHash !== draftSession.parentRecipeHash) {
    return 'Draft agent session parent recipe hash is stale.';
  }
  if (draftSession.draftRevision !== state.historyIndex) {
    return 'Draft agent session revision does not match the active edit graph.';
  }
  return null;
};

const dispatchAgentAppServerTool = async (
  request: RawEngineAppServerToolDispatchRequest,
): Promise<RawEngineAppServerToolDispatchResponse | null> => {
  let result: unknown;

  switch (request.runtimeToolName) {
    case ToneColorAppServerToolName.DryRunCommand: {
      if (!hasAgentSessionIntent(request)) return null;
      const command = toneColorCommandEnvelopeV1Schema.parse(request.arguments);
      if (command.commandType !== 'toneColor.setBasicTone') return null;
      result = await dryRunBasicToneCommandInLiveEditor(command);
      break;
    }
    case ToneColorAppServerToolName.ApplyCommand: {
      if (!hasAgentSessionIntent(request)) return null;
      const command = toneColorCommandEnvelopeV1Schema.parse(request.arguments);
      if (command.commandType !== 'toneColor.setBasicTone') return null;
      result = await applyBasicToneCommandToLiveEditor(command);
      break;
    }
    case AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME:
      result = await dryRunAgentGlobalAdjustments(agentAdjustmentsDryRunRequestSchema.parse(request.arguments));
      break;
    case AGENT_ADJUSTMENTS_APPLY_TOOL_NAME:
      result = await applyAgentGlobalAdjustments(agentAdjustmentsApplyRequestSchema.parse(request.arguments));
      break;
    case AGENT_TONE_ADJUSTMENT_DRY_RUN_TOOL_NAME:
      result = await dryRunAgentToneAdjustment(agentToneAdjustmentDryRunRequestSchema.parse(request.arguments));
      break;
    case AGENT_TONE_ADJUSTMENT_APPLY_TOOL_NAME:
      result = await applyAgentToneAdjustment(agentToneAdjustmentApplyRequestSchema.parse(request.arguments));
      break;
    case AGENT_CURRENT_IMAGE_PREVIEW_LOOP_TOOL_NAME:
      result = await runAgentCurrentImagePreviewLoop(
        agentCurrentImagePreviewLoopRequestSchema.parse(request.arguments),
      );
      break;
    case AGENT_CURRENT_IMAGE_PREVIEW_LOOP_APPLY_REVIEW_TOOL_NAME:
      result = await applyAgentCurrentImagePreviewLoopReviewedEdit(
        agentCurrentImagePreviewLoopApplyReviewRequestSchema.parse(request.arguments),
      );
      break;
    case AGENT_COLOR_APPLY_TOOL_NAME:
      result = await applyAgentColor(agentColorApplyRequestSchema.parse(request.arguments));
      break;
    case AGENT_CURVE_LEVELS_APPLY_TOOL_NAME:
      result = await applyAgentCurveLevels(agentCurveLevelsApplyRequestSchema.parse(request.arguments));
      break;
    case AGENT_DETAIL_EFFECTS_APPLY_TOOL_NAME:
      result = await applyAgentDetailEffects(agentDetailEffectsApplyRequestSchema.parse(request.arguments));
      break;
    case AGENT_EXPORT_PROOF_TOOL_NAME:
      result = buildAgentExportProof(agentExportProofRequestSchema.parse(request.arguments));
      break;
    case AGENT_FINAL_EXPORT_TOOL_NAME:
      result = buildAgentFinalExport(agentFinalExportRequestSchema.parse(request.arguments));
      break;
    case AGENT_HISTORY_ROLLBACK_TOOL_NAME:
      result = rollbackAgentSessionHistory(agentHistoryRollbackRequestSchema.parse(request.arguments));
      break;
    case NEGATIVE_LAB_AGENT_PREVIEW_TOOL_NAME:
    case NEGATIVE_LAB_AGENT_APPLY_TOOL_NAME:
      result = dispatchNegativeLabAgentAppServerTool(request);
      break;
    case NEGATIVE_LAB_AGENT_INSPECT_TOOL_NAME:
      result = inspectNegativeLabAgentReadOnly(negativeLabAgentInspectRequestSchema.parse(request.arguments));
      break;
    case NEGATIVE_LAB_AGENT_CONVERSION_PLAN_TOOL_NAME:
      result = planNegativeLabAgentConversionReadOnly(
        negativeLabAgentConversionPlanRequestSchema.parse(request.arguments),
      );
      break;
    case NEGATIVE_LAB_AGENT_ROLL_NORMALIZATION_PLAN_TOOL_NAME:
      result = planNegativeLabAgentRollNormalizationReadOnly(
        negativeLabAgentRollNormalizationPlanRequestSchema.parse(request.arguments),
      );
      break;
    case NEGATIVE_LAB_AGENT_QC_PROOF_TOOL_NAME:
      result = buildNegativeLabAgentQcProofReadOnly(negativeLabAgentQcProofRequestSchema.parse(request.arguments));
      break;
    case NEGATIVE_LAB_AGENT_STOCK_FAMILY_PLAN_TOOL_NAME:
      result = planNegativeLabAgentStockFamilyReadOnly(
        negativeLabAgentStockFamilyPlanRequestSchema.parse(request.arguments),
      );
      break;
    case AGENT_GEOMETRY_APPLY_TOOL_NAME:
      result = await applyAgentGeometry(agentGeometryApplyRequestSchema.parse(request.arguments));
      break;
    case AGENT_LENS_PROFILE_APPLY_TOOL_NAME:
      result = await applyAgentLensProfile(agentLensProfileApplyRequestSchema.parse(request.arguments));
      break;
    case AGENT_LAYER_CREATE_TOOL_NAME:
      result = applyAgentLayerCreate(agentLayerCreateRequestSchema.parse(request.arguments));
      break;
    case AGENT_LAYER_SCOPED_ADJUST_TOOL_NAME:
      result = applyAgentLayerScopedAdjustments(agentLayerScopedAdjustRequestSchema.parse(request.arguments));
      break;
    case AGENT_MASK_CREATE_OR_UPDATE_TOOL_NAME:
      result = applyAgentBrushMaskCreateOrUpdate(agentMaskCreateOrUpdateRequestSchema.parse(request.arguments));
      break;
    case AGENT_OBJECT_SELECTION_APPLY_TOOL_NAME:
      result = applyAgentObjectSelection(agentObjectSelectionApplyRequestSchema.parse(request.arguments));
      break;
    case AGENT_PREVIEW_COMPARE_TOOL_NAME:
      result = renderAgentPreviewCompare(agentPreviewCompareRequestSchema.parse(request.arguments));
      break;
    case AGENT_PREVIEW_RENDER_TOOL_NAME:
      result = renderAgentReadOnlyPreview(agentPreviewRenderRequestSchema.parse(request.arguments));
      break;
    case RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME:
      result = getRawEngineImagePreview(rawEngineImageGetPreviewRequestSchema.parse(request.arguments));
      break;
    case AGENT_RETOUCH_APPLY_TOOL_NAME:
      result = applyAgentRetouch(agentRetouchApplyRequestSchema.parse(request.arguments));
      break;
    case AGENT_STATE_GET_TOOL_NAME:
      result = getAgentReadOnlyState(agentStateGetRequestSchema.parse(request.arguments));
      break;
    default:
      return null;
  }

  return rawEngineAppServerToolDispatchResponseSchema.parse({
    commandType: request.runtimeToolName,
    dispatchStatus: 'completed',
    requestId: request.requestId,
    result,
    runtime: AgentRuntimeId.AppServer,
    runtimeToolName: request.runtimeToolName,
    status: RawEngineAppServerResponseStatus.Ok,
    transport: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.transport,
  });
};

export const buildRawEngineAppServerToolDispatchResponse = async (
  request: RawEngineAppServerToolDispatchRequest,
): Promise<RawEngineAppServerToolDispatchResponse> => {
  const draftSessionError = validateDraftSessionForDispatch(request);
  if (draftSessionError !== null) {
    return rejectToolDispatch({ commandType: request.runtimeToolName, message: draftSessionError, request });
  }

  if (hasAgentSessionIntent(request) && !isApprovedAgentAppServerToolName(request.runtimeToolName)) {
    return rejectToolDispatch({
      commandType: request.runtimeToolName,
      message: `${request.runtimeToolName} is not an approved typed agent app-server tool.`,
      request,
    });
  }

  const bridge = rawEngineAppServerLocalBridge;
  const registryResult = await bridge.dispatch(buildRawEngineLocalAppServerToolRegistryQuery(request.requestId));
  const activeRegistry = registryResult.ok
    ? mergeRawEngineToolRegistries(
        rawEngineDefaultToolRegistryV1,
        rawEngineToolRegistryV1Schema.parse(registryResult.result),
      )
    : rawEngineDefaultToolRegistryV1;
  const validationRejection = buildRawEngineAppServerToolCallValidationRejection({ activeRegistry, request });
  if (validationRejection !== null) return validationRejection;

  try {
    const agentToolResponse = await dispatchAgentAppServerTool(request);
    if (agentToolResponse !== null) return agentToolResponse;
  } catch (error) {
    return rawEngineAppServerToolDispatchResponseSchema.parse({
      commandType: request.runtimeToolName,
      dispatchStatus: 'rejected',
      message: error instanceof Error ? error.message : 'Agent app-server tool dispatch failed.',
      requestId: request.requestId,
      runtime: AgentRuntimeId.AppServer,
      runtimeToolName: request.runtimeToolName,
      status: RawEngineAppServerResponseStatus.Ok,
      transport: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.transport,
    });
  }

  if (!registryResult.ok) {
    return rawEngineAppServerToolDispatchResponseSchema.parse({
      dispatchStatus: 'rejected',
      message: registryResult.message,
      requestId: request.requestId,
      runtime: AgentRuntimeId.AppServer,
      runtimeToolName: request.runtimeToolName,
      status: RawEngineAppServerResponseStatus.Ok,
      transport: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.transport,
    });
  }

  const registry = rawEngineToolRegistryV1Schema.parse(registryResult.result);
  const tool = registry.tools.find((candidate) => candidate.toolName === request.runtimeToolName);
  const commandType = getCommandType(request.arguments);
  if (tool === undefined) {
    return rawEngineAppServerToolDispatchResponseSchema.parse({
      commandType,
      dispatchStatus: 'rejected',
      message: `Local app-server bridge does not advertise ${request.runtimeToolName}.`,
      requestId: request.requestId,
      runtime: AgentRuntimeId.AppServer,
      runtimeToolName: request.runtimeToolName,
      status: RawEngineAppServerResponseStatus.Ok,
      transport: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.transport,
    });
  }

  if (
    !localBridgeToolMatchesCommand({
      commandType,
      dryRun: getDryRunFlag(request.arguments),
      runtimeToolName: request.runtimeToolName,
    })
  ) {
    return rawEngineAppServerToolDispatchResponseSchema.parse({
      commandType,
      dispatchStatus: 'rejected',
      message: `${request.runtimeToolName} cannot dispatch command ${commandType ?? 'unknown'}.`,
      requestId: request.requestId,
      runtime: AgentRuntimeId.AppServer,
      runtimeToolName: request.runtimeToolName,
      status: RawEngineAppServerResponseStatus.Ok,
      transport: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.transport,
    });
  }

  if (request.runtimeToolName.endsWith('.open_derived_source')) {
    try {
      const result = dispatchRawEngineLocalAppServerComputationalMergeDerivedSourceOpen(
        rawEngineLocalAppServerComputationalMergeDerivedSourceOpenRequestV1Schema.parse(request.arguments),
      );
      return rawEngineAppServerToolDispatchResponseSchema.parse({
        commandType,
        dispatchStatus: 'completed',
        requestId: request.requestId,
        result,
        runtime: AgentRuntimeId.AppServer,
        runtimeToolName: request.runtimeToolName,
        status: RawEngineAppServerResponseStatus.Ok,
        transport: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.transport,
      });
    } catch (error) {
      return rawEngineAppServerToolDispatchResponseSchema.parse({
        commandType,
        dispatchStatus: 'rejected',
        message: error instanceof Error ? error.message : 'Computational derived-source open failed.',
        requestId: request.requestId,
        runtime: AgentRuntimeId.AppServer,
        runtimeToolName: request.runtimeToolName,
        status: RawEngineAppServerResponseStatus.Ok,
        transport: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.transport,
      });
    }
  }

  const result = await bridge.dispatch(request.arguments, {
    now: () => new Date('2026-06-22T12:00:00.000Z'),
    requestId: request.requestId,
  });
  return rawEngineAppServerToolDispatchResponseSchema.parse({
    commandType,
    dispatchStatus: result.ok ? 'completed' : 'rejected',
    ...(result.ok ? { result: result.result } : { message: result.message }),
    requestId: request.requestId,
    runtime: AgentRuntimeId.AppServer,
    runtimeToolName: request.runtimeToolName,
    status: RawEngineAppServerResponseStatus.Ok,
    transport: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.transport,
  });
};

export const handleRawEngineAppServerHostRequest = (request: unknown): RawEngineAppServerHostResponse => {
  const parsedRequest: RawEngineAppServerHostRequest = rawEngineAppServerHostRequestSchema.parse(request);

  switch (parsedRequest.toolName) {
    case RawEngineAppServerHostToolName.Capabilities:
      return rawEngineAppServerHostResponseSchema.parse(buildRawEngineAppServerCapabilitiesResponse(parsedRequest));
    case RawEngineAppServerHostToolName.Health:
      return rawEngineAppServerHostResponseSchema.parse(buildRawEngineAppServerHealthResponse(parsedRequest));
    case RawEngineAppServerHostToolName.RouteCatalog:
      return rawEngineAppServerHostResponseSchema.parse(buildRawEngineAppServerRouteCatalogResponse(parsedRequest));
    case RawEngineAppServerHostToolName.DispatchTool:
      throw new Error('RawEngine app-server dispatch_tool requires the async host request handler.');
  }
};

export const handleRawEngineAppServerHostRequestAsync = async (
  request: unknown,
): Promise<RawEngineAppServerHostResponse> => {
  const parsedRequest: RawEngineAppServerHostRequest = rawEngineAppServerHostRequestSchema.parse(request);
  if (parsedRequest.toolName === RawEngineAppServerHostToolName.DispatchTool) {
    return rawEngineAppServerHostResponseSchema.parse(await buildRawEngineAppServerToolDispatchResponse(parsedRequest));
  }
  return handleRawEngineAppServerHostRequest(parsedRequest);
};

export const buildRawEngineAppServerHostResponseEnvelope = (
  request: unknown,
  handledAtIso = '2026-06-17T00:00:00.000Z',
): RawEngineAppServerHostResponseEnvelope => {
  const parsedRequest = rawEngineAppServerHostRequestSchema.parse(request);

  return rawEngineAppServerHostResponseEnvelopeSchema.parse({
    handledAtIso,
    request: parsedRequest,
    response: handleRawEngineAppServerHostRequest(parsedRequest),
    schemaVersion: 1,
    status: RawEngineAppServerResponseStatus.Ok,
    transport: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.transport,
  });
};

export const buildRawEngineAppServerHostResponseEnvelopeAsync = async (
  request: unknown,
  handledAtIso = '2026-06-17T00:00:00.000Z',
): Promise<RawEngineAppServerHostResponseEnvelope> => {
  const parsedRequest = rawEngineAppServerHostRequestSchema.parse(request);

  return rawEngineAppServerHostResponseEnvelopeSchema.parse({
    handledAtIso,
    request: parsedRequest,
    response: await handleRawEngineAppServerHostRequestAsync(parsedRequest),
    schemaVersion: 1,
    status: RawEngineAppServerResponseStatus.Ok,
    transport: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.transport,
  });
};

export const buildRawEngineAppServerAuditEntry = ({
  mutates = false,
  outcome = RawEngineAppServerAuditOutcome.Success,
  requestId,
  timestampIso,
  toolKind = RawEngineAppServerToolKind.Read,
  toolName,
}: {
  mutates?: boolean;
  outcome?: RawEngineAppServerAuditEntry['outcome'];
  requestId: string;
  timestampIso: string;
  toolKind?: RawEngineAppServerAuditEntry['toolKind'];
  toolName: RawEngineAppServerHostManifest['tools'][number]['toolName'] | string;
}): RawEngineAppServerAuditEntry =>
  rawEngineAppServerAuditEntrySchema.parse({
    affectedArtifactIds: [],
    mutates,
    outcome,
    requestId,
    timestampIso,
    toolKind,
    toolName,
    transport: RAW_ENGINE_APP_SERVER_HOST_MANIFEST.transport,
  });

export const buildRawEngineAppServerHealthReplay = (
  request: RawEngineAppServerHealthRequest,
  timestampIso = '2026-06-17T00:00:00.000Z',
): RawEngineAppServerHealthReplay =>
  rawEngineAppServerHealthReplaySchema.parse({
    auditLog: [
      buildRawEngineAppServerAuditEntry({ requestId: request.requestId, timestampIso, toolName: request.toolName }),
    ],
    manifest: RAW_ENGINE_APP_SERVER_HOST_MANIFEST,
    request,
    response: buildRawEngineAppServerHealthResponse(request),
    replayId: `rawengine_app_server_health_${request.requestId}`,
    schemaVersion: 1,
  });

export const buildRawEngineAppServerCapabilitiesReplay = (
  request: RawEngineAppServerCapabilitiesRequest,
  timestampIso = '2026-06-17T00:00:00.000Z',
): RawEngineAppServerCapabilitiesReplay =>
  rawEngineAppServerCapabilitiesReplaySchema.parse({
    auditLog: [
      buildRawEngineAppServerAuditEntry({ requestId: request.requestId, timestampIso, toolName: request.toolName }),
    ],
    manifest: RAW_ENGINE_APP_SERVER_HOST_MANIFEST,
    request,
    response: buildRawEngineAppServerCapabilitiesResponse(request),
    replayId: `rawengine_app_server_capabilities_${request.requestId}`,
    schemaVersion: 1,
  });

export const buildRawEngineAppServerRouteCatalogReplay = (
  request: RawEngineAppServerRouteCatalogRequest,
  timestampIso = '2026-06-17T00:00:00.000Z',
): RawEngineAppServerRouteCatalogReplay =>
  rawEngineAppServerRouteCatalogReplaySchema.parse({
    auditLog: [
      buildRawEngineAppServerAuditEntry({ requestId: request.requestId, timestampIso, toolName: request.toolName }),
    ],
    manifest: RAW_ENGINE_APP_SERVER_HOST_MANIFEST,
    request,
    response: buildRawEngineAppServerRouteCatalogResponse(request),
    replayId: `rawengine_app_server_route_catalog_${request.requestId}`,
    schemaVersion: 1,
  });
