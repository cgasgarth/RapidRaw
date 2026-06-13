import {
  ActorKind,
  ApprovalClass,
  RAW_ENGINE_SCHEMA_VERSION,
  artifactHandleV1Schema,
  commandEnvelopeV1Schema,
  queryEnvelopeV1Schema,
  rawEngineToolRegistryV1Schema,
  type ArtifactHandleV1,
  type CommandEnvelopeV1,
  type QueryEnvelopeV1,
  type RawEngineToolRegistryV1,
} from './rawEngineSchemas.js';

export const sampleQueryEnvelopeV1: QueryEnvelopeV1 = queryEnvelopeV1Schema.parse({
  actor: {
    id: 'codex-app-server',
    kind: ActorKind.Agent,
    sessionId: 'session_sample',
  },
  correlationId: 'corr_metadata_sample',
  parameters: {
    includeExif: true,
  },
  queryId: 'query_metadata_sample',
  queryType: 'image.getMetadata',
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target: {
    imagePath: '/photos/session/IMG_0001.CR3',
    kind: 'image',
  },
});

export const sampleCommandEnvelopeV1: CommandEnvelopeV1 = commandEnvelopeV1Schema.parse({
  actor: {
    id: 'codex-app-server',
    kind: ActorKind.Agent,
    sessionId: 'session_sample',
  },
  approval: {
    approvalClass: ApprovalClass.PreviewOnly,
    reason: 'Tone dry-run does not persist sidecars or exported files.',
    state: 'not_required',
  },
  commandId: 'command_tone_dry_run_sample',
  commandType: 'edit.tone.dryRun',
  correlationId: 'corr_tone_dry_run_sample',
  dryRun: true,
  expectedGraphRevision: 'graph_rev_42',
  parameters: {
    exposureEv: 0.25,
    highlights: -12,
  },
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target: {
    imagePath: '/photos/session/IMG_0001.CR3',
    kind: 'image',
    virtualCopyId: null,
  },
});

export const sampleArtifactHandleV1: ArtifactHandleV1 = artifactHandleV1Schema.parse({
  artifactId: 'artifact_preview_sample',
  contentHash: 'sha256:sample-preview-hash',
  dimensions: {
    height: 1080,
    width: 1620,
  },
  kind: 'preview',
  storage: 'temp_cache',
});

export const sampleToolRegistryV1: RawEngineToolRegistryV1 = rawEngineToolRegistryV1Schema.parse({
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  tools: [
    {
      approvalClass: ApprovalClass.SafeRead,
      inputSchemaName: 'QueryEnvelopeV1',
      mutates: false,
      outputSchemaName: 'ImageMetadataResultV1',
      requiresDryRun: false,
      returnsArtifactHandles: false,
      toolKind: 'read',
      toolName: 'image.get_metadata',
    },
    {
      approvalClass: ApprovalClass.PreviewOnly,
      inputSchemaName: 'CommandEnvelopeV1',
      mutates: false,
      outputSchemaName: 'ToneDryRunResultV1',
      requiresDryRun: true,
      returnsArtifactHandles: true,
      toolKind: 'dry_run',
      toolName: 'edit.dry_run_tone',
    },
  ],
});
