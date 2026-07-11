import {
  type RawEngineAgentSelectedImageProposalReceiptV1,
  type RawEngineAgentSelectedImageProposalRenderCommandV1,
  rawEngineAgentSelectedImageProposalArtifactV1Schema,
  rawEngineAgentSelectedImageProposalReceiptV1Schema,
} from '../../../../packages/rawengine-schema/src/agentSelectedImageProposalSchemas';
import { useEditorStore } from '../../../store/useEditorStore';
import type { Adjustments } from '../../adjustments';
import { assertAgentAdjustmentsDryRunPlanForProposal } from '../tools/agentAdjustmentApplyTool';
import { assertAgentToneDryRunPlanForProposal } from '../tools/agentToneAdjustmentTool';
import { buildAgentImageContextSnapshot } from './agentImageContextSnapshot';
import {
  AgentMediumPreviewAttachmentError,
  type AgentMediumPreviewAttachmentManager,
  type AgentModelImageAttachment,
  agentMediumPreviewAttachmentManager,
  sha256ForAgentPreviewBytes,
} from './agentMediumPreviewAttachmentRuntime';

type ProposalRuntimeStatus = 'cancelled' | 'failed' | 'ready' | 'released' | 'stale' | 'superseded' | 'timed_out';
type ProposalTerminalStatus = Exclude<ProposalRuntimeStatus, 'ready'>;
type ProposalArtifact = RawEngineAgentSelectedImageProposalReceiptV1['base']['artifact'];
type ProposalArtifacts = NonNullable<RawEngineAgentSelectedImageProposalReceiptV1['artifacts']>;
type ReceiptWithoutHash = Omit<RawEngineAgentSelectedImageProposalReceiptV1, 'receiptHash'>;

export interface AgentSelectedImageProposalRuntime {
  cancel: (cancellationId: string) => Promise<void>;
  ensureReady: (proposalId: string) => Promise<RawEngineAgentSelectedImageProposalReceiptV1 | undefined>;
  getPreviewUrl: (proposalId: string, role: 'after' | 'before') => string | undefined;
  getReceipt: (proposalId: string) => RawEngineAgentSelectedImageProposalReceiptV1 | undefined;
  release: (proposalId: string, status?: ProposalTerminalStatus) => Promise<void>;
  render: (
    command: RawEngineAgentSelectedImageProposalRenderCommandV1,
  ) => Promise<RawEngineAgentSelectedImageProposalReceiptV1>;
}

interface ActiveProposal {
  cancellationId: string;
  controller: AbortController;
  proposalId: string;
  sessionId: string;
  terminalStatus?: ProposalTerminalStatus;
}

interface StoredProposal {
  active: ActiveProposal;
  artifacts: ProposalArtifacts;
  command: RawEngineAgentSelectedImageProposalRenderCommandV1;
  manager: AgentMediumPreviewAttachmentManager;
  makeReceipt: (input: {
    artifacts?: ProposalArtifacts;
    status: ProposalRuntimeStatus;
    warnings?: string[];
  }) => Promise<RawEngineAgentSelectedImageProposalReceiptV1>;
  previewAfterUrl: string;
  previewBeforeUrl: string;
  receipt: RawEngineAgentSelectedImageProposalReceiptV1;
}

interface IdempotentProposal {
  commandFingerprint: string;
  receipt: Promise<RawEngineAgentSelectedImageProposalReceiptV1>;
}

const colorPipeline = {
  encodedProfile: 'srgb-preview' as const,
  outputProfile: 'srgb' as const,
  previewTransform: 'editor-preview-to-srgb-jpeg' as const,
  workingSpace: 'rawengine-scene-linear' as const,
};

const proposalHash = async (value: string | Uint8Array): Promise<string> =>
  sha256ForAgentPreviewBytes(typeof value === 'string' ? new TextEncoder().encode(value) : value);

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== 'object' || value === null) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
};

const canonicalJson = (value: unknown): string => JSON.stringify(canonicalize(value));

export const calculateAgentSelectedImageProposalReceiptHash = async (receipt: ReceiptWithoutHash): Promise<string> =>
  proposalHash(canonicalJson(receipt));

