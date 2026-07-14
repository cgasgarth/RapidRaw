import {
  type ApplyFilmEmulationOperationV1,
  applyFilmEmulationOperationV1Schema,
  type FilmEmulationHistoryEntryV1,
  type FilmEmulationNodeV1,
  type FilmEmulationOperationResultV1,
  type FilmEmulationOperationV1,
  type FilmEmulationPlacementV1,
  type FilmEmulationTargetStateV1,
  filmEmulationNodeV1Schema,
  filmEmulationOperationResultV1Schema,
  filmEmulationTargetStateV1Schema,
} from '../../../packages/rawengine-schema/src/index.js';

export type { FilmEmulationTargetStateV1 } from '../../../packages/rawengine-schema/src/index.js';

export const REFERENCE_FILM_PROFILE_REF = {
  id: 'rapidraw.reference_film.v1',
  version: '1',
  contentSha256: 'sha256:d84121641d1318f3be759fb5705f04f01721cd35a57e1b238343590bc2b988ef',
} as const;

const DEFAULT_PLACEMENT: FilmEmulationPlacementV1 = { position: 'scene_creative_end' };
const DEFAULT_STAGE_P = 0.35;

export class FilmEmulationOperationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'FilmEmulationOperationError';
    this.code = code;
  }
}

const stableJson = (value: unknown): string => JSON.stringify(value);

