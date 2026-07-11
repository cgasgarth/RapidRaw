import {
  type AgentSelectedImageProposalIterationStateV1,
  type AgentSelectedImageProposalIterationV1,
  type AgentSelectedImageProposalLineageV1,
  agentSelectedImageProposalIterationV1Schema,
  agentSelectedImageProposalLineageV1Schema,
} from '../../../schemas/agent/agentSelectedImageProposalIterationSchemas';

const transitions: Readonly<
  Record<AgentSelectedImageProposalIterationStateV1, readonly AgentSelectedImageProposalIterationStateV1[]>
> = {
  applied: ['reverted'],
  cancelled: [],
  draft: ['rendering', 'cancelled', 'failed', 'stale'],
  failed: [],
  ready: ['sealed', 'superseded', 'cancelled', 'failed', 'stale'],
  rendering: ['ready', 'cancelled', 'failed', 'stale', 'superseded'],
  reverted: [],
  sealed: ['applied', 'superseded', 'cancelled', 'failed', 'stale'],
  stale: [],
  superseded: [],
};

export class AgentSelectedImageProposalLineageError extends Error {}

const fail = (message: string): never => {
  throw new AgentSelectedImageProposalLineageError(message);
};

const validate = (lineage: AgentSelectedImageProposalLineageV1): AgentSelectedImageProposalLineageV1 => {
  const parsed = agentSelectedImageProposalLineageV1Schema.parse(lineage);
  const ordinals = new Set<number>();
  let sealedCount = 0;
  for (const iteration of parsed.iterations) {
    if (iteration.sessionId !== parsed.sessionId || iteration.lineageId !== parsed.lineageId)
      fail('Cross-lineage iteration rejected.');
    if (ordinals.has(iteration.ordinal)) fail('Duplicate proposal ordinal rejected.');
    ordinals.add(iteration.ordinal);
    if (iteration.state === 'sealed') sealedCount += 1;
    if (iteration.parentIterationId !== undefined) {
      const parent = parsed.iterations.find((candidate) => candidate.iterationId === iteration.parentIterationId);
      if (
        parent === undefined ||
        parent.proposalId !== iteration.parentProposalId ||
        parent.ordinal >= iteration.ordinal
      ) {
        fail('Invalid proposal parent lineage rejected.');
      }
    }
  }
  if (sealedCount > 1) fail('Multiple sealed proposal heads rejected.');
  const sealed = parsed.iterations.find((iteration) => iteration.state === 'sealed');
  if (parsed.sealedIterationId !== sealed?.iterationId) fail('Sealed head pointer mismatch rejected.');
  return parsed;
};

export const createAgentSelectedImageProposalLineage = ({
  lineageId,
  sessionId,
}: {
  lineageId: string;
  sessionId: string;
}): AgentSelectedImageProposalLineageV1 =>
  validate({ epoch: 0, iterations: [], lineageId, schemaVersion: 1, sessionId });

export const addAgentSelectedImageProposalIteration = (
  lineage: AgentSelectedImageProposalLineageV1,
  input: AgentSelectedImageProposalIterationV1,
): AgentSelectedImageProposalLineageV1 => {
  const current = validate(lineage);
  const iteration = agentSelectedImageProposalIterationV1Schema.parse(input);
  if (current.iterations.length >= 6) fail('Proposal lineage is limited to six iterations.');
  if (iteration.ordinal !== current.iterations.length + 1) fail('Proposal ordinal must be monotonic and contiguous.');
  if (iteration.state !== 'draft') fail('New proposal iteration must start in draft.');
  if (iteration.sessionId !== current.sessionId || iteration.lineageId !== current.lineageId)
    fail('Cross-session proposal rejected.');
  const parent =
    iteration.parentIterationId === undefined
      ? undefined
      : current.iterations.find((item) => item.iterationId === iteration.parentIterationId);
  if (current.iterations.length > 0 && parent === undefined && iteration.recoveredFromIterationId === undefined)
    fail('Child proposal must bind its parent.');
  const iterations = current.iterations.map((item) =>
    item.state === 'ready' || item.state === 'sealed'
      ? {
          ...item,
          cleanupStatus: 'pending' as const,
          state: 'superseded' as const,
          terminalReason: `superseded_by:${iteration.iterationId}`,
        }
      : item,
  );
  return validate({
    ...current,
    epoch: current.epoch + 1,
    iterations: [...iterations, iteration],
    sealedIterationId: undefined,
  });
};