export const verifyAgentSelectedImageProposalReceipt = async (receipt: unknown): Promise<boolean> => {
  const parsed = rawEngineAgentSelectedImageProposalReceiptV1Schema.safeParse(receipt);
  if (!parsed.success) return false;
  const { receiptHash, ...evidence } = parsed.data;
  return receiptHash === (await calculateAgentSelectedImageProposalReceiptHash(evidence));
};

const proposedAdjustments = (
  base: Adjustments,
  patch: RawEngineAgentSelectedImageProposalRenderCommandV1['edit']['patch'],
): Adjustments => {
  const next = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) next[key as keyof Adjustments] = value as Adjustments[keyof Adjustments];
  }
  return next;
};

const identityMatches = (
  command: RawEngineAgentSelectedImageProposalRenderCommandV1,
  snapshot: ReturnType<typeof buildAgentImageContextSnapshot>,
): boolean =>
  command.expectedGraphRevision === snapshot.graphRevision &&
  command.expectedRecipeHash === snapshot.initialPreview.recipeHash &&
  command.expectedRenderHash === snapshot.initialPreview.renderHash &&
  command.expectedSelectedImagePath === snapshot.activeImagePath;

const proposalArtifactFromAttachment = ({ attachment }: AgentModelImageAttachment): ProposalArtifact =>
  rawEngineAgentSelectedImageProposalArtifactV1Schema.parse({
    accessScope: attachment.accessScope,
    artifactId: attachment.artifactId,
    byteLength: attachment.byteLength,
    colorPipeline: attachment.colorPipeline,
    contentHash: attachment.contentHash,
    dimensions: attachment.dimensions,
    encodedFormat: attachment.encodedFormat,
    expiresAt: attachment.expiresAt,
    mediaType: attachment.mediaType,
    quality: attachment.quality,
    recipeHash: attachment.revision.recipeHash,
    renderHash: attachment.revision.renderHash,
  });

const attachmentDataUrl = ({ attachment, payloadBase64 }: AgentModelImageAttachment): string =>
  `data:${attachment.mediaType};base64,${payloadBase64}`;

const attachmentReleaseStatus = (status: ProposalTerminalStatus): 'released' | 'stale' | 'superseded' =>
  status === 'stale' || status === 'superseded' ? status : 'released';

const terminalStatusForError = (error: unknown, active: ActiveProposal): ProposalTerminalStatus => {
  if (active.terminalStatus !== undefined) return active.terminalStatus;
  if (!(error instanceof AgentMediumPreviewAttachmentError)) return 'failed';
  if (error.outcome === 'cancelled') return 'cancelled';
  if (error.outcome === 'stale') return 'stale';
  if (error.outcome === 'timed_out') return 'timed_out';
  return 'failed';
};

const errorWarning = (error: unknown): string =>
  error instanceof Error ? error.message : 'Selected-image proposal rendering failed.';

