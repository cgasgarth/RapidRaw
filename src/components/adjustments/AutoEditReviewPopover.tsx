import { Check, CircleAlert, LoaderCircle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AutoEditGroup, AutoEditProposalV1 } from '../../schemas/autoEditSchemas';

const GROUP_LABEL_KEYS = {
  atmosphere: 'editor.adjustments.autoEdit.groups.atmosphere',
  color: 'editor.adjustments.autoEdit.groups.color',
  detail: 'editor.adjustments.autoEdit.groups.detail',
  geometry: 'editor.adjustments.autoEdit.groups.geometry',
  light: 'editor.adjustments.autoEdit.groups.light',
  technical_white_balance: 'editor.adjustments.autoEdit.groups.whiteBalance',
} as const satisfies Record<AutoEditGroup, string>;

interface AutoEditReviewPopoverProps {
  error: string | null;
  impact: number;
  isAnalyzing: boolean;
  isApplying: boolean;
  onApply: () => void;
  onApplyHighConfidence: () => void;
  onCancel: () => void;
  onCompareEnd: () => void;
  onCompareStart: () => void;
  onImpactChange: (impact: number) => void;
  onResetProposal: () => void;
  onToggleGroup: (group: AutoEditGroup) => void;
  proposal: AutoEditProposalV1 | null;
  selectedGroups: ReadonlySet<AutoEditGroup>;
}

export function AutoEditReviewPopover({
  error,
  impact,
  isAnalyzing,
  isApplying,
  onApply,
  onApplyHighConfidence,
  onCancel,
  onCompareEnd,
  onCompareStart,
  onImpactChange,
  onResetProposal,
  onToggleGroup,
  proposal,
  selectedGroups,
}: AutoEditReviewPopoverProps) {
  const { t } = useTranslation();
  const recommendations = proposal?.recommendations ?? [];
  const canApply = proposal !== null && selectedGroups.size > 0 && !isApplying;

  return (
    <section
      aria-label={t('editor.adjustments.autoEdit.reviewLabel', { defaultValue: 'Auto Adjust review' })}
      aria-modal="false"
      className="absolute right-2 top-9 z-50 w-[min(23rem,calc(100vw-1rem))] rounded-lg border border-editor-border bg-editor-panel p-3 shadow-2xl"
      data-testid="auto-edit-review"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
      role="dialog"
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">
            {t('editor.adjustments.autoEdit.title', { defaultValue: 'Auto Adjust' })}
          </h2>
          <p className="text-[11px] text-text-secondary">
            {t('editor.adjustments.autoEdit.description', {
              defaultValue: 'Review scene-referred recommendations before applying.',
            })}
          </p>
        </div>
        <button
          aria-label={t('editor.adjustments.autoEdit.cancelLabel', { defaultValue: 'Cancel Auto Adjust' })}
          className="rounded p-1 hover:bg-white/10"
          onClick={onCancel}
          type="button"
        >
          <X aria-hidden="true" size={15} />
        </button>
      </header>

      {isAnalyzing && (
        <div className="flex items-center gap-2 py-5 text-xs text-text-secondary" role="status">
          <LoaderCircle aria-hidden="true" className="animate-spin" size={15} />
          {t('editor.adjustments.autoEdit.analyzing', {
            defaultValue: 'Analyzing authoritative scene pixels…',
          })}
        </div>
      )}

      {error && (
        <div
          className="flex items-start gap-2 rounded border border-editor-danger/40 bg-editor-danger-surface p-2 text-xs"
          role="alert"
        >
          <CircleAlert aria-hidden="true" className="mt-0.5 shrink-0 text-editor-danger" size={14} />
          <span>{error}</span>
        </div>
      )}

      {proposal && (
        <>
          <div
            className="space-y-1"
            role="group"
            aria-label={t('editor.adjustments.autoEdit.groupsLabel', { defaultValue: 'Auto adjustment groups' })}
          >
            {recommendations.map((recommendation) => {
              const selectable = recommendation.state === 'recommended';
              const checked = selectedGroups.has(recommendation.group);
              return (
                <label
                  className="grid grid-cols-[1.25rem_1fr_auto] items-center gap-2 rounded px-1.5 py-1.5 hover:bg-white/5"
                  key={recommendation.group}
                >
                  <input
                    checked={checked}
                    disabled={!selectable}
                    onChange={() => onToggleGroup(recommendation.group)}
                    type="checkbox"
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-text-primary">
                      {t(GROUP_LABEL_KEYS[recommendation.group])}
                    </span>
                    <span className="block truncate text-[10px] text-text-secondary">
                      {selectable
                        ? recommendation.evidenceCodes.join(' · ')
                        : t('editor.adjustments.autoEdit.unavailable', {
                            defaultValue: 'Not enough evidence or capability unavailable',
                          })}
                    </span>
                  </span>
                  <span
                    className={
                      recommendation.confidence >= 0.82
                        ? 'text-[10px] text-editor-success'
                        : 'text-[10px] text-text-secondary'
                    }
                  >
                    {Math.round(recommendation.confidence * 100)}%
                  </span>
                </label>
              );
            })}
          </div>

          <label className="mt-2 block text-xs text-text-secondary">
            <span className="flex justify-between">
              <span>{t('editor.adjustments.autoEdit.impact', { defaultValue: 'Impact' })}</span>
              <output>{Math.round(impact * 100)}%</output>
            </span>
            <input
              aria-label={t('editor.adjustments.autoEdit.impactLabel', { defaultValue: 'Auto Adjust impact' })}
              className="w-full accent-editor-accent"
              max={100}
              min={0}
              onChange={(event) => onImpactChange(Number(event.currentTarget.value) / 100)}
              step={1}
              type="range"
              value={Math.round(impact * 100)}
            />
          </label>

          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <button
              className="rounded border border-editor-border px-2 py-1.5 text-xs hover:bg-white/5"
              onPointerDown={onCompareStart}
              onPointerLeave={onCompareEnd}
              onPointerUp={onCompareEnd}
              type="button"
            >
              {t('editor.adjustments.autoEdit.holdBefore', { defaultValue: 'Hold for Before' })}
            </button>
            <button
              className="rounded border border-editor-border px-2 py-1.5 text-xs hover:bg-white/5"
              onClick={onResetProposal}
              type="button"
            >
              {t('editor.adjustments.autoEdit.resetProposal', { defaultValue: 'Reset Proposal' })}
            </button>
            <button
              className="rounded border border-editor-border px-2 py-1.5 text-xs hover:bg-white/5 disabled:opacity-40"
              disabled={isApplying}
              onClick={onApplyHighConfidence}
              type="button"
            >
              {t('editor.adjustments.autoEdit.highConfidenceOnly', { defaultValue: 'High confidence only' })}
            </button>
            <button
              className="flex items-center justify-center gap-1 rounded bg-editor-accent px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
              disabled={!canApply}
              onClick={onApply}
              type="button"
            >
              {isApplying ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" size={13} />
              ) : (
                <Check aria-hidden="true" size={13} />
              )}
              {t('editor.adjustments.autoEdit.apply', { defaultValue: 'Apply' })}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
