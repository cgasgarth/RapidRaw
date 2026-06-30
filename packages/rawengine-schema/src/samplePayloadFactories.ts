import {
  ActorKind,
  ApprovalClass,
  type ApprovalRequirementV1,
  RAW_ENGINE_SCHEMA_VERSION,
  type RawEngineActor,
  type RawEngineAppServerToolCallV1,
  type RawEngineAppServerToolCallValidationV1,
  type RawEngineTarget,
  type RawEngineToolRegistryV1,
  rawEngineAppServerToolCallValidationV1Schema,
} from './rawEngineSchemas.js';

export const sampleAgentActor = (sessionId = 'session_sample'): RawEngineActor => ({
  id: 'codex-app-server',
  kind: ActorKind.Agent,
  sessionId,
});

export const sampleImageTarget = (
  imagePath = '/photos/session/IMG_0001.CR3',
  virtualCopyId?: string | null,
): RawEngineTarget => ({
  imagePath,
  kind: 'image',
  ...(virtualCopyId !== undefined ? { virtualCopyId } : {}),
});

export const samplePreviewApproval = (reason: string): ApprovalRequirementV1 => ({
  approvalClass: ApprovalClass.PreviewOnly,
  reason,
  state: 'not_required',
});

export const sampleExternalModelApproval = (reason: string): ApprovalRequirementV1 => ({
  approvalClass: ApprovalClass.ExternalModel,
  reason,
  state: 'approved',
});

export const sampleGenerativeEditApproval = (reason: string, recordId: string): ApprovalRequirementV1 => ({
  approvalClass: ApprovalClass.GenerativeEdit,
  reason,
  recordId,
  state: 'approved',
});

export const sampleEditApplyApproval = (reason: string): ApprovalRequirementV1 => ({
  approvalClass: ApprovalClass.EditApply,
  reason,
  state: 'approved',
});

export const sampleFileMutationApproval = (reason: string, recordId: string): ApprovalRequirementV1 => ({
  approvalClass: ApprovalClass.FileMutation,
  reason,
  recordId,
  state: 'approved',
});

export const withSampleSchemaVersion = <TValue extends object>(value: TValue): TValue & { schemaVersion: 1 } => ({
  ...value,
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
});

type SampleAppServerToolCallInput = Omit<RawEngineAppServerToolCallV1, 'protocol' | 'schemaVersion' | 'transport'>;

export const sampleAppServerToolCallValidation = ({
  registry,
  toolCall,
}: {
  registry: RawEngineToolRegistryV1;
  toolCall: SampleAppServerToolCallInput;
}): RawEngineAppServerToolCallValidationV1 =>
  rawEngineAppServerToolCallValidationV1Schema.parse(
    withSampleSchemaVersion({
      registry,
      toolCall: withSampleSchemaVersion({
        ...toolCall,
        protocol: 'codex_app_server_json_rpc',
        transport: 'stdio',
      }),
    }),
  );
