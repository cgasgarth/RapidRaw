import { RotateCcw } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { FilmStageControlDescriptorV1 } from '../../../packages/rawengine-schema/src/index.js';
import { clampFilmStageControlValue, isFilmStageControlModified } from '../../utils/film-look/filmStageControls';

interface FilmStageControlsProps {
  descriptors: FilmStageControlDescriptorV1[];
  onChange: (descriptor: FilmStageControlDescriptorV1, value: number) => void;
  onReset: (descriptor: FilmStageControlDescriptorV1) => void;
}

const formatValue = (value: unknown): string =>
  typeof value === 'number' ? value.toFixed(3).replace(/0+$/u, '').replace(/\.$/u, '') : String(value);

export function FilmStageControls({ descriptors, onChange, onReset }: FilmStageControlsProps) {
  const { t } = useTranslation();
  const stages = useMemo(() => [...new Set(descriptors.map((descriptor) => descriptor.stage))], [descriptors]);
  return (
    <div className="space-y-1" data-testid="film-stage-controls">
      {stages.map((stage) => {
        const stageDescriptors = descriptors.filter((descriptor) => descriptor.stage === stage);
        const stageModified = stageDescriptors.some(isFilmStageControlModified);
        return (
          <details className="rounded border border-editor-border bg-editor-panel" key={stage} open>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2 py-1.5 text-[11px] font-medium text-text-primary">
              <span>{stage.replace(/_v\d+$/u, '').replaceAll('_', ' ')}</span>
              <span className="flex items-center gap-1">
                <span
                  aria-label={stageModified ? 'Modified' : 'Profile default'}
                  className="rounded border border-editor-border px-1 py-0.5 text-[10px] text-text-tertiary"
                  data-stage-modified={stageModified}
                >
                  {stageModified ? 'Modified' : 'Default'}
                </span>
              </span>
            </summary>
            <div className="space-y-1 border-t border-editor-border px-2 py-1.5">
              {stageDescriptors.map((descriptor) => {
                const modified = isFilmStageControlModified(descriptor);
                const numericValue = typeof descriptor.currentValue === 'number' ? descriptor.currentValue : 0;
                const numericControl =
                  descriptor.control.kind === 'slider' || descriptor.control.kind === 'numeric'
                    ? descriptor.control
                    : null;
                const disabled = descriptor.editability === 'read_only' || numericControl === null;
                const label = t(descriptor.labelKey, { defaultValue: descriptor.labelKey });
                return (
                  <div className="space-y-1" data-parameter-id={descriptor.parameterId} key={descriptor.parameterId}>
                    <div className="flex items-center justify-between gap-2">
                      <label
                        className="text-[11px] text-text-secondary"
                        htmlFor={`film-stage-${descriptor.parameterId}`}
                      >
                        {label}
                      </label>
                      <span className="text-[10px] text-text-tertiary" data-evidence-class={descriptor.evidenceClass}>
                        {descriptor.evidenceClass}
                      </span>
                    </div>
                    {numericControl !== null ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          aria-label={`${label} slider`}
                          className="min-w-0 flex-1 accent-accent"
                          disabled={disabled}
                          id={`film-stage-${descriptor.parameterId}`}
                          max={numericControl.max}
                          min={numericControl.min}
                          onChange={(event) => onChange(descriptor, Number(event.target.value))}
                          step={numericControl.step}
                          type="range"
                          value={numericValue}
                        />
                        <input
                          aria-label={`${label} value`}
                          className="w-16 rounded border border-editor-border bg-editor-panel px-1 py-0.5 text-right font-mono text-[11px] tabular-nums text-text-primary"
                          disabled={disabled}
                          inputMode="decimal"
                          max={numericControl.max}
                          min={numericControl.min}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            if (Number.isFinite(value))
                              onChange(descriptor, clampFilmStageControlValue(descriptor, value));
                          }}
                          step={numericControl.step}
                          type="number"
                          value={formatValue(numericValue)}
                        />
                        <span className="w-4 text-[10px] text-text-tertiary">{numericControl.unit}</span>
                      </div>
                    ) : (
                      <span className="text-[11px] text-text-tertiary">{formatValue(descriptor.currentValue)}</span>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] leading-4 text-text-tertiary">
                        {t(descriptor.descriptionKey, { defaultValue: descriptor.descriptionKey })}
                      </span>
                      {modified && descriptor.resetScope === 'parameter' && (
                        <button
                          aria-label={`${t('common.reset', { defaultValue: 'Reset' })} ${label}`}
                          className="inline-flex shrink-0 items-center gap-1 rounded border border-editor-border px-1.5 py-0.5 text-[10px] text-text-secondary hover:bg-editor-panel-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring"
                          onClick={() => onReset(descriptor)}
                          type="button"
                        >
                          <RotateCcw size={11} /> {t('common.reset', { defaultValue: 'Reset' })}
                        </button>
                      )}
                    </div>
                    {descriptor.warningCodes.length > 0 && (
                      <p className="text-[10px] text-editor-warning" role="status">
                        {descriptor.warningCodes.join(', ')}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}

export default FilmStageControls;
