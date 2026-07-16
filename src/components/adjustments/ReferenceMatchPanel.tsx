import { FolderSearch, GitCompareArrows, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { referencePhysicalSourceIdentityV1Schema } from '../../../packages/rawengine-schema/src/referenceMatchRuntime';

import { useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useUIStore } from '../../store/useUIStore';
import { Invokes } from '../../tauri/commands';
import { selectEditDocumentNode } from '../../utils/editDocumentSelectors';
import {
  createReferenceMatchProposal,
  describeReferenceMatchSource,
  fingerprintReferenceMatchValue,
  getReferenceMatchLayerCompatibility,
  mergeReferenceSourceIdentities,
  type ReferenceMatchGroup,
  type ReferenceMatchProposal,
  type ReferencePhysicalSourceIdentity,
  selectReferenceMatchReferences,
  summarizeReferenceHistogram,
  validateReferenceMatchApplicationIdentities,
} from '../../utils/referenceMatch';
import {
  applyReferenceMatchProposalToEditDocument,
  buildReferenceMatchGlobalEditTransaction,
  buildReferenceMatchLayerEditTransaction,
  captureReferenceMatchCommitIdentity,
  selectReferenceMatchGlobalAdjustments,
} from '../../utils/referenceMatchEditTransaction';
import { invokeWithSchema } from '../../utils/tauriSchemaInvoke';

const GROUPS: ReferenceMatchGroup[] = ['tone', 'color', 'presence'];

const browserSourceIdentity = (path: string): ReferencePhysicalSourceIdentity => ({
  available: true,
  sourceRevision: `source-revision-v1:${fingerprintReferenceMatchValue(path).slice('fnv1a64:'.length).repeat(4)}`,
});

const resolveSourceIdentity = async (path: string): Promise<ReferencePhysicalSourceIdentity | null> => {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return browserSourceIdentity(path);
  try {
    return await invokeWithSchema(
      Invokes.ResolveOriginalSourceIdentity,
      { path },
      referencePhysicalSourceIdentityV1Schema,
    );
  } catch {
    return null;
  }
};

export default function ReferenceMatchPanel() {
  const { t } = useTranslation();
  const {
    adjustmentSnapshot,
    adjustmentRevision,
    adjustments,
    dispatchCompare,
    finalPreviewUrl,
    histogram,
    proofRevision,
    references,
    spatialAnalysis,
    selectedImage,
    setReferences,
    setEditor,
  } = useEditorStore(
    useShallow((state) => ({
      adjustmentSnapshot: state.adjustmentSnapshot,
      adjustmentRevision: state.adjustmentRevision,
      adjustments: state.editDocumentV2,
      dispatchCompare: state.dispatchCompare,
      finalPreviewUrl: state.finalPreviewUrl,
      histogram: state.histogram,
      proofRevision: state.proofRevision,
      references: state.referenceMatchReferences,
      spatialAnalysis: state.referenceMatchSpatialAnalysis,
      selectedImage: state.selectedImage,
      setReferences: state.setReferenceMatchReferences,
      setEditor: state.setEditor,
    })),
  );
  const [proposal, setProposal] = useState<ReferenceMatchProposal | null>(null);
  const proposalRef = useRef(proposal);
  proposalRef.current = proposal;
  const [impact, setImpact] = useState(100);
  const [enabledGroups, setEnabledGroups] = useState<Set<ReferenceMatchGroup>>(() => new Set(GROUPS));
  const [applyAbstention, setApplyAbstention] = useState<string | null>(null);
  const targetSummary = useMemo(
    () =>
      summarizeReferenceHistogram(histogram, spatialAnalysis?.path === selectedImage?.path ? spatialAnalysis : null),
    [histogram, selectedImage?.path, spatialAnalysis],
  );
  const currentRenderUrl = finalPreviewUrl ?? selectedImage?.originalUrl ?? null;
  const isCurrentReference = references.some((reference) => reference.path === selectedImage?.path);
  const canCapture = Boolean(
    selectedImage?.isReady && currentRenderUrl && targetSummary && references.length < 8 && !isCurrentReference,
  );
  const canReplace = Boolean(selectedImage?.isReady && currentRenderUrl && targetSummary && !isCurrentReference);
  const candidateReferences = selectedImage
    ? references.filter((reference) => reference.path !== selectedImage.path && reference.availability === 'available')
    : [];
  const canNormalize = Boolean(
    targetSummary && selectReferenceMatchReferences(candidateReferences, 'normalize').length > 0,
  );
  const canMatchLook = Boolean(
    targetSummary && selectReferenceMatchReferences(candidateReferences, 'match-look').length > 0,
  );
  const layerCompatibility = useMemo(
    () => (proposal ? getReferenceMatchLayerCompatibility(proposal, enabledGroups) : null),
    [enabledGroups, proposal],
  );
  const referenceAvailabilityKey = references.map((reference) => `${reference.id}:${reference.path}`).join('|');

  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window) || referenceAvailabilityKey.length === 0)
      return;
    const snapshot = useEditorStore.getState().referenceMatchReferences;
    let cancelled = false;
    void Promise.all(
      snapshot.map(
        async (reference): Promise<[string, ReferencePhysicalSourceIdentity | null]> => [
          reference.path,
          await resolveSourceIdentity(reference.path),
        ],
      ),
    ).then((results) => {
      if (!cancelled) setReferences((current) => mergeReferenceSourceIdentities(current, new Map(results)));
    });
    return () => {
      cancelled = true;
    };
  }, [referenceAvailabilityKey, setReferences]);

  useEffect(() => {
    setProposal(null);
  }, [adjustmentRevision, selectedImage?.path]);

  useEffect(() => {
    if (!proposal || !selectedImage) {
      setEditor({ referenceMatchPreview: null });
      return;
    }
    setEditor({
      referenceMatchPreview: {
        baseAdjustmentRevision: adjustmentRevision,
        editDocumentV2: applyReferenceMatchProposalToEditDocument({
          document: adjustments,
          enabledGroups,
          impact,
          proposal,
        }),
        enabledGroups: [...enabledGroups].sort(),
        impact,
        proposalFingerprint: proposal.proposalFingerprint,
        targetPath: selectedImage.path,
      },
    });
  }, [adjustmentRevision, adjustments, enabledGroups, impact, proposal, selectedImage, setEditor]);

  useEffect(
    () => () => {
      useEditorStore.getState().setEditor({ referenceMatchPreview: null });
    },
    [],
  );

  const captureCurrent = async (replaceId?: string) => {
    if (!selectedImage || !currentRenderUrl || !targetSummary || (replaceId ? !canReplace : !canCapture)) return;
    const sourceIdentity = await resolveSourceIdentity(selectedImage.path);
    if (!sourceIdentity?.available || sourceIdentity.sourceRevision === null) return;
    const sourceRevision = sourceIdentity.sourceRevision;
    const captured = {
      availability: 'available',
      adjustmentRevision,
      cameraProfile: selectEditDocumentNode(adjustments, 'camera_input').params['cameraProfile'],
      geometryFingerprint: fingerprintReferenceMatchValue(
        `${selectedImage.path}:geometry:${String(adjustmentSnapshot.geometryRevision)}`,
      ),
      geometryRevision: adjustmentSnapshot.geometryRevision,
      graphFingerprint: fingerprintReferenceMatchValue(`${selectedImage.path}:graph:${String(adjustmentRevision)}`),
      id: `${selectedImage.path}:${String(adjustmentRevision)}:${String(proofRevision)}`,
      label: describeReferenceMatchSource(selectedImage.path).label,
      path: selectedImage.path,
      proofFingerprint: fingerprintReferenceMatchValue(`proof:${String(proofRevision)}`),
      proofRevision,
      renderUrl: currentRenderUrl,
      role: 'creative',
      sourceFingerprint: fingerprintReferenceMatchValue(sourceRevision),
      sourceRevision,
      summary: targetSummary,
      viewFingerprint: fingerprintReferenceMatchValue(
        JSON.stringify({
          toneMapper: selectEditDocumentNode(adjustments, 'scene_to_view_transform').params['toneMapper'],
          viewTransform: selectEditDocumentNode(adjustments, 'scene_to_view_transform').params['viewTransform'],
        }),
      ),
      weight: 1,
    } as const;
    setReferences((current) => {
      if (!replaceId) return [...current, captured];
      return current.map((reference) =>
        reference.id === replaceId ? { ...captured, role: reference.role, weight: reference.weight } : reference,
      );
    });
    if (replaceId && useEditorStore.getState().compare.source.identity === replaceId) {
      dispatchCompare({ identity: captured.id, label: captured.label, type: 'set-reference-source' });
    }
    setProposal(null);
  };

  const analyze = (mode: ReferenceMatchProposal['mode']) => {
    if (!targetSummary || !selectedImage) return;
    const nextProposal = createReferenceMatchProposal({
      adjustments: selectReferenceMatchGlobalAdjustments(adjustments),
      mode,
      references: candidateReferences,
      target: targetSummary,
      targetProfile: selectEditDocumentNode(adjustments, 'camera_input').params['cameraProfile'],
      targetProofFingerprint: fingerprintReferenceMatchValue(`proof:${String(proofRevision)}`),
    });
    setProposal(nextProposal);
    setEnabledGroups(new Set(nextProposal?.diffs.map((diff) => diff.group) ?? []));
    setImpact(100);
    setApplyAbstention(null);
  };

  const reportStaleApply = () => {
    setApplyAbstention(
      t('editor.adjustments.referenceMatch.applyIdentityChanged', {
        defaultValue: 'A reference changed after analysis. Re-analyze before applying.',
      }),
    );
  };

  const revalidateBeforeApply = async (candidate: ReferenceMatchProposal): Promise<boolean> => {
    const snapshot = useEditorStore.getState().referenceMatchReferences;
    const effectiveFingerprints = new Set(
      candidate.effectiveReferences.map((reference) => reference.sourceFingerprint),
    );
    const effectiveSources = snapshot.filter((reference) => effectiveFingerprints.has(reference.sourceFingerprint));
    const resolved = await Promise.all(
      effectiveSources.map(
        async (reference): Promise<[string, ReferencePhysicalSourceIdentity | null]> => [
          reference.path,
          await resolveSourceIdentity(reference.path),
        ],
      ),
    );
    const validation = validateReferenceMatchApplicationIdentities(
      candidate,
      useEditorStore.getState().referenceMatchReferences,
      new Map(resolved),
    );
    if (!validation.valid) {
      reportStaleApply();
      return false;
    }
    setApplyAbstention(null);
    return true;
  };

  return (
    <section
      className="shrink-0 border-b border-editor-divider bg-editor-panel-well px-2 py-2"
      data-testid="reference-match-panel"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-text-primary">
          <GitCompareArrows aria-hidden="true" size={14} />
          <span>{t('editor.adjustments.referenceMatch.title', { defaultValue: 'Reference Match' })}</span>
        </div>
        <div className="flex items-center gap-1">
          {references.length > 0 && (
            <button
              className="rounded border border-editor-border px-1.5 py-1 text-[10px] text-text-tertiary hover:text-editor-danger"
              data-testid="reference-match-clear"
              onClick={() => {
                setReferences([]);
                setProposal(null);
                dispatchCompare({ identity: selectedImage?.path ?? null, type: 'set-original-source' });
                dispatchCompare({ type: 'exit' });
              }}
              type="button"
            >
              {t('editor.adjustments.referenceMatch.clear', { defaultValue: 'Clear' })}
            </button>
          )}
          <button
            className="inline-flex items-center gap-1 rounded border border-editor-border px-1.5 py-1 text-[11px] text-text-secondary enabled:hover:border-editor-focus-ring enabled:hover:text-text-primary disabled:opacity-40"
            data-testid="reference-match-capture"
            disabled={!canCapture}
            onClick={() => void captureCurrent()}
            title={isCurrentReference ? 'This image is already pinned as a reference' : 'Pin current rendered look'}
            type="button"
          >
            <Plus size={12} />
            {t('editor.adjustments.referenceMatch.setCurrent', { defaultValue: 'Set current' })}
          </button>
        </div>
      </div>

      {references.length === 0 ? (
        <p className="text-[11px] leading-4 text-text-secondary">
          {t('editor.adjustments.referenceMatch.empty', {
            defaultValue:
              'Pin a finished image, navigate to a target, then normalize tone or propose an inspectable look match.',
          })}
        </p>
      ) : (
        <div className="space-y-1" data-testid="reference-match-tray">
          {references.map((reference) => (
            <div
              className="grid grid-cols-[2.5rem_minmax(0,1fr)_2.75rem_1.5rem_1.5rem_4rem_1.25rem] items-center gap-1 rounded border border-editor-border bg-editor-panel px-1.5 py-1"
              data-reference-path={reference.path}
              key={reference.id}
            >
              <img
                alt={t('editor.adjustments.referenceMatch.referencePreviewAlt', {
                  defaultValue: 'Cached reference preview for {{name}}',
                  name: reference.label,
                })}
                className="h-9 w-10 rounded border border-editor-border bg-editor-panel-well object-cover"
                data-testid="reference-match-thumbnail"
                draggable={false}
                src={reference.renderUrl}
              />
              <div className="min-w-0">
                <div className="truncate text-[11px] font-medium text-text-primary">{reference.label}</div>
                <div className="truncate font-mono text-[9px] text-text-tertiary">
                  {t('editor.adjustments.referenceMatch.sourceRevision', {
                    defaultValue: 'CM preview · r{{revision}}',
                    revision: reference.adjustmentRevision,
                  })}
                </div>
                {describeReferenceMatchSource(reference.path).virtualCopyId && (
                  <div className="truncate text-[9px] text-editor-accent" data-testid="reference-match-virtual-copy">
                    {t('editor.adjustments.referenceMatch.virtualCopyState', {
                      copy: describeReferenceMatchSource(reference.path).virtualCopyId,
                      defaultValue: 'Virtual copy · {{copy}}',
                    })}
                  </div>
                )}
                <label className="mt-0.5 flex items-center gap-1 text-[9px] text-text-secondary">
                  {t('editor.adjustments.referenceMatch.role', { defaultValue: 'Role' })}
                  <select
                    aria-label={`Role for ${reference.label}`}
                    className="min-w-0 rounded border border-editor-border bg-editor-panel-well px-1 py-0.5 text-[9px] text-text-primary"
                    data-testid="reference-match-role"
                    onChange={(event) => {
                      const role = event.currentTarget.value === 'technical' ? 'technical' : 'creative';
                      setReferences((current) =>
                        current.map((item) => (item.id === reference.id ? { ...item, role } : item)),
                      );
                      setProposal(null);
                    }}
                    value={reference.role}
                  >
                    <option value="creative">
                      {t('editor.adjustments.referenceMatch.creativeRole', { defaultValue: 'Creative' })}
                    </option>
                    <option value="technical">
                      {t('editor.adjustments.referenceMatch.technicalRole', { defaultValue: 'Technical authority' })}
                    </option>
                  </select>
                </label>
                {reference.availability !== 'available' && (
                  <div className="truncate text-[9px] text-editor-warning" data-testid="reference-match-availability">
                    {reference.availability === 'missing'
                      ? t('editor.adjustments.referenceMatch.missingCachedReference', {
                          defaultValue: 'Original missing · cached preview only',
                        })
                      : reference.availability === 'replaced'
                        ? t('editor.adjustments.referenceMatch.replacedCachedReference', {
                            defaultValue: 'Source replaced · cached preview excluded from matching',
                          })
                        : t('editor.adjustments.referenceMatch.unknownReferenceAvailability', {
                            defaultValue: 'Source availability unknown',
                          })}
                  </div>
                )}
              </div>
              <button
                className="rounded border border-editor-border px-1 py-0.5 text-[9px] text-text-secondary hover:border-editor-focus-ring hover:text-text-primary"
                data-testid="reference-match-compare"
                onClick={() => {
                  dispatchCompare({ identity: reference.id, label: reference.label, type: 'set-reference-source' });
                  dispatchCompare({ mode: 'side-by-side', type: 'set-mode' });
                }}
                type="button"
              >
                {t('editor.adjustments.referenceMatch.compare', { defaultValue: 'Compare' })}
              </button>
              <button
                aria-label={`Reveal ${reference.label} in library`}
                className="text-text-tertiary hover:text-text-primary"
                data-testid="reference-match-reveal"
                onClick={() => {
                  useLibraryStore.getState().setLibrary({
                    libraryActivePath: reference.path,
                    multiSelectedPaths: [reference.path],
                    selectionAnchorPath: reference.path,
                  });
                  useUIStore.getState().setUI({ activeView: 'library' });
                }}
                title={t('editor.adjustments.referenceMatch.revealReferenceInLibrary', {
                  defaultValue: 'Reveal in library',
                })}
                type="button"
              >
                <FolderSearch aria-hidden="true" size={12} />
              </button>
              <button
                aria-label={`Replace ${reference.label} with current image`}
                className="text-text-tertiary enabled:hover:text-text-primary disabled:opacity-40"
                data-testid="reference-match-replace"
                disabled={!canReplace}
                onClick={() => void captureCurrent(reference.id)}
                title={t('editor.adjustments.referenceMatch.replaceReference', {
                  defaultValue: 'Replace with current image',
                })}
                type="button"
              >
                <RefreshCw aria-hidden="true" size={12} />
              </button>
              <label className="flex items-center gap-1 text-[9px] text-text-secondary">
                {t('editor.adjustments.referenceMatch.weight', { defaultValue: 'Weight' })}
                <input
                  aria-label={`Weight for ${reference.label}`}
                  className="w-8 rounded border border-editor-border bg-editor-panel-well px-1 py-0.5 text-right text-[10px] text-text-primary"
                  max={10}
                  min={0.1}
                  onChange={(event) => {
                    const weight = Number(event.currentTarget.value);
                    if (!Number.isFinite(weight) || weight <= 0) return;
                    setReferences((current) =>
                      current.map((item) => (item.id === reference.id ? { ...item, weight } : item)),
                    );
                    setProposal(null);
                  }}
                  step={0.1}
                  type="number"
                  value={reference.weight}
                />
              </label>
              <button
                aria-label={`Remove ${reference.label}`}
                className="text-text-tertiary hover:text-editor-danger"
                onClick={() => {
                  setReferences((current) => current.filter((item) => item.id !== reference.id));
                  if (useEditorStore.getState().compare.source.identity === reference.id) {
                    dispatchCompare({ identity: selectedImage?.path ?? null, type: 'set-original-source' });
                    dispatchCompare({ type: 'exit' });
                  }
                  setProposal(null);
                }}
                type="button"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 grid grid-cols-2 gap-1">
        <button
          className="rounded border border-editor-border px-2 py-1 text-[11px] font-medium text-text-secondary enabled:hover:border-editor-focus-ring enabled:hover:text-text-primary disabled:opacity-40"
          data-testid="reference-match-normalize"
          disabled={!canNormalize}
          onClick={() => analyze('normalize')}
          type="button"
        >
          {t('editor.adjustments.referenceMatch.normalize', { defaultValue: 'Normalize' })}
        </button>
        <button
          className="rounded border border-editor-focus-ring bg-editor-selected-quiet px-2 py-1 text-[11px] font-medium text-editor-selected-quiet-text disabled:opacity-40"
          data-testid="reference-match-propose"
          disabled={!canMatchLook}
          onClick={() => analyze('match-look')}
          type="button"
        >
          {t('editor.adjustments.referenceMatch.matchLook', { defaultValue: 'Match Look' })}
        </button>
      </div>

      {proposal && (
        <div className="mt-2 space-y-2 border-t border-editor-divider pt-2" data-testid="reference-match-proposal">
          <div className="flex items-center justify-between text-[10px] text-text-secondary">
            <span>{proposal.mode === 'normalize' ? 'Technical normalization' : 'Creative look proposal'}</span>
            <span className="font-mono">
              {t('editor.adjustments.referenceMatch.confidence', {
                defaultValue: '{{percent}}% confidence',
                percent: Math.round(proposal.confidence * 100),
              })}
            </span>
          </div>
          <div className="text-[9px] text-text-tertiary" data-testid="reference-match-effective-references">
            {proposal.effectiveReferences
              .map((reference) =>
                t('editor.adjustments.referenceMatch.effectiveReferenceContribution', {
                  defaultValue: '{{role}} {{percent}}%',
                  percent: Math.round(reference.weight * 100),
                  role:
                    reference.role === 'technical'
                      ? t('editor.adjustments.referenceMatch.technicalRole', { defaultValue: 'Technical authority' })
                      : t('editor.adjustments.referenceMatch.creativeRole', { defaultValue: 'Creative' }),
                }),
              )
              .join(' · ')}
          </div>
          <div className="flex flex-wrap gap-1">
            {GROUPS.filter((group) => proposal.diffs.some((diff) => diff.group === group)).map((group) => (
              <label className="inline-flex items-center gap-1 text-[10px] capitalize text-text-secondary" key={group}>
                <input
                  checked={enabledGroups.has(group)}
                  onChange={(event) => {
                    setEnabledGroups((current) => {
                      const next = new Set(current);
                      if (event.currentTarget.checked) next.add(group);
                      else next.delete(group);
                      return next;
                    });
                  }}
                  type="checkbox"
                />
                {group}
              </label>
            ))}
          </div>
          <label className="grid grid-cols-[2.5rem_minmax(0,1fr)_2rem] items-center gap-1 text-[10px] text-text-secondary">
            {t('editor.adjustments.referenceMatch.impact', { defaultValue: 'Impact' })}
            <input
              aria-label="Reference match impact"
              data-testid="reference-match-impact"
              max={100}
              min={0}
              onChange={(event) => setImpact(Number(event.currentTarget.value))}
              type="range"
              value={impact}
            />
            <span className="text-right font-mono">{impact}%</span>
          </label>
          <div className="max-h-28 space-y-0.5 overflow-y-auto rounded border border-editor-border bg-editor-panel px-1.5 py-1 font-mono text-[9px]">
            {proposal.diffs.map((diff) => (
              <div className="flex justify-between gap-2" data-group={diff.group} key={diff.key}>
                <span className="text-text-secondary">{diff.key}</span>
                <span className="text-text-primary">
                  {diff.current.toFixed(2)} → {diff.proposed.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
          <div className="text-[9px] text-text-tertiary">
            {t('editor.adjustments.referenceMatch.residualSummary', {
              after: proposal.residualAfter.toFixed(3),
              before: proposal.residualBefore.toFixed(3),
              defaultValue: 'Residual {{before}} → {{after}} · profile, WB, geometry and detail remain unchanged',
            })}
          </div>
          {proposal.warnings.map((warning) => (
            <div className="text-[9px] text-editor-warning" key={warning} role="status">
              {warning}
            </div>
          ))}
          {applyAbstention && (
            <div className="text-[9px] text-editor-warning" data-testid="reference-match-apply-abstention" role="alert">
              {applyAbstention}
            </div>
          )}
          {layerCompatibility && !layerCompatibility.supported && (
            <div
              className="text-[9px] text-editor-warning"
              data-testid="reference-match-layer-abstention"
              role="status"
            >
              {t('editor.adjustments.referenceMatch.layerUnsupported', {
                defaultValue:
                  'Layer apply unavailable for selected nodes: {{nodes}}. Disable those groups or apply globally.',
                nodes: layerCompatibility.unsupportedKeys.join(', '),
              })}
            </div>
          )}
          <div className="grid grid-cols-3 gap-1">
            <button
              className="inline-flex items-center justify-center gap-1 rounded border border-editor-border px-2 py-1 text-[11px] text-text-secondary"
              onClick={() => setProposal(null)}
              type="button"
            >
              <X size={11} />
              {t('editor.adjustments.referenceMatch.cancel', { defaultValue: 'Cancel' })}
            </button>
            <button
              className="rounded border border-editor-focus-ring px-2 py-1 text-[11px] font-semibold text-text-primary disabled:opacity-40"
              data-testid="reference-match-apply-layer"
              disabled={
                enabledGroups.size === 0 || proposal.diffs.length === 0 || layerCompatibility?.supported !== true
              }
              onClick={() =>
                void (async () => {
                  const identity = captureReferenceMatchCommitIdentity(useEditorStore.getState(), proposal);
                  if (identity === null || !(await revalidateBeforeApply(proposal))) return;
                  if (proposalRef.current?.proposalFingerprint !== identity.proposalFingerprint) {
                    reportStaleApply();
                    return;
                  }
                  const layerId = crypto.randomUUID();
                  try {
                    const state = useEditorStore.getState();
                    const commit = buildReferenceMatchLayerEditTransaction({
                      enabledGroups,
                      identity,
                      impact,
                      layerId,
                      layerName: proposal.mode === 'normalize' ? 'Reference Normalize' : 'Reference Match',
                      proposal,
                      state,
                      transactionId: crypto.randomUUID(),
                    });
                    if (commit === null) {
                      setProposal(null);
                      return;
                    }
                    state.applyEditTransaction(commit.request);
                    setEditor({
                      activeMaskContainerId: layerId,
                      lastReferenceMatchApplicationReceipt: commit.receipt,
                    });
                    setProposal(null);
                  } catch {
                    reportStaleApply();
                  }
                })()
              }
              type="button"
            >
              {t('editor.adjustments.referenceMatch.newLayerDestination', { defaultValue: 'New layer' })}
            </button>
            <button
              className="rounded bg-editor-accent px-2 py-1 text-[11px] font-semibold text-editor-accent-text disabled:opacity-40"
              data-testid="reference-match-apply"
              disabled={enabledGroups.size === 0 || proposal.diffs.length === 0}
              onClick={() =>
                void (async () => {
                  const identity = captureReferenceMatchCommitIdentity(useEditorStore.getState(), proposal);
                  if (identity === null || !(await revalidateBeforeApply(proposal))) return;
                  if (proposalRef.current?.proposalFingerprint !== identity.proposalFingerprint) {
                    reportStaleApply();
                    return;
                  }
                  try {
                    const state = useEditorStore.getState();
                    const commit = buildReferenceMatchGlobalEditTransaction({
                      enabledGroups,
                      identity,
                      impact,
                      proposal,
                      state,
                      transactionId: crypto.randomUUID(),
                    });
                    if (commit === null) {
                      setProposal(null);
                      return;
                    }
                    state.applyEditTransaction(commit.request);
                    setEditor({ lastReferenceMatchApplicationReceipt: commit.receipt });
                    setProposal(null);
                  } catch {
                    reportStaleApply();
                  }
                })()
              }
              type="button"
            >
              {t('editor.adjustments.referenceMatch.apply', { defaultValue: 'Apply once' })}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
