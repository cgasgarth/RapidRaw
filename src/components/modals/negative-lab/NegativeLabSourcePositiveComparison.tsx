import cx from 'clsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { usePreviewViewport } from '../../../hooks/viewport/usePreviewViewport';
import {
  buildNegativeLabSourcePositiveComparisonProof,
  type NegativeLabSourcePositiveComparisonMode,
} from '../../../schemas/negative-lab/negativeLabSourcePositiveComparisonSchemas';
import type { NegativeLabBeforeAfterReviewModel } from './NegativeConversionModal';

type ComparisonViewport = Pick<
  ReturnType<typeof usePreviewViewport>,
  'containerRef' | 'handleMouseDown' | 'handleWheel' | 'imageTransformStyle'
>;

interface NegativeLabSourcePositiveComparisonProps {
  finalUrl: string | null;
  isLoading: boolean;
  onModeChange?: (mode: NegativeLabSourcePositiveComparisonMode) => void;
  onProofChange?: (proof: ReturnType<typeof buildNegativeLabSourcePositiveComparisonProof>) => void;
  proofModel: NegativeLabBeforeAfterReviewModel | null;
  recipeHash: string;
  sourceUrl: string | null;
  viewport: ComparisonViewport;
}

const modeOptions: ReadonlyArray<{
  id: NegativeLabSourcePositiveComparisonMode;
  label: 'beforeAfterGeneratedPositive' | 'beforeAfterReview' | 'beforeAfterSourceNegative' | 'originalLabel';
}> = [
  { id: 'final', label: 'beforeAfterGeneratedPositive' },
  { id: 'side_by_side', label: 'beforeAfterReview' },
  { id: 'split', label: 'beforeAfterSourceNegative' },
  { id: 'hold_source', label: 'originalLabel' },
];

