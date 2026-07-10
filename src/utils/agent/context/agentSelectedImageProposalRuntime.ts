import {
  type RawEngineAgentSelectedImageProposalReceiptV1,
  type RawEngineAgentSelectedImageProposalRenderCommandV1,
  rawEngineAgentSelectedImageProposalReceiptV1Schema,
} from '../../../../packages/rawengine-schema/src/agentSelectedImageProposalSchemas';
import { useEditorStore } from '../../../store/useEditorStore';
import type { Adjustments } from '../../adjustments';
import { assertAgentToneDryRunPlanForProposal } from '../tools/agentToneAdjustmentTool';
import { buildAgentImageContextSnapshot } from './agentImageContextSnapshot';
import {
  type AgentMediumPreviewAttachmentManager,
  agentMediumPreviewAttachmentManager,
  type renderAgentMediumPreviewNative,
  sha256ForAgentPreviewBytes,
} from './agentMediumPreviewAttachmentRuntime';

type ProposalRuntimeStatus = 'cancelled' | 'ready' | 'released' | 'stale' | 'superseded';

export interface AgentSelectedImageProposalRuntime {
  cancel: (cancellationId: string) => void;
  getPreviewUrl: (proposalId: string) => string | undefined;
  getReceipt: (proposalId: string) => RawEngineAgentSelectedImageProposalReceiptV1 | undefined;
  render: (
    command: RawEngineAgentSelectedImageProposalRenderCommandV1,
  ) => Promise<RawEngineAgentSelectedImageProposalReceiptV1>;
  release: (proposalId: string, status?: Exclude<ProposalRuntimeStatus, 'ready'>) => void;
}

interface StoredProposal {
  afterPreviewArtifactId?: string;
  cancellationId: string;
  controller: AbortController;
  previewUrl?: string;
  receipt: RawEngineAgentSelectedImageProposalReceiptV1;
}

const colorPipeline = {
  encodedProfile: 'srgb-preview' as const,
  outputProfile: 'srgb' as const,
  previewTransform: 'editor-preview-to-srgb-jpeg' as const,
  workingSpace: 'rawengine-scene-linear' as const,
};

const proposalHash = async (value: string | Uint8Array): Promise<string> =>
  sha256ForAgentPreviewBytes(typeof value === 'string' ? new TextEncoder().encode(value) : value);

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

const isExpired = (deadlineAt: string): boolean => Date.parse(deadlineAt) <= Date.now();