const fnv1a64 = (value: string): string => {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`;
};

export const filmEmulationCanonicalHash = (value: unknown): string => fnv1a64(stableJson(value));

const nodeHash = (node: FilmEmulationNodeV1 | null): string | null =>
  node === null ? null : filmEmulationCanonicalHash(node);

const graphHash = (
  target: FilmEmulationTargetStateV1['target'],
  revision: string,
  node: FilmEmulationNodeV1 | null,
  placement: FilmEmulationPlacementV1,
): string => filmEmulationCanonicalHash({ target, revision, node, placement });

const defaultNode = (): FilmEmulationNodeV1 =>
  filmEmulationNodeV1Schema.parse({
    contractVersion: 1,
    enabled: true,
    mix: 1,
    nodeType: 'film_emulation',
    profileRef: REFERENCE_FILM_PROFILE_REF,
    seedPolicy: 'source_stable_v1',
    workingSpace: 'acescg_linear_v1',
  });

const revisionFor = (source: string, fingerprint: string): string =>
  `film.graph.v1:${fnv1a64(`${source}:${fingerprint}`).slice(9)}`;

const candidateFor = (
  current: FilmEmulationTargetStateV1,
  operation: FilmEmulationOperationV1,
): { node: FilmEmulationNodeV1 | null; placement: FilmEmulationPlacementV1 } => {
  let node = current.node;
  let placement = current.placement;
  switch (operation.kind) {
    case 'set_profile':
      node = { ...(node ?? defaultNode()), profileRef: operation.profileRef };
      break;
    case 'set_mix':
      node = { ...(node ?? defaultNode()), mix: operation.mix };
      break;
    case 'set_enabled':
      node = { ...(node ?? defaultNode()), enabled: operation.enabled };
      break;
    case 'set_stage_params':
      node = {
        ...(node ?? defaultNode()),
        stageParams: { referenceLuminanceShaperP: operation.patch.p },
      };
      break;
    case 'set_stack_position':
      placement =
        operation.afterNodeId === undefined
          ? { position: operation.position }
          : { position: operation.position, afterNodeId: operation.afterNodeId };
      break;
    case 'reset_to_profile':
      node = defaultNode();
      placement = DEFAULT_PLACEMENT;
      break;
    case 'remove_node':
      node = null;
      placement = DEFAULT_PLACEMENT;
      break;
  }
  if (node !== null) node = filmEmulationNodeV1Schema.parse(node);
  return { node, placement };
};

const stateWithHashes = (
  state: Omit<FilmEmulationTargetStateV1, 'graphHash' | 'nodeHash'>,
  node: FilmEmulationNodeV1 | null = state['node'],
  placement: FilmEmulationPlacementV1 = state['placement'],
): FilmEmulationTargetStateV1 => {
  const next: Omit<FilmEmulationTargetStateV1, 'graphHash' | 'nodeHash'> = { ...state, node, placement };
  return filmEmulationTargetStateV1Schema.parse({
    ...next,
    graphHash: graphHash(next['target'], next['graphRevision'], next['node'], next['placement']),
    nodeHash: nodeHash(next['node']),
  });
};

export const createFilmEmulationTargetState = (
  target: FilmEmulationTargetStateV1['target'],
): FilmEmulationTargetStateV1 =>
  stateWithHashes({
    commandReceipts: [],
    graphRevision: 'film.graph.v1:0',
    history: [],
    node: null,
    placement: DEFAULT_PLACEMENT,
    redo: [],
    target,
  });

/**
 * Explicit hydration boundary from the persisted editor node into the command
 * adapter. Editor history and adjustment revisions remain the canonical edit
 * authority; the command graph identity is deterministically rebuilt here.
 */
export const hydrateFilmEmulationTargetState = (
  target: FilmEmulationTargetStateV1['target'],
  rawNode: FilmEmulationNodeV1 | null,
): FilmEmulationTargetStateV1 => {
  const node = rawNode === null ? null : filmEmulationNodeV1Schema.parse(rawNode);
  const graphRevision =
    node === null ? 'film.graph.v1:0' : revisionFor('editor-hydration', filmEmulationCanonicalHash({ node, target }));
  return stateWithHashes({
    commandReceipts: [],
    graphRevision,
    history: [],
    node,
    placement: DEFAULT_PLACEMENT,
    redo: [],
    target,
  });
};

const resultFor = (
  command: ApplyFilmEmulationOperationV1,
  source: FilmEmulationTargetStateV1,
  candidate: { node: FilmEmulationNodeV1 | null; placement: FilmEmulationPlacementV1 },
  predictedRevision: string,
  idempotentReplay: boolean,
): FilmEmulationOperationResultV1 =>
  filmEmulationOperationResultV1Schema.parse({
    appliedGraphRevision: command.dryRun ? undefined : predictedRevision,
    commandId: command.commandId,
    commandType: command.commandType,
    correlationId: command.correlationId,
    dryRun: command.dryRun,
    graphHash: graphHash(source.target, predictedRevision, candidate.node, candidate.placement),
    historyEntryId: command.dryRun ? undefined : `film.history.v1:${fnv1a64(command.commandId).slice(9)}`,
    idempotentReplay,
    mutates: !command.dryRun && !idempotentReplay,
    nodeHash: nodeHash(candidate.node),
    planHash: filmEmulationCanonicalHash({ operation: command.operation, sourceGraphRevision: source.graphRevision }),
    resultingNode: candidate.node,
    resultingPlacement: candidate.placement,
    sourceGraphRevision: source.graphRevision,
    warnings: [],
  });

const sameTarget = (a: ApplyFilmEmulationOperationV1['target'], b: FilmEmulationTargetStateV1['target']): boolean =>
  a.kind === b.kind && a.variantId === b.variantId;

const receiptFor = (command: ApplyFilmEmulationOperationV1, result: FilmEmulationOperationResultV1) => ({
  commandId: command.commandId,
  fingerprint: filmEmulationCanonicalHash(command),
  ...(command.idempotencyKey === undefined ? {} : { idempotencyKey: command.idempotencyKey }),
  result,
});

export interface FilmEmulationApplyResult {
  readonly result: FilmEmulationOperationResultV1;
  readonly state: FilmEmulationTargetStateV1;
}

export const applyFilmEmulationOperation = (
  rawCommand: unknown,
  rawState: FilmEmulationTargetStateV1,
  now = new Date('2026-01-01T00:00:00.000Z'),
): FilmEmulationApplyResult => {
  const command = applyFilmEmulationOperationV1Schema.parse(rawCommand);
  const state = filmEmulationTargetStateV1Schema.parse(rawState);
  if (!sameTarget(command.target, state.target)) {
    throw new FilmEmulationOperationError('film_target_mismatch', 'Film operation target does not match graph state.');
  }
  const fingerprint = filmEmulationCanonicalHash(command);
  const prior = state.commandReceipts.find(
    (receipt) =>
      receipt.commandId === command.commandId ||
      (command.idempotencyKey !== undefined && receipt.idempotencyKey === command.idempotencyKey),
  );
  if (prior !== undefined) {
    if (prior.fingerprint !== fingerprint) {
      throw new FilmEmulationOperationError(
        'film_idempotency_conflict',
        'Command or idempotency key was reused with different input.',
      );
    }
    return { result: { ...prior.result, idempotentReplay: true, mutates: false }, state };
  }
  if (command.expectedGraphRevision !== state.graphRevision) {
    throw new FilmEmulationOperationError(
      'film_stale_graph_revision',
      'Film operation expectedGraphRevision is stale.',
    );
  }
  const candidate = candidateFor(state, command.operation);
  const predictedRevision = revisionFor(state.graphRevision, fingerprint);
  const result = resultFor(command, state, candidate, predictedRevision, false);
  if (command.dryRun) return { result, state };

  const entry: FilmEmulationHistoryEntryV1 = {
    commandId: command.commandId,
    createdAt: now.toISOString(),
    entryId: result.historyEntryId ?? `film.history.v1:${fnv1a64(command.commandId).slice(9)}`,
    operation: command.operation,
    previousNode: state.node,
    previousPlacement: state.placement,
    resultingNode: candidate.node,
    resultingPlacement: candidate.placement,
    sourceGraphRevision: state.graphRevision,
    resultingGraphRevision: predictedRevision,
  };
  const next = stateWithHashes(
    {
      commandReceipts: [...state.commandReceipts, receiptFor(command, result)],
      graphRevision: predictedRevision,
      history: [...state.history, entry],
      node: candidate.node,
      placement: candidate.placement,
      redo: [],
      target: state.target,
    },
    candidate.node,
    candidate.placement,
  );
  return { result, state: next };
};

export const undoFilmEmulationOperation = (state: FilmEmulationTargetStateV1): FilmEmulationTargetStateV1 => {
  if (state.history.length === 0)
    throw new FilmEmulationOperationError('film_history_empty', 'Film history has no operation to undo.');
  const entry = state.history.at(-1);
  if (entry === undefined)
    throw new FilmEmulationOperationError('film_history_empty', 'Film history has no operation to undo.');
  const graphRevision = revisionFor(state.graphRevision, `undo:${entry.entryId}`);
  return stateWithHashes({
    commandReceipts: state.commandReceipts,
    graphRevision,
    history: state.history.slice(0, -1),
    node: entry.previousNode,
    placement: entry.previousPlacement,
    redo: [...state.redo, entry],
    target: state.target,
  });
};

export const redoFilmEmulationOperation = (state: FilmEmulationTargetStateV1): FilmEmulationTargetStateV1 => {
  const entry = state.redo.at(-1);
  if (entry === undefined)
    throw new FilmEmulationOperationError('film_redo_empty', 'Film history has no operation to redo.');
  const graphRevision = revisionFor(state.graphRevision, `redo:${entry.entryId}`);
  return stateWithHashes({
    commandReceipts: state.commandReceipts,
    graphRevision,
    history: [...state.history, entry],
    node: entry.resultingNode,
    placement: entry.resultingPlacement,
    redo: state.redo.slice(0, -1),
    target: state.target,
  });
};

export const serializeFilmEmulationTargetState = (state: FilmEmulationTargetStateV1): string =>
  JSON.stringify(filmEmulationTargetStateV1Schema.parse(state));

export const reopenFilmEmulationTargetState = (serialized: string): FilmEmulationTargetStateV1 =>
  filmEmulationTargetStateV1Schema.parse(JSON.parse(serialized) as unknown);
