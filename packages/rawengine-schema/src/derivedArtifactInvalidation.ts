export type CommonDerivedArtifactInvalidationReason =
  | 'output_artifact_changed'
  | 'source_content_hash_changed'
  | 'source_graph_revision_changed'
  | 'source_set_changed';

export interface DerivedArtifactSourceState {
  contentHash: string;
  graphRevision: string;
  sourceIndex: number;
}

export interface DerivedArtifactInvalidationInput {
  outputContentHash?: string | undefined;
  sourceState: ReadonlyArray<DerivedArtifactSourceState>;
}

export interface DerivedArtifactInvalidationArtifact {
  outputArtifact: {
    contentHash?: string | undefined;
  };
  sourceState: ReadonlyArray<DerivedArtifactSourceState>;
}

const REASON_ORDER: ReadonlyArray<CommonDerivedArtifactInvalidationReason> = [
  'source_set_changed',
  'source_content_hash_changed',
  'source_graph_revision_changed',
  'output_artifact_changed',
];

export function deriveArtifactInvalidationReasons(
  artifact: DerivedArtifactInvalidationArtifact,
  currentState: DerivedArtifactInvalidationInput,
): Array<CommonDerivedArtifactInvalidationReason> {
  const reasons = new Set<CommonDerivedArtifactInvalidationReason>();
  const artifactSourcesByIndex = new Map(artifact.sourceState.map((source) => [source.sourceIndex, source]));
  const currentSourcesByIndex = new Map(currentState.sourceState.map((source) => [source.sourceIndex, source]));

  if (
    artifactSourcesByIndex.size !== currentSourcesByIndex.size ||
    [...artifactSourcesByIndex.keys()].some((sourceIndex) => !currentSourcesByIndex.has(sourceIndex))
  ) {
    reasons.add('source_set_changed');
  }

  for (const [sourceIndex, artifactSource] of artifactSourcesByIndex.entries()) {
    const currentSource = currentSourcesByIndex.get(sourceIndex);

    if (currentSource === undefined) {
      continue;
    }

    if (artifactSource.contentHash !== currentSource.contentHash) {
      reasons.add('source_content_hash_changed');
    }

    if (artifactSource.graphRevision !== currentSource.graphRevision) {
      reasons.add('source_graph_revision_changed');
    }
  }

  if (
    artifact.outputArtifact.contentHash !== undefined &&
    currentState.outputContentHash !== undefined &&
    artifact.outputArtifact.contentHash !== currentState.outputContentHash
  ) {
    reasons.add('output_artifact_changed');
  }

  return REASON_ORDER.filter((reason) => reasons.has(reason));
}