export const transitionAgentSelectedImageProposalIteration = (
  lineage: AgentSelectedImageProposalLineageV1,
  iterationId: string,
  nextState: AgentSelectedImageProposalIterationStateV1,
  options: { expectedEpoch: number; now?: string; terminalReason?: string },
): AgentSelectedImageProposalLineageV1 => {
  const current = validate(lineage);
  if (options.expectedEpoch !== current.epoch) fail('Late proposal result rejected by lineage epoch.');
  const index = current.iterations.findIndex((iteration) => iteration.iterationId === iterationId);
  if (index < 0) fail('Unknown proposal iteration rejected.');
  const existing = current.iterations[index];
  if (existing === undefined) throw new AgentSelectedImageProposalLineageError('Unknown proposal iteration rejected.');
  if (!transitions[existing.state].includes(nextState))
    fail(`Illegal proposal transition ${existing.state} -> ${nextState}.`);
  const now = options.now ?? new Date().toISOString();
  if (Date.parse(now) >= Date.parse(existing.expiresAt) && nextState !== 'stale')
    fail('Expired proposal transition rejected.');
  if (nextState === 'sealed' && current.iterations.some((item) => item.state === 'sealed'))
    fail('A sealed proposal head already exists.');
  const terminal = ['superseded', 'stale', 'cancelled', 'failed'].includes(nextState);
  const updated = {
    ...existing,
    ...(options.terminalReason === undefined ? {} : { terminalReason: options.terminalReason }),
    cleanupStatus: terminal
      ? ('pending' as const)
      : nextState === 'sealed'
        ? ('retained_for_apply' as const)
        : existing.cleanupStatus,
    state: nextState,
  };
  const iterations = [...current.iterations];
  iterations[index] = updated;
  return validate({
    ...current,
    epoch: current.epoch + 1,
    iterations,
    sealedIterationId:
      nextState === 'sealed' ? iterationId : existing.state === 'sealed' ? undefined : current.sealedIterationId,
  });
};

export const assertAgentSelectedImageProposalApplyable = ({
  acceptedProposalHash,
  acceptedProposalId,
  baseGraphRevision,
  basePreviewArtifactId,
  basePreviewContentHash,
  baseRecipeHash,
  expectedEpoch,
  iterationId,
  lineage,
  now = new Date().toISOString(),
  selectedImageId,
  sessionId,
}: {
  acceptedProposalHash: string;
  acceptedProposalId: string;
  baseGraphRevision: string;
  basePreviewArtifactId: string;
  basePreviewContentHash: string;
  baseRecipeHash: string;
  expectedEpoch: number;
  iterationId: string;
  lineage: AgentSelectedImageProposalLineageV1;
  now?: string;
  selectedImageId: string;
  sessionId: string;
}): AgentSelectedImageProposalIterationV1 => {
  const current = validate(lineage);
  const found = current.iterations.find((item) => item.iterationId === iterationId);
  if (current.epoch !== expectedEpoch || current.sessionId !== sessionId)
    fail('Apply lineage session or epoch mismatch.');
  if (found === undefined)
    throw new AgentSelectedImageProposalLineageError('Apply requires the current sealed proposal head.');
  const iteration = found;
  if (current.sealedIterationId !== iterationId || iteration.state !== 'sealed')
    fail('Apply requires the current sealed proposal head.');
  if (Date.parse(now) >= Date.parse(iteration.expiresAt)) fail('Expired proposal cannot be applied.');
  if (iteration.proposalId !== acceptedProposalId || iteration.proposalHash !== acceptedProposalHash)
    fail('Accepted proposal identity mismatch.');
  if (
    iteration.selectedImageId !== selectedImageId ||
    iteration.baseGraphRevision !== baseGraphRevision ||
    iteration.baseRecipeHash !== baseRecipeHash ||
    iteration.basePreviewArtifactId !== basePreviewArtifactId ||
    iteration.basePreviewContentHash !== basePreviewContentHash
  )
    fail('Proposal base identity is stale.');
  return iteration;
};

export const parseAgentSelectedImageProposalLineage = validate;