export const createAgentSelectedImageProposalRuntime = ({
  manager = agentMediumPreviewAttachmentManager,
  now = Date.now,
  renderPreview,
}: {
  manager?: AgentMediumPreviewAttachmentManager;
  now?: () => number;
  renderPreview?: typeof renderAgentMediumPreviewNative;
} = {}): AgentSelectedImageProposalRuntime => {
  const proposals = new Map<string, StoredProposal>();
  const cancellations = new Map<string, AbortController>();

  const release = (proposalId: string, status: Exclude<ProposalRuntimeStatus, 'ready'> = 'superseded') => {
    const stored = proposals.get(proposalId);
    if (stored === undefined) return;
    stored.controller.abort();
    if (stored.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(stored.previewUrl);
    if (stored.afterPreviewArtifactId !== undefined) {
      manager.release(stored.afterPreviewArtifactId, status === 'cancelled' ? 'released' : status);
    }
    stored.receipt = rawEngineAgentSelectedImageProposalReceiptV1Schema.parse({
      ...stored.receipt,
      artifacts: undefined,
      cleanupState: status,
      render: { ...stored.receipt.render, outcome: status },
      status,
    });
  };

  const cancel = (cancellationId: string) => {
    cancellations.get(cancellationId)?.abort();
    for (const [proposalId, stored] of proposals) {
      if (stored.cancellationId === cancellationId) release(proposalId, 'cancelled');
    }
  };

  const getReceipt = (proposalId: string) => {
    const stored = proposals.get(proposalId);
    if (stored === undefined) return undefined;
    if (stored.receipt.status !== 'ready') return stored.receipt;
    if (Date.parse(stored.receipt.expiresAt) <= now()) {
      release(proposalId, 'stale');
      return proposals.get(proposalId)?.receipt;
    }
    try {
      if (identityMatchesFromReceipt(stored.receipt, buildAgentImageContextSnapshot())) return stored.receipt;
    } catch {
      // A missing selected image makes a ready proposal unusable.
    }
    release(proposalId, 'stale');
    return proposals.get(proposalId)?.receipt;
  };

  const getPreviewUrl = (proposalId: string) => {
    const receipt = getReceipt(proposalId);
    return receipt?.status === 'ready' ? proposals.get(proposalId)?.previewUrl : undefined;
  };

  const render = async (command: RawEngineAgentSelectedImageProposalRenderCommandV1) => {
    const startedAt = now();
    const snapshot = buildAgentImageContextSnapshot();
    if (!identityMatches(command, snapshot)) throw new Error('Selected-image proposal rejected stale editor identity.');
    if (isExpired(command.deadlineAt)) throw new Error('Selected-image proposal deadline expired before rendering.');
    assertAgentToneDryRunPlanForProposal({
      adjustments: command.edit.patch,
      expectedGraphRevision: command.expectedGraphRevision,
      expectedRecipeHash: command.expectedRecipeHash,
      operationId: command.operationId,
      planHash: command.dryRunPlan.planHash,
      planId: command.dryRunPlan.planId,
      sessionId: command.sessionId,
    });

    cancel(command.cancellationId);
    const controller = new AbortController();
    cancellations.set(command.cancellationId, controller);
    const proposalId = `proposal:${await proposalHash(`${command.idempotencyKey}:${command.dryRunPlan.planHash}`)}`;
    const beforeState = useEditorStore.getState();
    const beforeAdjustments = beforeState.adjustments;
    const beforeHistory = beforeState.history;
    const proposedRecipeHash = await proposalHash(
      JSON.stringify({ base: command.expectedRecipeHash, edit: command.edit, plan: command.dryRunPlan.planHash }),
    );
    const proposedRenderHash = await proposalHash(
      JSON.stringify({
        base: command.expectedRenderHash,
        recipe: proposedRecipeHash,
        selectedImage: command.expectedSelectedImagePath,
      }),
    );
    const selectedImageId = await proposalHash(command.expectedSelectedImagePath);

    const expiresAt = new Date(Math.min(Date.parse(command.deadlineAt), startedAt + 60_000)).toISOString();
    const buildReceipt = async ({
      artifacts,
      status,
      warnings = [],
    }: {
      artifacts?: RawEngineAgentSelectedImageProposalReceiptV1['artifacts'];
      status: RawEngineAgentSelectedImageProposalReceiptV1['status'];
      warnings?: string[];
    }) =>
      rawEngineAgentSelectedImageProposalReceiptV1Schema.parse({
        ...(artifacts === undefined ? {} : { artifacts }),
        base: {
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
        proposalHash: await proposalHash(`${proposalId}:${proposedRenderHash}`),
        proposalId,
        receiptHash: await proposalHash(`${proposalId}:${status}`),
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
      });

    if (controller.signal.aborted) {
      return buildReceipt({ status: 'cancelled', warnings: ['Proposal was cancelled before rendering.'] });
    }

    try {
      const adjustments = proposedAdjustments(beforeAdjustments, command.edit.patch);
      let bytes: Uint8Array | undefined;
      let rendered: Awaited<ReturnType<AgentMediumPreviewAttachmentManager['acquire']>> | undefined;
      if (renderPreview === undefined) {
        rendered = await manager.acquire({
          adjustments,
          deadlineAt: Date.parse(command.deadlineAt),
          outputIdentity: {
            graphRevision: command.dryRunPlan.predictedGraphRevision,
            recipeHash: proposedRecipeHash,
            renderHash: proposedRenderHash,
            selectedImageId,
          },
          signal: controller.signal,
          snapshot,
        });
      } else {
        bytes = await renderPreview({ adjustments, signal: controller.signal, snapshot });
      }
      const current = buildAgentImageContextSnapshot();
      if (controller.signal.aborted) {
        return buildReceipt({ status: 'cancelled', warnings: ['Proposal was cancelled before delivery.'] });
      }
      if (!identityMatches(command, current)) {
        return buildReceipt({ status: 'stale', warnings: ['Selected image changed while the proposal rendered.'] });
      }
      if (
        beforeAdjustments !== useEditorStore.getState().adjustments ||
        beforeHistory !== useEditorStore.getState().history
      ) {
        return buildReceipt({ status: 'stale', warnings: ['Editor state changed while the proposal rendered.'] });
      }
      const afterContentHash =
        rendered?.attachment.contentHash ?? (bytes === undefined ? undefined : await sha256ForAgentPreviewBytes(bytes));
      if (afterContentHash === undefined)
        throw new Error('Selected-image proposal renderer returned no preview bytes.');
      const ready = await buildReceipt({
        artifacts: {
          after: {
            accessScope: 'local_private',
            artifactId: rendered?.attachment.artifactId ?? `proposal-after:${afterContentHash.slice(7, 31)}`,
            byteLength: rendered?.attachment.byteLength ?? bytes?.byteLength ?? 0,
            colorPipeline,
            contentHash: afterContentHash,
            dimensions: rendered?.attachment.dimensions ?? {
              height: snapshot.initialPreview.height,
              width: snapshot.initialPreview.width,
            },
            encodedFormat: 'jpeg',
            expiresAt,
            mediaType: 'image/jpeg',
            quality: 0.86,
            recipeHash: rendered?.attachment.revision.recipeHash ?? proposedRecipeHash,
            renderHash: rendered?.attachment.revision.renderHash ?? proposedRenderHash,
          },
          before: {
            accessScope: 'local_private',
            artifactId: command.basePreview.artifactId,
            byteLength: 1,
            colorPipeline,
            contentHash: command.basePreview.contentHash,
            dimensions: { height: snapshot.initialPreview.height, width: snapshot.initialPreview.width },
            encodedFormat: 'jpeg',
            expiresAt,
            mediaType: 'image/jpeg',
            quality: 0.86,
            recipeHash: proposedRecipeHash,
            renderHash: proposedRenderHash,
          },
        },
        status: 'ready',
      });
      const previewUrl =
        rendered === undefined
          ? (() => {
              if (bytes === undefined) throw new Error('Selected-image proposal renderer returned no preview bytes.');
              const previewBytes = new Uint8Array(bytes.byteLength);
              previewBytes.set(bytes);
              return URL.createObjectURL(new Blob([previewBytes.buffer], { type: 'image/jpeg' }));
            })()
          : `data:${rendered.attachment.mediaType};base64,${rendered.payloadBase64}`;
      proposals.set(proposalId, {
        ...(rendered === undefined ? {} : { afterPreviewArtifactId: rendered.attachment.artifactId }),
        cancellationId: command.cancellationId,
        controller,
        previewUrl,
        receipt: ready,
      });
      return ready;
    } catch (error) {
      if (controller.signal.aborted) {
        return buildReceipt({ status: 'cancelled', warnings: ['Proposal was cancelled before delivery.'] });
      }
      throw error;
    } finally {
      if (cancellations.get(command.cancellationId) === controller) cancellations.delete(command.cancellationId);
    }
  };

  return { cancel, getPreviewUrl, getReceipt, release, render };
};

const identityMatchesFromReceipt = (
  receipt: RawEngineAgentSelectedImageProposalReceiptV1,
  snapshot: ReturnType<typeof buildAgentImageContextSnapshot>,
): boolean =>
  receipt.base.graphRevision === snapshot.graphRevision &&
  receipt.base.recipeHash === snapshot.initialPreview.recipeHash &&
  receipt.base.renderHash === snapshot.initialPreview.renderHash;

export const agentSelectedImageProposalRuntime = createAgentSelectedImageProposalRuntime();
