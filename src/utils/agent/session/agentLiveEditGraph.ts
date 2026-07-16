import { z } from 'zod';
import type { EditDocumentNodeParamsV2 } from '../../../../packages/rawengine-schema/src/editDocumentV2';
import {
  createRawEngineLocalAppServerBridge,
  type RawEngineLocalAppServerBridge,
} from '../../../../packages/rawengine-schema/src/localAppServerBridge';
import {
  ApprovalClass,
  type EditGraphCommandEnvelopeV1,
  type EditGraphDryRunResultV1,
  type EditGraphMutationResultV1,
  type EditGraphParameterPatchOperationV1,
  editGraphCommandEnvelopeV1Schema,
  editGraphDryRunResultV1Schema,
  editGraphMutationResultV1Schema,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas';
import { useEditorStore } from '../../../store/useEditorStore';
import {
  buildAgentEditGraphEditTransaction,
  captureAgentEditGraphCommitIdentity,
} from '../../agentEditGraphEditTransaction';
import { selectEditDocumentNode } from '../../editDocumentSelectors';

type LiveEditGraphBridge = RawEngineLocalAppServerBridge;
type EditGraphParameterPatchCommandV1 = Extract<
  EditGraphCommandEnvelopeV1,
  { commandType: 'editGraph.applyParameterPatch' }
>;

const adjustmentPathPattern = /^\/adjustments\/([A-Za-z0-9_]+)$/u;

const currentGraphRevision = (): string => `history_${useEditorStore.getState().historyIndex}`;

type LiveSceneToneKey = keyof EditDocumentNodeParamsV2<'scene_global_color_tone'>;
const liveSceneToneKeySchema = z.enum([
  'blacks',
  'brightness',
  'contrast',
  'exposure',
  'highlights',
  'shadows',
  'whites',
]);

const assertSelectedImageTarget = (command: EditGraphCommandEnvelopeV1): void => {
  const selectedImage = useEditorStore.getState().selectedImage;
  if (selectedImage === null) throw new Error('Live editor editGraph command requires a selected image.');
  if (command.target.kind === 'image' && command.target.imagePath !== selectedImage.path) {
    throw new Error('Live editor editGraph command rejected a different selected image.');
  }
};

const assertCurrentRevision = (command: EditGraphCommandEnvelopeV1): void => {
  if (command.expectedGraphRevision !== currentGraphRevision()) {
    throw new Error('Live editor editGraph command rejected stale graph revision.');
  }
};

const assertSupportedOperation = (operation: EditGraphParameterPatchOperationV1): LiveSceneToneKey => {
  const match = adjustmentPathPattern.exec(operation.path);
  if (match === null) throw new Error(`Live editor editGraph command rejected unsupported path: ${operation.path}`);
  const key = match[1];
  const parsedKey = liveSceneToneKeySchema.safeParse(key);
  if (!parsedKey.success) {
    throw new Error(`Live editor editGraph command rejected unknown adjustment key: ${key ?? operation.path}`);
  }
  return parsedKey.data;
};

const assertPreviousValueMatches = (
  adjustments: EditDocumentNodeParamsV2<'scene_global_color_tone'>,
  key: LiveSceneToneKey,
  operation: EditGraphParameterPatchOperationV1,
): void => {
  if (operation.previousValue === undefined) return;
  if (JSON.stringify(adjustments[key]) !== JSON.stringify(operation.previousValue)) {
    throw new Error(`Live editor editGraph command rejected stale previous value for ${String(key)}.`);
  }
};

const buildSceneTonePatchFromEditGraphOperations = (
  base: EditDocumentNodeParamsV2<'scene_global_color_tone'>,
  operations: readonly EditGraphParameterPatchOperationV1[],
): Readonly<Partial<EditDocumentNodeParamsV2<'scene_global_color_tone'>>> => {
  const patch: Partial<EditDocumentNodeParamsV2<'scene_global_color_tone'>> = {};

  for (const operation of operations) {
    const key = assertSupportedOperation(operation);
    assertPreviousValueMatches(base, key, operation);
    if (operation.op === 'remove' || typeof operation.value !== 'number' || !Number.isFinite(operation.value)) {
      throw new Error(`Live editor editGraph command rejected invalid scene-tone value for ${key}.`);
    }
    patch[key] = operation.value;
  }
  return patch;
};

const parseLiveEditGraphCommand = (commandInput: EditGraphCommandEnvelopeV1): EditGraphParameterPatchCommandV1 => {
  const command = editGraphCommandEnvelopeV1Schema.parse(commandInput);
  if (command.commandType !== 'editGraph.applyParameterPatch') {
    throw new Error('Live editor editGraph bridge only supports parameter patches.');
  }
  return command as EditGraphParameterPatchCommandV1;
};

const dispatchEditGraphBridgeCommand = async (
  bridge: LiveEditGraphBridge,
  command: EditGraphCommandEnvelopeV1,
  requestId?: string,
) => {
  const result = await bridge.dispatch(command, {
    ...(requestId === undefined ? {} : { requestId }),
    now: () => new Date(),
  });
  if (!result.ok) throw new Error(result.message);
  return result.result;
};

export const dryRunEditGraphCommandInLiveEditor = async (
  commandInput: EditGraphCommandEnvelopeV1,
  bridge: LiveEditGraphBridge = createRawEngineLocalAppServerBridge(),
  requestId?: string,
): Promise<EditGraphDryRunResultV1> => {
  const command = parseLiveEditGraphCommand(commandInput);
  if (!command.dryRun) throw new Error('Live editor editGraph dry-run requires dryRun=true.');
  if (command.approval.approvalClass !== ApprovalClass.PreviewOnly) {
    throw new Error('Live editor editGraph dry-run requires preview-only approval.');
  }
  assertSelectedImageTarget(command);
  assertCurrentRevision(command);
  for (const operation of command.parameters.operations) assertSupportedOperation(operation);

  return editGraphDryRunResultV1Schema.parse(await dispatchEditGraphBridgeCommand(bridge, command, requestId));
};

export const applyEditGraphCommandToLiveEditor = async (
  commandInput: EditGraphCommandEnvelopeV1,
  bridge: LiveEditGraphBridge = createRawEngineLocalAppServerBridge(),
  requestId?: string,
): Promise<EditGraphMutationResultV1> => {
  const command = parseLiveEditGraphCommand(commandInput);
  if (command.dryRun) throw new Error('Live editor editGraph apply requires dryRun=false.');
  if (command.approval.approvalClass !== ApprovalClass.EditApply || command.approval.state !== 'approved') {
    throw new Error('Live editor editGraph apply requires approved edit-apply approval.');
  }
  assertSelectedImageTarget(command);
  assertCurrentRevision(command);

  const state = useEditorStore.getState();
  const commitIdentity = captureAgentEditGraphCommitIdentity(state);
  if (commitIdentity === null) throw new Error('Live editor editGraph apply requires a selected image session.');
  const patch = buildSceneTonePatchFromEditGraphOperations(
    selectEditDocumentNode(state.editDocumentV2, 'scene_global_color_tone').params,
    command.parameters.operations,
  );
  const bridgeResult = await dispatchEditGraphBridgeCommand(bridge, command, requestId);
  const mutation = editGraphMutationResultV1Schema.parse(bridgeResult);
  const currentState = useEditorStore.getState();
  currentState.applyEditTransaction(
    buildAgentEditGraphEditTransaction(currentState, commitIdentity, patch, command.commandId),
  );

  return mutation;
};