export const createAgentSelectedImageProposalRuntime = ({
  manager,
  now = Date.now,
}: {
  manager?: AgentMediumPreviewAttachmentManager;
  now?: () => number;
} = {}): AgentSelectedImageProposalRuntime => {
  const activeByCancellationId = new Map<string, ActiveProposal>();
  const activeBySession = new Map<string, ActiveProposal>();
  const cancelledBeforeStart = new Set<string>();
  const idempotentProposals = new Map<string, IdempotentProposal>();
  const proposals = new Map<string, StoredProposal>();
  const getManager = (): AgentMediumPreviewAttachmentManager => manager ?? agentMediumPreviewAttachmentManager;

  const releaseStoredProposal = async (stored: StoredProposal, status: ProposalTerminalStatus): Promise<void> => {
    if (stored.receipt.status === status) return;

    stored.active.terminalStatus = status;
    stored.active.controller.abort();
    stored.manager.release(stored.artifacts['before'].artifactId, attachmentReleaseStatus(status));
    stored.manager.release(stored.artifacts['after'].artifactId, attachmentReleaseStatus(status));
    stored.receipt = await stored.makeReceipt({
      artifacts: stored.artifacts,
      status,
      warnings: stored.receipt.warnings,
    });
    if (activeByCancellationId.get(stored.active.cancellationId) === stored.active) {
      activeByCancellationId.delete(stored.active.cancellationId);
    }
    if (activeBySession.get(stored.active.sessionId) === stored.active) activeBySession.delete(stored.active.sessionId);
  };

  const release = async (proposalId: string, status: ProposalTerminalStatus = 'superseded'): Promise<void> => {
    const stored = proposals.get(proposalId);
    if (stored === undefined) return;
    await releaseStoredProposal(stored, status);
  };

  const cancel = async (cancellationId: string): Promise<void> => {
    const active = activeByCancellationId.get(cancellationId);
    if (active === undefined) {
      cancelledBeforeStart.add(cancellationId);
      return;
    }
    active.terminalStatus = 'cancelled';
    active.controller.abort();
    const stored = proposals.get(active.proposalId);
    if (stored !== undefined) await releaseStoredProposal(stored, 'cancelled');
  };

  const getReceipt = (proposalId: string): RawEngineAgentSelectedImageProposalReceiptV1 | undefined => {
    const receipt = proposals.get(proposalId)?.receipt;
    return receipt === undefined ? undefined : structuredClone(receipt);
  };

  const getPreviewUrl = (proposalId: string, role: 'after' | 'before'): string | undefined => {
    const stored = proposals.get(proposalId);
    if (stored?.receipt.status !== 'ready') return undefined;
    return role === 'before' ? stored.previewBeforeUrl : stored.previewAfterUrl;
  };

  const ensureReady = async (proposalId: string): Promise<RawEngineAgentSelectedImageProposalReceiptV1 | undefined> => {
    const stored = proposals.get(proposalId);
    if (stored === undefined || stored.receipt.status !== 'ready') return getReceipt(proposalId);
    if (Date.parse(stored.receipt.expiresAt) <= now()) {
      await releaseStoredProposal(stored, 'stale');
      return getReceipt(proposalId);
    }
    try {
      if (!identityMatches(stored.command, buildAgentImageContextSnapshot())) {
        await releaseStoredProposal(stored, 'stale');
        return getReceipt(proposalId);
      }
    } catch {
      await releaseStoredProposal(stored, 'stale');
      return getReceipt(proposalId);
    }
    if (!(await verifyAgentSelectedImageProposalReceipt(stored.receipt))) {
      await releaseStoredProposal(stored, 'failed');
    }
    return getReceipt(proposalId);
  };

  const renderNewProposal = async (
    command: RawEngineAgentSelectedImageProposalRenderCommandV1,
    commandFingerprint: string,
  ): Promise<RawEngineAgentSelectedImageProposalReceiptV1> => {
    const startedAt = now();
    const proposalId = `proposal:${await proposalHash(`${command.sessionId}:${command.idempotencyKey}`)}`;
    const selectedImageId = await proposalHash(command.expectedSelectedImagePath);
    const proposedRecipeHash = await proposalHash(
      canonicalJson({ base: command.expectedRecipeHash, edit: command.edit, plan: command.dryRunPlan.planHash }),
    );
    const proposedRenderHash = await proposalHash(
      canonicalJson({
        base: command.expectedRenderHash,
        graphRevision: command.dryRunPlan.predictedGraphRevision,
        recipeHash: proposedRecipeHash,
        selectedImagePath: command.expectedSelectedImagePath,
      }),
    );
    const baseExpiry = Date.parse(command.basePreview.expiresAt);
    const commandDeadline = Date.parse(command.deadlineAt);
    const active: ActiveProposal = {
      cancellationId: command.cancellationId,
      controller: new AbortController(),
      proposalId,
      sessionId: command.sessionId,
    };
    const attachmentManager = getManager();
    if (cancelledBeforeStart.has(command.cancellationId)) active.terminalStatus = 'cancelled';
    const priorActive = activeBySession.get(command.sessionId);
    if (priorActive !== undefined && priorActive.proposalId !== proposalId) {
      priorActive.terminalStatus = 'superseded';
      priorActive.controller.abort();
      const storedPrior = proposals.get(priorActive.proposalId);
      if (storedPrior !== undefined) void releaseStoredProposal(storedPrior, 'superseded');
    }
    activeByCancellationId.set(command.cancellationId, active);
    activeBySession.set(command.sessionId, active);

    const makeReceipt = async ({
      artifacts,
      status,
      warnings = [],
    }: {
      artifacts?: ProposalArtifacts;
      status: ProposalRuntimeStatus;
      warnings?: string[];
    }): Promise<RawEngineAgentSelectedImageProposalReceiptV1> => {
      const expiresAt = new Date(
        Math.min(
          commandDeadline,
          baseExpiry,
          artifacts === undefined ? Number.POSITIVE_INFINITY : Date.parse(artifacts['after'].expiresAt),
        ),
      ).toISOString();
      const evidence: ReceiptWithoutHash = {
        ...(artifacts === undefined ? {} : { artifacts }),
        base: {
          artifact: command.basePreview,
          graphRevision: command.expectedGraphRevision,
          previewArtifactId: command.basePreview.artifactId,
          previewContentHash: command.basePreview.contentHash,
          recipeHash: command.expectedRecipeHash,
          renderHash: command.expectedRenderHash,
          selectedImageId,
        },
        cleanupState: status,
        createdAt: new Date(startedAt).toISOString(),
        dryRunPlan: command.dryRunPlan,
        edit: command.edit,
        expiresAt,
        lineage: command.lineage,
        proposalHash: await proposalHash(`${proposalId}:${commandFingerprint}:${proposedRenderHash}`),
        proposalId,
        render: {
          deadlineAt: command.deadlineAt,
          durationMs: Math.max(0, now() - startedAt),
          outcome: status,
          proposedRecipeHash,
          proposedRenderHash,
        },
        schemaVersion: 1,
        status,
        warnings,
      };
      return rawEngineAgentSelectedImageProposalReceiptV1Schema.parse({
        ...evidence,
        receiptHash: await calculateAgentSelectedImageProposalReceiptHash(evidence),
      });
    };

    let acquiredBase: AgentModelImageAttachment | undefined;
    let acquiredAfter: AgentModelImageAttachment | undefined;
    try {
      if (commandDeadline <= now() || baseExpiry <= now()) {
        return await makeReceipt({ status: 'timed_out', warnings: ['Proposal deadline expired before rendering.'] });
      }
      if (active.terminalStatus !== undefined) {
        return await makeReceipt({
          status: active.terminalStatus,
          warnings: ['Proposal was cancelled before rendering.'],
        });
      }

      let snapshot: ReturnType<typeof buildAgentImageContextSnapshot>;
      try {
        snapshot = buildAgentImageContextSnapshot();
      } catch {
        return await makeReceipt({ status: 'stale', warnings: ['Selected image is no longer available.'] });
      }
      if (!identityMatches(command, snapshot)) {
        return await makeReceipt({
          status: 'stale',
          warnings: ['Selected-image proposal rejected stale editor identity.'],
        });
      }
      try {
        const plan = {
          adjustments: command.edit.patch,
          expectedGraphRevision: command.expectedGraphRevision,
          expectedRecipeHash: command.expectedRecipeHash,
          operationId: command.operationId,
          planHash: command.dryRunPlan.planHash,
          planId: command.dryRunPlan.planId,
          sessionId: command.sessionId,
        };
        try {
          assertAgentAdjustmentsDryRunPlanForProposal(plan);
        } catch {
          assertAgentToneDryRunPlanForProposal(plan);
        }
      } catch (error) {
        return await makeReceipt({ status: 'failed', warnings: [errorWarning(error)] });
      }

      acquiredBase = attachmentManager.getModelAttachment(command.basePreview.artifactId);
      if (acquiredBase === undefined) {
        return await makeReceipt({
          status: 'failed',
          warnings: ['Selected-image proposal base attachment is unavailable.'],
        });
      }
      const before = proposalArtifactFromAttachment(acquiredBase);
      if (canonicalJson(before) !== canonicalJson(command.basePreview)) {
        return await makeReceipt({
          status: 'failed',
          warnings: ['Selected-image proposal base attachment does not match the acquired preview bytes.'],
        });
      }

      acquiredAfter = await attachmentManager.acquire({
        adjustments: proposedAdjustments(useEditorStore.getState().adjustments, command.edit.patch),
        deadlineAt: commandDeadline,
        outputIdentity: {
          graphRevision: command.dryRunPlan.predictedGraphRevision,
          recipeHash: proposedRecipeHash,
          renderHash: proposedRenderHash,
          selectedImageId,
        },
        signal: active.controller.signal,
        snapshot,
      });
      if (active.terminalStatus !== undefined) {
        return await makeReceipt({
          status: active.terminalStatus,
          warnings: [`Proposal was ${active.terminalStatus} before delivery.`],
        });
      }
      if (!identityMatches(command, buildAgentImageContextSnapshot())) {
        return await makeReceipt({
          status: 'stale',
          warnings: ['Selected image changed while the proposal rendered.'],
        });
      }

      const after = proposalArtifactFromAttachment(acquiredAfter);
      const artifacts = { after, before } satisfies ProposalArtifacts;
      const receipt = await makeReceipt({ artifacts, status: 'ready' });
      proposals.set(proposalId, {
        active,
        artifacts,
        command,
        manager: attachmentManager,
        makeReceipt,
        previewAfterUrl: attachmentDataUrl(acquiredAfter),
        previewBeforeUrl: attachmentDataUrl(acquiredBase),
        receipt,
      });
      return receipt;
    } catch (error) {
      const status = terminalStatusForError(error, active);
      return await makeReceipt({ status, warnings: [errorWarning(error)] });
    } finally {
      const stored = proposals.get(proposalId);
      if (stored === undefined) {
        if (acquiredBase !== undefined) {
          attachmentManager.release(
            acquiredBase.attachment.artifactId,
            attachmentReleaseStatus(active.terminalStatus ?? 'released'),
          );
        }
        if (acquiredAfter !== undefined) {
          attachmentManager.release(
            acquiredAfter.attachment.artifactId,
            attachmentReleaseStatus(active.terminalStatus ?? 'released'),
          );
        }
        if (activeBySession.get(command.sessionId) === active) activeBySession.delete(command.sessionId);
      }
      if (activeByCancellationId.get(command.cancellationId) === active && stored === undefined) {
        activeByCancellationId.delete(command.cancellationId);
      }
      cancelledBeforeStart.delete(command.cancellationId);
    }
  };

  const render = async (command: RawEngineAgentSelectedImageProposalRenderCommandV1) => {
    const commandFingerprint = await proposalHash(canonicalJson(command));
    const idempotencyKey = `${command.sessionId}:${command.idempotencyKey}`;
    const existing = idempotentProposals.get(idempotencyKey);
    if (existing !== undefined) {
      if (existing.commandFingerprint === commandFingerprint) {
        const receipt = await existing.receipt;
        return getReceipt(receipt.proposalId) ?? receipt;
      }
      const proposalId = `proposal:${await proposalHash(idempotencyKey)}`;
      const selectedImageId = await proposalHash(command.expectedSelectedImagePath);
      const evidence: ReceiptWithoutHash = {
        base: {
          artifact: command.basePreview,
          graphRevision: command.expectedGraphRevision,
          previewArtifactId: command.basePreview.artifactId,
          previewContentHash: command.basePreview.contentHash,
          recipeHash: command.expectedRecipeHash,
          renderHash: command.expectedRenderHash,
          selectedImageId,
        },
        cleanupState: 'failed',
        createdAt: new Date(now()).toISOString(),
        dryRunPlan: command.dryRunPlan,
        edit: command.edit,
        expiresAt: command.basePreview.expiresAt,
        lineage: command.lineage,
        proposalHash: await proposalHash(`${proposalId}:${commandFingerprint}`),
        proposalId,
        render: {
          deadlineAt: command.deadlineAt,
          durationMs: 0,
          outcome: 'failed',
          proposedRecipeHash: await proposalHash(canonicalJson(command.edit)),
          proposedRenderHash: await proposalHash(canonicalJson(command)),
        },
        schemaVersion: 1,
        status: 'failed',
        warnings: ['Proposal idempotency key was reused with different command evidence.'],
      };
      return rawEngineAgentSelectedImageProposalReceiptV1Schema.parse({
        ...evidence,
        receiptHash: await calculateAgentSelectedImageProposalReceiptHash(evidence),
      });
    }

    const receipt = renderNewProposal(command, commandFingerprint);
    idempotentProposals.set(idempotencyKey, { commandFingerprint, receipt });
    return receipt;
  };

  return { cancel, ensureReady, getPreviewUrl, getReceipt, release, render };
};

export const agentSelectedImageProposalRuntime = createAgentSelectedImageProposalRuntime();
