import cx from 'clsx';
import { useTranslation } from 'react-i18next';

import type { NegativeLabRuntimeProfileBrowserRow } from '../../../schemas/negative-lab/negativeLabMeasuredProfileSchemas';
import type { NegativeLabProfileComparisonRow } from '../../../schemas/negative-lab/negativeLabProfileComparisonSchemas';
import { TextVariants } from '../../../types/typography';
import UiText from '../../ui/primitives/Text';

export interface NegativeLabRenderedProfileCandidatePreview {
  baseSampleId: string;
  identicalOutputReason: string | null;
  imageHash: `fnv1a32:${string}`;
  previewHash: `fnv1a32:${string}`;
  renderError: string | null;
  status: 'blocked' | 'failed' | 'ready' | 'rendering';
  url: string | null;
}

interface NegativeLabProfileComparisonGridProps {
  browsedProfileId: string | null;
  onBrowseProfile: (profileId: string) => void;
  onUseProfile: (profile: NegativeLabRuntimeProfileBrowserRow) => void;
  renderedPreviewByProfileId: Readonly<Record<string, NegativeLabRenderedProfileCandidatePreview>>;
  rows: NegativeLabProfileComparisonRow[];
  selectedProfileProvenanceHash: string | null;
  selectedPresetId: string;
  totalProfileCount: number;
}