export function NegativeLabSourcePositiveComparison({
  finalUrl,
  isLoading,
  onModeChange,
  onProofChange,
  proofModel,
  recipeHash,
  sourceUrl,
  viewport,
}: NegativeLabSourcePositiveComparisonProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<NegativeLabSourcePositiveComparisonMode>('final');
  const [splitPosition, setSplitPosition] = useState(0.5);
  const [isHoldingSource, setIsHoldingSource] = useState(false);
  const effectiveMode = isHoldingSource ? 'hold_source' : mode;

  const proof = useMemo(() => {
    if (proofModel === null) return null;
    return buildNegativeLabSourcePositiveComparisonProof({
      final: {
        artifactId: proofModel.generatedPositiveArtifactId,
        contentHash: proofModel.generatedPositiveContentHash,
        dimensions: proofModel.generatedPositiveDimensions,
      },
      finalUrlReady: finalUrl !== null,
      mode: effectiveMode,
      planHash: proofModel.acceptedDryRunPlanHash,
      recipeHash,
      source: {
        artifactId: proofModel.sourceNegativeArtifactId,
        contentHash: proofModel.sourceNegativeContentHash,
        dimensions: proofModel.sourceNegativeDimensions,
        path: proofModel.sourceNegativePath,
      },
      sourceUrlReady: sourceUrl !== null,
      warningCodes: proofModel.warningCodes,
    });
  }, [effectiveMode, finalUrl, proofModel, recipeHash, sourceUrl]);

  useEffect(() => {
    if (proof !== null) onProofChange?.(proof);
  }, [onProofChange, proof]);

  const setComparisonMode = useCallback(
    (nextMode: NegativeLabSourcePositiveComparisonMode) => {
      setMode(nextMode);
      setIsHoldingSource(false);
      onModeChange?.(nextMode);
    },
    [onModeChange],
  );

  const imageClassName = 'block max-h-full max-w-full object-contain shadow-2xl';
  const imageLabel =
    effectiveMode === 'hold_source'
      ? t('modals.negativeConversion.originalLabel')
      : t('modals.negativeConversion.beforeAfterGeneratedPositive');

  return (
    <div
      className="absolute inset-0"
      data-alignment-crop={proof?.alignment.crop ?? 'warning'}
      data-alignment-orientation={proof?.alignment.orientation ?? 'warning'}
      data-comparison-mode={effectiveMode}
      data-final-content-hash={proof?.final.contentHash ?? ''}
      data-recipe-hash={recipeHash}
      data-source-content-hash={proof?.source.contentHash ?? ''}
      data-testid="negative-lab-source-positive-comparison"
      data-warning-codes={proof?.warningCodes.join('|') ?? 'comparison_metadata_pending'}
    >
      <div
        ref={viewport.containerRef}
        className="relative flex h-full w-full select-none items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing"
        role="presentation"
        onMouseDown={viewport.handleMouseDown}
        onWheel={viewport.handleWheel}
      >
        <div
          className="absolute inset-0 opacity-20 pointer-events-none"
          style={{ backgroundImage: 'radial-gradient(#444 1px, transparent 1px)', backgroundSize: '24px 24px' }}
        />
        {isLoading && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/20" role="status">
            {t('modals.negativeConversion.previewPending')}
          </div>
        )}
        {sourceUrl === null && finalUrl === null && !isLoading && (
          <div className="px-8 text-center text-sm text-white/65" data-testid="negative-lab-comparison-pending">
            {t('modals.negativeConversion.previewPending')}
          </div>
        )}
        {(sourceUrl !== null || finalUrl !== null) && (
          <div
            className="origin-center"
            data-testid="negative-lab-preview-image-layer"
            style={viewport.imageTransformStyle}
          >
            {effectiveMode === 'side_by_side' ? (
              <div className="flex max-h-[90vh] max-w-[95vw] items-center gap-2">
                <ComparisonPane
                  alt={t('modals.negativeConversion.beforeAfterSourceNegative')}
                  className={imageClassName}
                  label={t('modals.negativeConversion.beforeAfterSourceNegative')}
                  src={sourceUrl}
                />
                <ComparisonPane
                  alt={t('modals.negativeConversion.beforeAfterGeneratedPositive')}
                  className={imageClassName}
                  label={t('modals.negativeConversion.beforeAfterGeneratedPositive')}
                  src={finalUrl}
                  testId="negative-lab-preview-image"
                />
              </div>
            ) : effectiveMode === 'split' ? (
              <div className="relative max-h-[90vh] max-w-[95vw]">
                <ComparisonPane
                  alt={t('modals.negativeConversion.beforeAfterGeneratedPositive')}
                  className={imageClassName}
                  label={t('modals.negativeConversion.beforeAfterGeneratedPositive')}
                  src={finalUrl}
                  testId="negative-lab-preview-image"
                />
                <div
                  className="absolute inset-0 overflow-hidden"
                  style={{ clipPath: `inset(0 ${Math.round((1 - splitPosition) * 100)}% 0 0)` }}
                >
                  <ComparisonPane
                    alt={t('modals.negativeConversion.beforeAfterSourceNegative')}
                    className={imageClassName}
                    label={t('modals.negativeConversion.beforeAfterSourceNegative')}
                    src={sourceUrl}
                  />
                </div>
              </div>
            ) : (
              <ComparisonPane
                alt={imageLabel}
                className={imageClassName}
                label={imageLabel}
                src={effectiveMode === 'hold_source' ? sourceUrl : finalUrl}
                testId={effectiveMode === 'hold_source' ? undefined : 'negative-lab-preview-image'}
              />
            )}
          </div>
        )}
        {effectiveMode === 'split' && (
          <input
            aria-label={t('modals.negativeConversion.beforeAfterSourceNegative')}
            className="absolute bottom-20 left-1/2 z-20 w-48 -translate-x-1/2 accent-accent"
            data-testid="negative-lab-comparison-split-position"
            max="1"
            min="0"
            onChange={(event) => setSplitPosition(Number(event.currentTarget.value))}
            step="0.01"
            type="range"
            value={splitPosition}
          />
        )}
        <div
          className="absolute left-3 top-3 z-20 rounded bg-black/65 px-2 py-1 text-[10px] uppercase tracking-wide text-white/90"
          data-testid="negative-lab-comparison-visible-label"
        >
          {imageLabel}
        </div>
        <div
          className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-black/70 p-1.5 backdrop-blur-md"
          role="toolbar"
        >
          {modeOptions.map((option) => (
            <button
              aria-pressed={effectiveMode === option.id}
              className={cx(
                'rounded-full px-2 py-1 text-[10px] text-white/75 transition-colors hover:bg-white/10 hover:text-white',
                effectiveMode === option.id && 'bg-accent text-button-text',
              )}
              data-testid={`negative-lab-comparison-mode-${option.id}`}
              key={option.id}
              onClick={option.id === 'hold_source' ? undefined : () => setComparisonMode(option.id)}
              onPointerDown={option.id === 'hold_source' ? () => setIsHoldingSource(true) : undefined}
              onPointerLeave={option.id === 'hold_source' ? () => setIsHoldingSource(false) : undefined}
              onPointerUp={option.id === 'hold_source' ? () => setIsHoldingSource(false) : undefined}
              type="button"
            >
              {t(`modals.negativeConversion.${option.label}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ComparisonPane({
  alt,
  className,
  label,
  src,
  testId,
}: {
  alt: string;
  className: string;
  label: string;
  src: string | null;
  testId?: string | undefined;
}) {
  return (
    <div className="relative flex min-h-16 min-w-16 items-center justify-center">
      {src === null ? (
        <span className="text-xs text-white/50">{label}</span>
      ) : (
        <img alt={alt} className={className} data-testid={testId} draggable={false} src={src} />
      )}
      {src !== null && (
        <span className="absolute left-2 top-2 rounded bg-black/65 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/90">
          {label}
        </span>
      )}
    </div>
  );
}
