import {
  AGENT_RETOUCH_APPLY_INPUT_SCHEMA_NAME,
  AGENT_RETOUCH_APPLY_OUTPUT_SCHEMA_NAME,
  AGENT_RETOUCH_APPLY_TOOL_NAME,
} from './agent/tools/agentRetouchApplyTool';
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
} from './agentLayerMaskTools';

export type AgentLocalLayerCoverageStatus = 'covered' | 'partial';

export interface AgentLocalLayerCoverageEntry {
  applyPath: string;
  commandTypes: readonly string[];
  inputSchemaName: string;
  outputSchemaName: string;
  previewProof: readonly string[];
  receiptFields: readonly string[];
  rollbackProof: readonly string[];
  runtimeCheckScript: string;
  status: AgentLocalLayerCoverageStatus;
  surface:
    | 'brush_mask'
    | 'layer_create'
    | 'layer_scoped_adjustment'
    | 'object_prompt_mask'
    | 'retouch_clone_heal_remove';
  toolName: string;
}

export const AGENT_LOCAL_LAYER_COVERAGE_MATRIX = [
  {
    applyPath: 'applyAgentLayerCreate',
    commandTypes: ['layerMask.createLayer'],
    inputSchemaName: AGENT_LAYER_CREATE_INPUT_SCHEMA_NAME,
    outputSchemaName: AGENT_LAYER_CREATE_OUTPUT_SCHEMA_NAME,
    previewProof: ['beforePreviewHash', 'afterPreviewHash', 'overlayPreview.artifact', 'overlayPreview.recipeHash'],
    receiptFields: ['layerId', 'layerName', 'appliedGraphRevision', 'undoGraphRevision'],
    rollbackProof: ['undoGraphRevision', 'historyIndex increments by one'],
    runtimeCheckScript: 'check:agent-layer-mask-tools',
    status: 'covered',
    surface: 'layer_create',
    toolName: AGENT_LAYER_CREATE_TOOL_NAME,
  },
  {
    applyPath: 'applyAgentLayerScopedAdjustments',
    commandTypes: ['layerMask.applyLayerAdjustment'],
    inputSchemaName: AGENT_LAYER_SCOPED_ADJUST_INPUT_SCHEMA_NAME,
    outputSchemaName: AGENT_LAYER_SCOPED_ADJUST_OUTPUT_SCHEMA_NAME,
    previewProof: ['beforePreviewHash', 'afterPreviewHash', 'overlayPreview.artifact', 'overlayPreview.recipeHash'],
    receiptFields: ['layerId', 'adjustedFields', 'appliedGraphRevision', 'undoGraphRevision'],
    rollbackProof: ['undoGraphRevision', 'historyIndex increments by one'],
    runtimeCheckScript: 'check:agent-layer-mask-tools',
    status: 'covered',
    surface: 'layer_scoped_adjustment',
    toolName: AGENT_LAYER_SCOPED_ADJUST_TOOL_NAME,
  },
  {
    applyPath: 'applyAgentBrushMaskCreateOrUpdate',
    commandTypes: ['layerMask.createBrushMask'],
    inputSchemaName: AGENT_MASK_CREATE_OR_UPDATE_INPUT_SCHEMA_NAME,
    outputSchemaName: AGENT_MASK_CREATE_OR_UPDATE_OUTPUT_SCHEMA_NAME,
    previewProof: [
      'beforePreviewHash',
      'afterPreviewHash',
      'maskContentHash',
      'overlayPreview.artifact',
      'overlayPreview.maskId',
      'overlayPreview.recipeHash',
    ],
    receiptFields: ['layerId', 'maskId', 'maskContentHash', 'appliedGraphRevision', 'undoGraphRevision'],
    rollbackProof: ['undoGraphRevision', 'historyIndex increments by one'],
    runtimeCheckScript: 'check:agent-layer-mask-tools',
    status: 'covered',
    surface: 'brush_mask',
    toolName: AGENT_MASK_CREATE_OR_UPDATE_TOOL_NAME,
  },
  {
    applyPath: 'applyAgentObjectSelection',
    commandTypes: ['layerMask.createLayer'],
    inputSchemaName: AGENT_OBJECT_SELECTION_APPLY_INPUT_SCHEMA_NAME,
    outputSchemaName: AGENT_OBJECT_SELECTION_APPLY_OUTPUT_SCHEMA_NAME,
    previewProof: [
      'beforePreviewHash',
      'afterPreviewHash',
      'objectPromptHash',
      'overlayPreview.artifact',
      'overlayPreview.maskId',
      'overlayPreview.recipeHash',
    ],
    receiptFields: ['layerId', 'maskId', 'providerStatus', 'appliedGraphRevision', 'undoGraphRevision'],
    rollbackProof: ['undoGraphRevision', 'historyIndex increments by one'],
    runtimeCheckScript: 'check:agent-object-selection-apply',
    status: 'covered',
    surface: 'object_prompt_mask',
    toolName: AGENT_OBJECT_SELECTION_APPLY_TOOL_NAME,
  },
  {
    applyPath: 'applyAgentRetouch',
    commandTypes: ['layerMask.createLayer'],
    inputSchemaName: AGENT_RETOUCH_APPLY_INPUT_SCHEMA_NAME,
    outputSchemaName: AGENT_RETOUCH_APPLY_OUTPUT_SCHEMA_NAME,
    previewProof: [
      'beforePreviewHash',
      'afterPreviewHash',
      'overlayMaskId',
      'overlayPreview.artifact',
      'overlayPreview.mode',
      'overlayPreview.overlayMaskId',
      'overlayPreview.recipeHash',
    ],
    receiptFields: ['layerId', 'mode', 'overlayMaskId', 'overlayPreview', 'appliedGraphRevision', 'undoGraphRevision'],
    rollbackProof: ['undoGraphRevision', 'historyIndex increments by one'],
    runtimeCheckScript: 'check:agent-retouch-apply',
    status: 'covered',
    surface: 'retouch_clone_heal_remove',
    toolName: AGENT_RETOUCH_APPLY_TOOL_NAME,
  },
] as const satisfies readonly AgentLocalLayerCoverageEntry[];
