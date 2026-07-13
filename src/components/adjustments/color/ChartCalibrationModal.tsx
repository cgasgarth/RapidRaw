import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChartCalibration } from '../../../hooks/editor/useChartCalibration';
import type {
  CalibrationFitReceipt,
  ChartGeometry,
  IlluminantCoordinates,
} from '../../../schemas/color/chartCalibrationSchemas';
import { editorChromeTokens } from '../../ui/editorChromeTokens';

const DEFAULT_GEOMETRY: ChartGeometry = {
  corners: [
    { x: 0.15, y: 0.2 },
    { x: 0.85, y: 0.2 },
    { x: 0.85, y: 0.8 },
    { x: 0.15, y: 0.8 },
  ],
  mirrored: false,
};

interface ChartCalibrationModalProps {
  firstEndpoint: CalibrationFitReceipt | null;
  onClose: () => void;
  onEndpointSaved: (receipt: CalibrationFitReceipt) => void;
  onPublished: (profileId: string) => void;
  open: boolean;
  sourcePath: string | null;
}

export const ChartCalibrationModal = ({
  firstEndpoint,
  onClose,
  onEndpointSaved,
  onPublished,
  open,
  sourcePath,
}: ChartCalibrationModalProps) => {
  const { t } = useTranslation();
  const calibration = useChartCalibration(sourcePath);
  const [geometry, setGeometry] = useState(DEFAULT_GEOMETRY);
  const [profileName, setProfileName] = useState('Measured ColorChecker');
  const [illuminant, setIlluminant] = useState<IlluminantCoordinates>({
    x: 0.3127,
    y: 0.329,
    cctKelvin: 6504,
    duv: 0,
  });
  const [publish, setPublish] = useState(false);
  const [confirmWarning, setConfirmWarning] = useState(false);
  useEffect(() => {
    if (!open) {
      void calibration.cancel();
      calibration.reset();
    }
  }, [calibration.cancel, calibration.reset, open]);
  if (!open) return null;

  const updateCorner = (index: number, axis: 'x' | 'y', value: number) => {
    setGeometry((previous) => ({
      ...previous,
      corners: previous.corners.map((corner, cornerIndex) =>
        cornerIndex === index ? { ...corner, [axis]: Math.min(1, Math.max(0, value)) } : corner,
      ) as ChartGeometry['corners'],
    }));
  };
  const fit = async () => {
    const result = await calibration.fit({
      confirmWarning,
      illuminant,
      profileName,
      publish,
    });
    if (result.publishedProfileId !== null) onPublished(result.publishedProfileId);
  };
  const combine = async () => {
    if (firstEndpoint === null || calibration.result === null) return;
    const combined = await calibration.combine(firstEndpoint, calibration.result.receipt, profileName, confirmWarning);
    onPublished(combined.publishedProfileId);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      data-testid="chart-calibration-modal"
    >
      <section
        aria-label={t('adjustments.color.profileTone.calibration.dialogLabel')}
        aria-modal="true"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded border border-editor-border bg-editor-panel p-4 shadow-2xl"
        role="dialog"
      >
        <header className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">
              {t('adjustments.color.profileTone.calibration.title')}
            </h2>
            <p className="mt-1 text-[11px] text-text-secondary">
              {t('adjustments.color.profileTone.calibration.description')}
            </p>
          </div>
          <button
            aria-label={t('adjustments.color.profileTone.calibration.close')}
            className="px-2 text-text-secondary"
            onClick={() => {
              void calibration.cancel();
              onClose();
            }}
            type="button"
          >
            ×
          </button>
        </header>

        <ol className="mb-3 grid grid-cols-3 gap-2 text-[10px]" data-testid="chart-calibration-steps">
          <li className="rounded bg-white/5 px-2 py-1">{t('adjustments.color.profileTone.calibration.stepPlace')}</li>
          <li className="rounded bg-white/5 px-2 py-1">{t('adjustments.color.profileTone.calibration.stepQuality')}</li>
          <li className="rounded bg-white/5 px-2 py-1">{t('adjustments.color.profileTone.calibration.stepFit')}</li>
        </ol>

        <fieldset className="rounded border border-editor-border p-3">
          <legend className="px-1 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
            {t('adjustments.color.profileTone.calibration.corners')}
          </legend>
          <p className="mb-2 text-[10px] text-text-secondary">
            {t('adjustments.color.profileTone.calibration.cornerHelp')}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {geometry.corners.map((corner, index) => (
              <div className="rounded bg-black/10 p-2" key={`corner-${index}`}>
                <div className="mb-1 text-[9px] text-text-tertiary">
                  {t('adjustments.color.profileTone.calibration.corner', { index: index + 1 })}
                </div>
                {(['x', 'y'] as const).map((axis) => (
                  <label className="mb-1 grid grid-cols-[1rem_1fr] items-center gap-1 text-[10px]" key={axis}>
                    <span>{axis.toUpperCase()}</span>
                    <input
                      aria-label={`Corner ${index + 1} ${axis}`}
                      className={editorChromeTokens.input.base}
                      max={1}
                      min={0}
                      onChange={(event) => updateCorner(index, axis, Number(event.target.value))}
                      step={0.001}
                      type="number"
                      value={corner[axis]}
                    />
                  </label>
                ))}
              </div>
            ))}
          </div>
          <label className="mt-2 flex items-center gap-2 text-[10px] text-text-secondary">
            <input
              checked={geometry.mirrored}
              onChange={(event) => setGeometry((previous) => ({ ...previous, mirrored: event.target.checked }))}
              type="checkbox"
            />
            {t('adjustments.color.profileTone.calibration.mirrored')}
          </label>
          <button
            className="mt-3 rounded bg-editor-accent px-3 py-1.5 text-[11px] text-white disabled:opacity-50"
            data-testid="chart-sample-button"
            disabled={calibration.running || sourcePath === null}
            onClick={() => void calibration.sample(geometry).catch(() => undefined)}
            type="button"
          >
            {calibration.running && calibration.sampling === null ? 'Sampling RAW…' : 'Sample technical RAW patches'}
          </button>
        </fieldset>

        {calibration.sampling !== null && (
          <section className="mt-3 rounded border border-editor-border p-3" data-testid="chart-capture-quality">
            <h3 className="text-[11px] font-semibold">{t('adjustments.color.profileTone.calibration.quality')}</h3>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] sm:grid-cols-4">
              <div>
                <dt className="text-text-tertiary">{t('adjustments.color.profileTone.calibration.status')}</dt>
                <dd data-accepted={calibration.sampling.captureQuality.accepted} data-testid="chart-quality-status">
                  {calibration.sampling.captureQuality.accepted ? 'Accepted' : 'Blocked'}
                </dd>
              </div>
              <div>
                <dt className="text-text-tertiary">{t('adjustments.color.profileTone.calibration.chartArea')}</dt>
                <dd>{(calibration.sampling.captureQuality.chartAreaFraction * 100).toFixed(1)}%</dd>
              </div>
              <div>
                <dt className="text-text-tertiary">{t('adjustments.color.profileTone.calibration.maxClipping')}</dt>
                <dd>{(calibration.sampling.captureQuality.maximumClippedFraction * 100).toFixed(2)}%</dd>
              </div>
              <div>
                <dt className="text-text-tertiary">{t('adjustments.color.profileTone.calibration.minSharpness')}</dt>
                <dd>{calibration.sampling.captureQuality.minimumPatchSharpness.toFixed(4)}</dd>
              </div>
            </dl>
            {calibration.sampling.captureQuality.warningCodes.length > 0 && (
              <ul className="mt-2 list-disc pl-4 text-[10px] text-editor-warning">
                {calibration.sampling.captureQuality.warningCodes.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
              <input
                aria-label="Generated profile name"
                className={editorChromeTokens.input.base}
                onChange={(event) => setProfileName(event.target.value)}
                value={profileName}
              />
              <label className="flex items-center gap-1 text-[10px]">
                <input
                  checked={publish}
                  data-testid="chart-publish-profile"
                  onChange={(event) => setPublish(event.target.checked)}
                  type="checkbox"
                />
                {t('adjustments.color.profileTone.calibration.publish')}
              </label>
              <button
                className="rounded bg-editor-accent px-3 py-1.5 text-[11px] text-white disabled:opacity-50"
                data-testid="chart-fit-button"
                disabled={calibration.running || profileName.trim().length === 0}
                onClick={() => void fit().catch(() => undefined)}
                type="button"
              >
                {t('adjustments.color.profileTone.calibration.fit')}
              </button>
            </div>
            <fieldset className="mt-2 grid grid-cols-2 gap-2 rounded bg-black/10 p-2 sm:grid-cols-4">
              <legend className="px-1 text-[9px] text-text-tertiary">
                {t('adjustments.color.profileTone.calibration.illuminant')}
              </legend>
              {(['x', 'y', 'cctKelvin', 'duv'] as const).map((field) => (
                <label className="text-[9px] text-text-secondary" key={field}>
                  <span className="block">{field === 'cctKelvin' ? 'CCT K' : field.toUpperCase()}</span>
                  <input
                    aria-label={`Illuminant ${field}`}
                    className={editorChromeTokens.input.base}
                    onChange={(event) =>
                      setIlluminant((previous) => ({ ...previous, [field]: Number(event.target.value) }))
                    }
                    step={field === 'cctKelvin' ? 1 : 0.0001}
                    type="number"
                    value={illuminant[field] ?? ''}
                  />
                </label>
              ))}
            </fieldset>
            <label className="mt-2 flex items-center gap-1 text-[10px] text-text-secondary">
              <input
                checked={confirmWarning}
                onChange={(event) => setConfirmWarning(event.target.checked)}
                type="checkbox"
              />
              {t('adjustments.color.profileTone.calibration.confirmWarning')}
            </label>
          </section>
        )}

        {calibration.result !== null && (
          <section className="mt-3 rounded border border-editor-border p-3" data-testid="chart-fit-result">
            <h3 className="text-[11px] font-semibold">
              {calibration.result.receipt.qualityStatus.replaceAll('_', ' ')}
            </h3>
            <p
              className="mt-1 text-[10px] text-text-secondary"
              data-mean-delta-e={calibration.result.receipt.validationMetrics.meanDeltaE00}
              data-testid="chart-fit-metrics"
            >
              {t('adjustments.color.profileTone.calibration.metrics', {
                mean: calibration.result.receipt.validationMetrics.meanDeltaE00.toFixed(2),
                p95: calibration.result.receipt.validationMetrics.p95DeltaE00.toFixed(2),
                max: calibration.result.receipt.validationMetrics.maxDeltaE00.toFixed(2),
              })}
            </p>
            <p className="mt-1 text-[9px] text-text-tertiary">{calibration.result.receipt.solverFingerprint}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                className="rounded border border-editor-border px-2 py-1 text-[10px]"
                disabled={calibration.result.receipt.qualityStatus.startsWith('failed_')}
                onClick={() => {
                  if (calibration.result !== null) onEndpointSaved(calibration.result.receipt);
                }}
                type="button"
              >
                {t('adjustments.color.profileTone.calibration.saveEndpoint')}
              </button>
              {firstEndpoint !== null &&
                firstEndpoint.solverFingerprint !== calibration.result.receipt.solverFingerprint && (
                  <button
                    className="rounded bg-editor-accent px-2 py-1 text-[10px] text-white"
                    onClick={() => void combine().catch(() => undefined)}
                    type="button"
                  >
                    {t('adjustments.color.profileTone.calibration.combine')}
                  </button>
                )}
            </div>
          </section>
        )}
        {calibration.errorCode !== null && (
          <p className="mt-3 text-[10px] text-editor-warning" role="alert">
            {calibration.errorCode}
          </p>
        )}
      </section>
    </div>
  );
};
