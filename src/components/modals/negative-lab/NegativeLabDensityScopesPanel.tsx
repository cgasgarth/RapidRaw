import { useTranslation } from 'react-i18next';
import type { NegativeLabRuntimePreviewRenderResultV1 } from '../../../../packages/rawengine-schema/src';

type DensityScopes = NonNullable<NegativeLabRuntimePreviewRenderResultV1['densityScopes']>;

const buildPolyline = (points: DensityScopes['hAndDCurve']): string => {
  if (points.length === 0) return '';
  const inputMin = Math.min(...points.map((point) => point.inputDensity));
  const inputMax = Math.max(...points.map((point) => point.inputDensity), inputMin + 0.001);
  const outputMin = Math.min(...points.map((point) => point.outputLuma));
  const outputMax = Math.max(...points.map((point) => point.outputLuma), outputMin + 0.001);
  return points
    .map((point, index) => {
      const x = (index / Math.max(1, points.length - 1)) * 100;
      const y = 100 - ((point.outputLuma - outputMin) / (outputMax - outputMin)) * 100;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
};

const Histogram = ({ bins, testId }: { bins: number[]; testId: string }) => {
  const maximum = Math.max(1, ...bins);
  return (
    <div className="flex h-12 items-end gap-px" data-testid={testId}>
      {bins.map((bin, index) => (
        <span
          className="min-w-0 flex-1 rounded-t-sm bg-accent/70"
          data-bin-index={index}
          key={index}
          style={{ height: `${(bin / maximum) * 100}%` }}
        />
      ))}
    </div>
  );
};

export function NegativeLabDensityScopesPanel({ scopes }: { scopes: DensityScopes | null }) {
  const { t } = useTranslation();
  if (scopes === null) return null;

  return (
    <section
      className="space-y-2 rounded-md border border-surface bg-bg-primary p-2 text-xs"
      data-algorithm-id={scopes.algorithmId}
      data-sample-count={scopes.sampleCount}
      data-testid="negative-lab-density-scopes"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-text-primary">{t('modals.negativeConversion.densityScopes.title')}</h3>
        <span className="text-[10px] text-text-tertiary">
          {t('modals.negativeConversion.densityScopes.nativeVersion', { version: scopes.schemaVersion })}
        </span>
      </div>
      <svg
        aria-label="Native H&D density curve"
        className="h-20 w-full overflow-visible rounded bg-bg-secondary p-1"
        data-testid="negative-lab-density-scopes-curve"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <polyline fill="none" points={buildPolyline(scopes.hAndDCurve)} stroke="currentColor" strokeWidth="2" />
      </svg>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-text-tertiary">
        <span>{t('modals.negativeConversion.densityScopes.densityInput')}</span>
        <span className="text-right tabular-nums">
          {scopes.densityHistogram.min.toFixed(3)} – {scopes.densityHistogram.max.toFixed(3)}
        </span>
        <span>{t('modals.negativeConversion.densityScopes.outputLuma')}</span>
        <span className="text-right tabular-nums">
          {scopes.outputLumaHistogram.min.toFixed(3)} – {scopes.outputLumaHistogram.max.toFixed(3)}
        </span>
        <span>{t('modals.negativeConversion.densityScopes.clippedGamut')}</span>
        <span className="text-right tabular-nums">
          {scopes.clippedPixelCount} / {scopes.gamutOutOfRangePixelCount}
        </span>
      </div>
      <div className="space-y-1">
        <span className="text-[10px] uppercase tracking-wide text-text-tertiary">
          {t('modals.negativeConversion.densityScopes.densityHistogram')}
        </span>
        <Histogram bins={scopes.densityHistogram.bins} testId="negative-lab-density-histogram" />
        <span className="text-[10px] uppercase tracking-wide text-text-tertiary">
          {t('modals.negativeConversion.densityScopes.outputLumaHistogram')}
        </span>
        <Histogram bins={scopes.outputLumaHistogram.bins} testId="negative-lab-output-luma-histogram" />
      </div>
    </section>
  );
}