export function NegativeLabProfileComparisonGrid({
  browsedProfileId,
  onBrowseProfile,
  onUseProfile,
  renderedPreviewByProfileId,
  rows,
  selectedProfileProvenanceHash,
  selectedPresetId,
  totalProfileCount,
}: NegativeLabProfileComparisonGridProps) {
  const { t } = useTranslation();
  const activeFrameLabel = rows[0]?.frameScope.activeFrameLabel ?? '';
  const browsedRow = rows.find((candidate) => candidate.profile.presetId === browsedProfileId) ?? rows[0] ?? null;

  return (
    <div
      className="mb-3 rounded-md border border-surface bg-bg-primary p-3"
      data-active-frame={activeFrameLabel}
      data-candidate-count={rows.length}
      data-queued-count={rows[0]?.frameScope.queuedCount ?? 0}
      data-selected-profile-id={selectedPresetId}
      data-selected-profile-provenance-hash={selectedProfileProvenanceHash ?? ''}
      data-testid="negative-lab-profile-comparison-matrix"
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <UiText variant={TextVariants.small} className="font-semibold text-text-primary">
            {t('modals.negativeConversion.workflowPreset')}
          </UiText>
          <UiText variant={TextVariants.small} className="text-text-tertiary">
            {t('modals.negativeConversion.profileResultCount', {
              totalCount: totalProfileCount,
              visibleCount: rows.length,
            })}
          </UiText>
        </div>
        <span
          className="rounded border border-surface bg-bg-secondary px-2 py-1 text-[11px] text-text-secondary"
          data-testid="negative-lab-profile-comparison-active-frame"
        >
          {activeFrameLabel}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2">
        {rows.map((candidate) => {
          const profile = candidate.profile;
          const isSelected = selectedPresetId === profile.presetId;
          const isBrowsed = browsedRow?.profile.presetId === profile.presetId;
          const renderedPreview = renderedPreviewByProfileId[profile.presetId] ?? null;
          const effectivePreviewHash = renderedPreview?.previewHash ?? candidate.renderEvidence.previewHash;
          const effectiveRenderHash = renderedPreview?.imageHash ?? candidate.renderEvidence.renderHash;

          return (
            <div
              className={cx(
                'rounded-md border p-2 text-left transition-colors',
                isBrowsed
                  ? 'border-accent bg-accent/10 text-text-primary'
                  : 'border-surface bg-bg-secondary text-text-secondary hover:bg-surface',
              )}
              data-base-sample-reference={candidate.renderEvidence.baseSampleReference}
              data-claim-policy={profile.claimPolicy}
              data-comparison-preview={candidate.previewSwatch.deltaCss}
              data-delta-summary={candidate.deltaSummary}
              data-density-algorithm={candidate.renderEvidence.densityAlgorithm}
              data-evidence-fixture-count={profile.evidenceFixtureCount}
              data-identical-output-reason={renderedPreview?.identicalOutputReason ?? ''}
              data-image-hash={renderedPreview?.imageHash ?? ''}
              data-metric-hash={candidate.renderEvidence.metricHash}
              data-mutation-browsing-mutates-edit-graph={String(candidate.mutationSafety.browsingMutatesEditGraph)}
              data-mutation-requires-accepted-plan={String(candidate.mutationSafety.requiresAcceptedPlanForApply)}
              data-output-tag={candidate.renderEvidence.outputTag}
              data-preview-hash={effectivePreviewHash}
              data-preview-render-status={renderedPreview?.status ?? 'metadata_only'}
              data-print-curve-version={candidate.renderEvidence.printCurveVersion}
              data-profile-provenance-hash={candidate.selectedProfileSnapshot.profileProvenanceHash}
              data-profile-status={profile.profileStatus}
              data-render-error={renderedPreview?.renderError ?? ''}
              data-render-hash={effectiveRenderHash}
              data-runtime-status={profile.runtimeStatus}
              data-runtime-apply-selectable={String(candidate.mutationSafety.selectableForRuntimeApply)}
              data-selected={String(isSelected)}
              data-warning-codes={candidate.renderEvidence.warningCodes.join(',')}
              data-testid={`negative-lab-profile-comparison-row-${profile.presetId}`}
              key={profile.presetId}
            >
              <button
                aria-pressed={isBrowsed}
                className="block w-full text-left"
                data-testid={`negative-lab-profile-comparison-browse-${profile.presetId}`}
                onClick={() => {
                  onBrowseProfile(profile.presetId);
                }}
                type="button"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-xs font-semibold">{profile.displayName}</span>
                  <span
                    className="shrink-0 rounded border border-surface bg-bg-primary px-2 py-0.5 text-[10px]"
                    data-testid={`negative-lab-profile-comparison-claim-${profile.presetId}`}
                  >
                    {profile.claimLevel === 'measured_profile'
                      ? t('modals.negativeConversion.presetClaimMeasured')
                      : profile.claimLevel === 'user_profile'
                        ? t('modals.negativeConversion.presetClaimUser')
                        : t('modals.negativeConversion.presetClaimGeneric')}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="mt-2 block h-24 overflow-hidden rounded border border-surface bg-bg-primary"
                  data-base-sample-id={renderedPreview?.baseSampleId ?? candidate.renderEvidence.baseSampleReference}
                  data-preview-candidate-color={candidate.previewSwatch.candidateCss}
                  data-preview-current-color={candidate.previewSwatch.currentCss}
                  data-preview-image-hash={renderedPreview?.imageHash ?? ''}
                  data-preview-tone-bias={candidate.previewSwatch.toneBias}
                  data-rendered-positive-preview={renderedPreview?.url !== null && renderedPreview?.url !== undefined}
                  data-testid={`negative-lab-profile-comparison-preview-${profile.presetId}`}
                  style={{ background: candidate.previewSwatch.deltaCss }}
                >
                  {renderedPreview?.url !== null && renderedPreview?.url !== undefined ? (
                    <img
                      alt=""
                      className="h-full w-full object-cover"
                      data-testid={`negative-lab-profile-comparison-rendered-preview-${profile.presetId}`}
                      src={renderedPreview.url}
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center bg-bg-secondary px-2 text-center text-[10px] text-text-tertiary">
                      {renderedPreview?.status === 'failed'
                        ? t('modals.negativeConversion.previewFailed')
                        : t('modals.negativeConversion.previewRendering')}
                    </span>
                  )}
                </span>
              </button>
              <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-text-tertiary">
                <span data-testid={`negative-lab-profile-comparison-runtime-${profile.presetId}`}>
                  {profile.runtimeStatus === 'runtime_parameter_applied'
                    ? t('modals.negativeConversion.presetRuntimeApplied')
                    : t('modals.negativeConversion.presetRuntimeCatalogOnly')}
                </span>
                <span data-testid={`negative-lab-profile-comparison-evidence-${profile.presetId}`}>
                  {t('modals.negativeConversion.profileEvidenceCount', {
                    fixtureCount: profile.evidenceFixtureCount,
                  })}
                </span>
                <span data-testid={`negative-lab-profile-comparison-warning-count-${profile.presetId}`}>
                  {t('modals.negativeConversion.qcProofArtifactWarnings', {
                    warningCount: candidate.renderEvidence.warningCodes.length,
                  })}
                </span>
              </div>
              <span
                className="mt-1 block truncate text-[10px] text-text-tertiary"
                data-testid={`negative-lab-profile-comparison-delta-${profile.presetId}`}
              >
                {candidate.deltaSummary}
              </span>
              <span
                className="mt-1 block truncate text-[10px] text-text-tertiary"
                data-testid={`negative-lab-profile-comparison-nonclaim-${profile.presetId}`}
              >
                {profile.doesNotProve.join(', ')}
              </span>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span
                  className="min-w-0 truncate text-[10px] text-text-tertiary"
                  data-testid={`negative-lab-profile-comparison-render-hash-${profile.presetId}`}
                >
                  {candidate.renderEvidence.renderHash}
                </span>
                <button
                  className="shrink-0 rounded border border-surface bg-bg-primary px-2 py-1 text-[10px] text-text-secondary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid={`negative-lab-profile-comparison-use-${profile.presetId}`}
                  disabled={!candidate.mutationSafety.selectableForRuntimeApply}
                  onClick={() => {
                    onUseProfile(profile);
                  }}
                  type="button"
                >
                  {t('modals.negativeConversion.stockMetadataUseSuggestedPreset', {
                    presetName: profile.displayName,
                  })}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
