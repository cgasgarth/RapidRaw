import { GitCompareArrows, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { matchLookApplicationReceiptV1Schema } from '../../../packages/rawengine-schema/src/referenceMatchRuntime';

import { useEditorActions } from '../../hooks/editor/useEditorActions';
import { useEditorStore } from '../../store/useEditorStore';
import {
  applyReferenceMatchProposal,
  createReferenceMatchAdjustmentLayer,
  createReferenceMatchProposal,
  fingerprintReferenceMatchValue,
  getReferenceMatchLayerCompatibility,
  type ReferenceMatchGroup,
  type ReferenceMatchProposal,
  summarizeReferenceHistogram,
} from '../../utils/referenceMatch';

const GROUPS: ReferenceMatchGroup[] = ['tone', 'color', 'presence'];

const fileLabel = (path: string): string => path.split(/[\\/]/).pop() || path;

export default function ReferenceMatchPanel() {
  const { t } = useTranslation();
  const { setAdjustments } = useEditorActions();
  const {
    adjustmentSnapshot,
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
      adjustments: state.adjustments,
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
  const [impact, setImpact] = useState(100);
  const [enabledGroups, setEnabledGroups] = useState<Set<ReferenceMatchGroup>>(() => new Set(GROUPS));
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
  const canAnalyze = Boolean(
    targetSummary && selectedImage && references.some((reference) => reference.path !== selectedImage.path),
  );
  const layerCompatibility = useMemo(
    () => (proposal ? getReferenceMatchLayerCompatibility(proposal, enabledGroups) : null),
    [enabledGroups, proposal],
  );

  useEffect(() => {
    setProposal(null);
  }, [adjustmentSnapshot.adjustmentRevision, selectedImage?.path]);

  useEffect(() => {
    if (!proposal || !selectedImage) {
      setEditor({ referenceMatchPreview: null });
      return;
    }
    setEditor({
      referenceMatchPreview: {
        adjustments: applyReferenceMatchProposal({ adjustments, enabledGroups, impact, proposal }),
        baseAdjustmentRevision: adjustmentSnapshot.adjustmentRevision,
        enabledGroups: [...enabledGroups].sort(),
        impact,
        proposalFingerprint: proposal.proposalFingerprint,
        targetPath: selectedImage.path,
      },
    });
  }, [adjustmentSnapshot.adjustmentRevision, adjustments, enabledGroups, impact, proposal, selectedImage, setEditor]);

  useEffect(
    () => () => {
      useEditorStore.getState().setEditor({ referenceMatchPreview: null });
    },
    [],
  );

  const captureCurrent = () => {
    if (!selectedImage || !currentRenderUrl || !targetSummary || !canCapture) return;
    setReferences((current) => [
      ...current,
      {
        adjustmentRevision: adjustmentSnapshot.adjustmentRevision,
        cameraProfile: adjustments.cameraProfile,
        geometryFingerprint: fingerprintReferenceMatchValue(
          `${selectedImage.path}:geometry:${String(adjustmentSnapshot.geometryRevision)}`,
        ),
        geometryRevision: adjustmentSnapshot.geometryRevision,
        graphFingerprint: fingerprintReferenceMatchValue(
          `${selectedImage.path}:graph:${String(adjustmentSnapshot.adjustmentRevision)}`,
        ),
        id: `${selectedImage.path}:${String(adjustmentSnapshot.adjustmentRevision)}:${String(proofRevision)}`,
        label: fileLabel(selectedImage.path),
        path: selectedImage.path,
        proofFingerprint: fingerprintReferenceMatchValue(`proof:${String(proofRevision)}`),
        proofRevision,
        renderUrl: currentRenderUrl,
        sourceFingerprint: fingerprintReferenceMatchValue(selectedImage.path),
        summary: targetSummary,
        viewFingerprint: fingerprintReferenceMatchValue(
          JSON.stringify({ toneMapper: adjustments.toneMapper, viewTransform: adjustments.viewTransform }),
        ),
        weight: 1,
      },
    ]);
    setProposal(null);
  };

  const analyze = (mode: ReferenceMatchProposal['mode']) => {
    if (!targetSummary || !selectedImage) return;
    const nextProposal = createReferenceMatchProposal({
      adjustments,
      mode,
      references: references.filter((reference) => reference.path !== selectedImage.path),
      target: targetSummary,
      targetProfile: adjustments.cameraProfile,
      targetProofFingerprint: fingerprintReferenceMatchValue(`proof:${String(proofRevision)}`),
    });
    setProposal(nextProposal);
    setEnabledGroups(new Set(nextProposal?.diffs.map((diff) => diff.group) ?? []));
    setImpact(100);
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
            onClick={captureCurrent}
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
              className="grid grid-cols-[minmax(0,1fr)_2.75rem_4rem_1.25rem] items-center gap-1 rounded border border-editor-border bg-editor-panel px-1.5 py-1"
              data-reference-path={reference.path}
              key={reference.id}
            >
              <div className="min-w-0">
                <div className="truncate text-[11px] font-medium text-text-primary">{reference.label}</div>
                <div className="truncate font-mono text-[9px] text-text-tertiary">
                  {t('editor.adjustments.referenceMatch.sourceRevision', {
                    defaultValue: 'CM preview · r{{revision}}',
                    revision: reference.adjustmentRevision,
                  })}
                </div>
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
          disabled={!canAnalyze}
          onClick={() => analyze('normalize')}
          type="button"
        >
          {t('editor.adjustments.referenceMatch.normalize', { defaultValue: 'Normalize' })}
        </button>
        <button
          className="rounded border border-editor-focus-ring bg-editor-selected-quiet px-2 py-1 text-[11px] font-medium text-editor-selected-quiet-text disabled:opacity-40"
          data-testid="reference-match-propose"
          disabled={!canAnalyze}
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
              onClick={() => {
                const current = useEditorStore.getState().adjustments;
                const layerId = crypto.randomUUID();
                const layerWithoutReceipt = createReferenceMatchAdjustmentLayer({
                  enabledGroups,
                  id: layerId,
                  impact,
                  name: proposal.mode === 'normalize' ? 'Reference Normalize' : 'Reference Match',
                  proposal,
                });
                const receipt = matchLookApplicationReceiptV1Schema.parse({
                  appliedAt: new Date().toISOString(),
                  destination: 'adjustment-layer',
                  enabledGroups: [...enabledGroups].sort(),
                  historyEntriesAdded: 1,
                  impact,
                  layerId,
                  proposalFingerprint: proposal.proposalFingerprint,
                  resultingGraphFingerprint: fingerprintReferenceMatchValue(
                    JSON.stringify({
                      adjustments: layerWithoutReceipt.adjustments,
                      opacity: layerWithoutReceipt.opacity,
                    }),
                  ),
                  schemaVersion: 1,
                  targetAnalysisFingerprint: proposal.targetAnalysisFingerprint,
                });
                const layer = createReferenceMatchAdjustmentLayer({
                  enabledGroups,
                  id: layerId,
                  impact,
                  name: layerWithoutReceipt.name,
                  proposal,
                  receipt,
                });
                setAdjustments({ masks: [layer, ...current.masks] });
                setEditor({ activeMaskContainerId: layerId, lastReferenceMatchApplicationReceipt: receipt });
                setProposal(null);
              }}
              type="button"
            >
              {t('editor.adjustments.referenceMatch.newLayerDestination', { defaultValue: 'New layer' })}
            </button>
            <button
              className="rounded bg-editor-accent px-2 py-1 text-[11px] font-semibold text-editor-accent-text disabled:opacity-40"
              data-testid="reference-match-apply"
              disabled={enabledGroups.size === 0 || proposal.diffs.length === 0}
              onClick={() => {
                const current = useEditorStore.getState().adjustments;
                const applied = applyReferenceMatchProposal({
                  adjustments: current,
                  enabledGroups,
                  impact,
                  proposal,
                });
                const receipt = matchLookApplicationReceiptV1Schema.parse({
                  appliedAt: new Date().toISOString(),
                  destination: 'global-adjustments',
                  enabledGroups: [...enabledGroups].sort(),
                  historyEntriesAdded: 1,
                  impact,
                  proposalFingerprint: proposal.proposalFingerprint,
                  resultingGraphFingerprint: fingerprintReferenceMatchValue(
                    JSON.stringify(proposal.diffs.map((diff) => [diff.key, applied[diff.key]])),
                  ),
                  schemaVersion: 1,
                  targetAnalysisFingerprint: proposal.targetAnalysisFingerprint,
                });
                setAdjustments({ ...applied, referenceMatchApplicationReceipt: receipt });
                setEditor({
                  lastReferenceMatchApplicationReceipt: receipt,
                });
                setProposal(null);
              }}
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
