import cx from 'clsx';
import { ChevronDown, RotateCcw } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../../store/useEditorStore';
import {
  type Adjustments,
  ColorAdjustment,
  type ColorCalibration,
  INITIAL_ADJUSTMENTS,
} from '../../../utils/adjustments';
import {
  buildColorCalibrationEditTransaction,
  type ColorCalibrationCommitIdentity,
} from '../../../utils/colorCalibrationEditTransaction';
import { selectEditDocumentNode } from '../../../utils/editDocumentSelectors';
import { buildLevelsEditTransaction, type LevelsCommitIdentity } from '../../../utils/levelsEditTransaction';
import CompactInspectorSectionHeader from '../../ui/CompactInspectorSectionHeader';
import { professionalInspectorDensityTokens } from '../../ui/inspectorTokens';
import AdjustmentSlider from '../AdjustmentSlider';
import { ColorSwatch } from './ColorSwatch';
import type { ColorPanelGroupProps } from './types';

type LevelsNumericKey = Exclude<keyof Adjustments['levels'], 'enabled'>;

interface ColorAdvancedControlsProps extends ColorPanelGroupProps {
  adjustmentVisibility: Record<string, boolean>;
  isColorCalibrationVisible: boolean;
  levelsClippingWarnings: Array<string>;
  mode?: 'all' | 'calibration' | 'levels';
}

export const ColorAdvancedControls = ({
  adjustmentVisibility,
  adjustments,
  isColorCalibrationVisible,
  levelsClippingWarnings,
  mode = 'all',
  setAdjustments,
  onDragStateChange,
}: ColorAdvancedControlsProps) => {
  const { t } = useTranslation();
  const density = professionalInspectorDensityTokens;
  const [activePrimary, setActivePrimary] = useState('red');
  const adjustmentRevision = useEditorStore((state) => state.adjustmentRevision);
  const applyEditTransaction = useEditorStore((state) => state.applyEditTransaction);
  const imageSessionId = useEditorStore(
    (state) => state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
  );
  const selectedImagePath = useEditorStore((state) => state.selectedImage?.path ?? null);
  const authoritativeLevels = useEditorStore(
    (state) => selectEditDocumentNode(state.editDocumentV2, 'luma_levels').params['levels'],
  );
  const commitIdentity = useMemo<ColorCalibrationCommitIdentity | null>(
    () =>
      selectedImagePath !== null ? { adjustmentRevision, imageSessionId, sourceIdentity: selectedImagePath } : null,
    [adjustmentRevision, imageSessionId, selectedImagePath],
  );
  const commitIdentityRef = useRef(commitIdentity);
  commitIdentityRef.current = commitIdentity;
  const colorCalibration = adjustments.colorCalibration;
  const colorCalibrationRef = useRef(colorCalibration);
  colorCalibrationRef.current = colorCalibration;
  const levels = selectedImagePath === null ? adjustments.levels : authoritativeLevels;
  const levelsCommitIdentity = useMemo<LevelsCommitIdentity | null>(
    () =>
      selectedImagePath !== null ? { adjustmentRevision, imageSessionId, sourceIdentity: selectedImagePath } : null,
    [adjustmentRevision, imageSessionId, selectedImagePath],
  );
  const levelsCommitIdentityRef = useRef(levelsCommitIdentity);
  levelsCommitIdentityRef.current = levelsCommitIdentity;
  const levelsRef = useRef(levels);
  levelsRef.current = levels;
  const isLevelsVisible = mode !== 'calibration' && adjustmentVisibility[ColorAdjustment.Levels] !== false;
  const isCalibrationVisible = mode !== 'levels' && isColorCalibrationVisible;
  const inputBlackMax = Math.max(0, Math.min(99, Math.round(levels.inputWhite * 100) - 1));
  const inputWhiteMin = Math.min(100, Math.max(1, Math.round(levels.inputBlack * 100) + 1));
  const outputBlackMax = Math.max(0, Math.min(99, Math.round(levels.outputWhite * 100) - 1));
  const outputWhiteMin = Math.min(100, Math.max(1, Math.round(levels.outputBlack * 100) + 1));

  const primaryColors = useMemo(
    () => [
      { name: 'red', color: '#f87171', label: t('adjustments.color.calibration.colors.red') },
      { name: 'green', color: '#4ade80', label: t('adjustments.color.calibration.colors.green') },
      { name: 'blue', color: '#60a5fa', label: t('adjustments.color.calibration.colors.blue') },
    ],
    [t],
  );

  const commitColorCalibration = (nextColorCalibration: Adjustments['colorCalibration']) => {
    const identity = commitIdentityRef.current;
    if (identity === null) {
      colorCalibrationRef.current = nextColorCalibration;
      setAdjustments((previous) => ({ ...previous, colorCalibration: nextColorCalibration }));
      return;
    }
    const result = applyEditTransaction(
      buildColorCalibrationEditTransaction(
        useEditorStore.getState(),
        identity,
        nextColorCalibration,
        crypto.randomUUID(),
      ),
    );
    colorCalibrationRef.current = nextColorCalibration;
    commitIdentityRef.current = { ...identity, adjustmentRevision: result.nextAdjustmentRevision };
  };

  const handleShadowsChange = (value: number) => {
    commitColorCalibration({ ...colorCalibrationRef.current, shadowsTint: value });
  };

  const handlePrimaryChange = (key: 'Hue' | 'Saturation', value: number) => {
    const fullKey = `${activePrimary}${key}` as keyof ColorCalibration;
    commitColorCalibration({ ...colorCalibrationRef.current, [fullKey]: value });
  };

  const handleLevelsToggle = () => {
    commitLevels({ ...levelsRef.current, enabled: !levelsRef.current.enabled });
  };

  const handleLevelsChange = (key: LevelsNumericKey, value: number) => {
    commitLevels({ ...levelsRef.current, [key]: value });
  };

  const commitLevels = (nextLevels: Adjustments['levels']) => {
    const identity = levelsCommitIdentityRef.current;
    if (identity === null) return;
    const result = applyEditTransaction(
      buildLevelsEditTransaction(useEditorStore.getState(), identity, nextLevels, crypto.randomUUID()),
    );
    levelsRef.current = nextLevels;
    levelsCommitIdentityRef.current = { ...identity, adjustmentRevision: result.nextAdjustmentRevision };
  };

  const resetLevels = () => {
    commitLevels(structuredClone(INITIAL_ADJUSTMENTS.levels));
  };

  const currentValues = {
    hue: colorCalibration[`${activePrimary}Hue` as keyof ColorCalibration] || 0,
    saturation: colorCalibration[`${activePrimary}Saturation` as keyof ColorCalibration] || 0,
  };

  const trackSuffix = `${activePrimary}s`;
  const initialLevels = INITIAL_ADJUSTMENTS.levels;
  const isLevelsModified =
    levels.enabled !== initialLevels.enabled ||
    levels.inputBlack !== initialLevels.inputBlack ||
    levels.inputWhite !== initialLevels.inputWhite ||
    levels.gamma !== initialLevels.gamma ||
    levels.outputBlack !== initialLevels.outputBlack ||
    levels.outputWhite !== initialLevels.outputWhite;
  const isCalibrationModified = (Object.keys(colorCalibration) as Array<keyof ColorCalibration>).some(
    (key) => colorCalibration[key] !== INITIAL_ADJUSTMENTS.colorCalibration[key],
  );
  const activePrimaryLabel = primaryColors.find((primary) => primary.name === activePrimary)?.label ?? activePrimary;
  const modifiedLabel = t('ui.collapsibleSection.dirtyBadge', { defaultValue: 'Edited' });
  const disclosureTestId = mode === 'calibration' ? 'color-calibration-disclosure' : 'advanced-color-disclosure';
  const disclosureTitle =
    mode === 'calibration'
      ? t('adjustments.color.calibration.advancedTitle')
      : mode === 'levels'
        ? t('adjustments.color.advanced.levelsTitle')
        : t('adjustments.color.advanced.title');
  const disclosureSummary =
    mode === 'calibration'
      ? t('adjustments.color.calibration.advancedSummary')
      : mode === 'levels'
        ? t('adjustments.color.advanced.levelsSummary')
        : t('adjustments.color.advanced.summary');
  const isDisclosureModified = (isLevelsVisible && isLevelsModified) || (isCalibrationVisible && isCalibrationModified);

  return (
    <details className="group border-b border-editor-border" data-testid={disclosureTestId}>
      <summary className="cursor-pointer list-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring [&::-webkit-details-marker]:hidden">
        <CompactInspectorSectionHeader
          actions={
            <ChevronDown
              aria-hidden="true"
              className="text-text-secondary transition-transform group-open:rotate-180"
              size={14}
            />
          }
          modified={isDisclosureModified}
          modifiedLabel={modifiedLabel}
          summary={disclosureSummary}
          title={disclosureTitle}
        />
      </summary>
      <div
        className="divide-y divide-editor-border border-t border-editor-border"
        data-testid="advanced-color-controls"
      >
        {isLevelsVisible && (
          <section className="py-1.5" data-testid="color-levels-controls">
            <CompactInspectorSectionHeader
              actions={
                <div className="flex items-center gap-1">
                  <button
                    aria-label={t('adjustments.basic.reset')}
                    className={cx(density.actionButton.base, density.actionButton.icon, density.actionButton.quiet)}
                    data-testid="color-levels-reset"
                    disabled={!isLevelsModified}
                    onClick={resetLevels}
                    title={t('adjustments.basic.reset')}
                    type="button"
                  >
                    <RotateCcw aria-hidden="true" size={13} />
                  </button>
                  <button
                    aria-pressed={levels.enabled}
                    className={cx(
                      density.actionButton.base,
                      levels.enabled ? density.actionButton.active : density.actionButton.inactive,
                    )}
                    data-testid="color-levels-toggle"
                    onClick={handleLevelsToggle}
                    type="button"
                  >
                    {levels.enabled ? t('adjustments.color.levels.enabled') : t('adjustments.color.levels.disabled')}
                  </button>
                </div>
              }
              modified={isLevelsModified}
              modifiedLabel={modifiedLabel}
              title={t('adjustments.color.levels.title')}
            />
            <div className="space-y-px">
              <AdjustmentSlider
                defaultValue={Math.round(initialLevels.inputBlack * 100)}
                density="compact"
                label={t('adjustments.color.levels.inputBlack')}
                max={inputBlackMax}
                min={0}
                onValueChange={(value) => {
                  handleLevelsChange('inputBlack', value / 100);
                }}
                step={1}
                value={Math.round(levels.inputBlack * 100)}
                onDragStateChange={onDragStateChange}
              />
              <AdjustmentSlider
                defaultValue={Math.round(initialLevels.inputWhite * 100)}
                density="compact"
                label={t('adjustments.color.levels.inputWhite')}
                max={100}
                min={inputWhiteMin}
                onValueChange={(value) => {
                  handleLevelsChange('inputWhite', value / 100);
                }}
                step={1}
                value={Math.round(levels.inputWhite * 100)}
                onDragStateChange={onDragStateChange}
              />
              <AdjustmentSlider
                defaultValue={Math.round(initialLevels.gamma * 100)}
                density="compact"
                label={t('adjustments.color.levels.gamma')}
                max={300}
                min={25}
                onValueChange={(value) => {
                  handleLevelsChange('gamma', value / 100);
                }}
                step={1}
                value={Math.round(levels.gamma * 100)}
                onDragStateChange={onDragStateChange}
              />
              <AdjustmentSlider
                defaultValue={Math.round(initialLevels.outputBlack * 100)}
                density="compact"
                label={t('adjustments.color.levels.outputBlack')}
                max={outputBlackMax}
                min={0}
                onValueChange={(value) => {
                  handleLevelsChange('outputBlack', value / 100);
                }}
                step={1}
                value={Math.round(levels.outputBlack * 100)}
                onDragStateChange={onDragStateChange}
              />
              <AdjustmentSlider
                defaultValue={Math.round(initialLevels.outputWhite * 100)}
                density="compact"
                label={t('adjustments.color.levels.outputWhite')}
                max={100}
                min={outputWhiteMin}
                onValueChange={(value) => {
                  handleLevelsChange('outputWhite', value / 100);
                }}
                step={1}
                value={Math.round(levels.outputWhite * 100)}
                onDragStateChange={onDragStateChange}
              />
            </div>
            {levelsClippingWarnings.length > 0 && (
              <div className="mt-1 space-y-0.5">
                {levelsClippingWarnings.map((warning) => (
                  <p className="text-[10px] leading-4 text-text-secondary" key={warning}>
                    {warning}
                  </p>
                ))}
              </div>
            )}
          </section>
        )}
        {isCalibrationVisible && (
          <section
            className="py-1.5"
            data-commit-adjustment-revision={commitIdentity?.adjustmentRevision}
            data-commit-image-session={commitIdentity?.imageSessionId}
            data-commit-source-identity={commitIdentity?.sourceIdentity}
            data-testid="color-calibration-controls"
          >
            <CompactInspectorSectionHeader
              modified={isCalibrationModified}
              modifiedLabel={modifiedLabel}
              summary={activePrimaryLabel}
              title={t('adjustments.color.calibration.title')}
            />
            <div className="space-y-1">
              <AdjustmentSlider
                defaultValue={0}
                density="compact"
                label={t('adjustments.color.calibration.tint')}
                min={-100}
                max={100}
                step={1}
                testId="color-calibration-shadows-tint-range"
                value={colorCalibration.shadowsTint}
                onValueChange={(value) => {
                  handleShadowsChange(value);
                }}
                onDragStateChange={onDragStateChange}
                trackClassName="tint-gradient-track"
              />
              <div className="pt-0.5">
                <div className="mb-1 flex gap-1 px-0.5">
                  {primaryColors.map(({ name, color, label }) => (
                    <ColorSwatch
                      ariaLabel={t('adjustments.color.ariaSelectColor', { name: label })}
                      color={color}
                      isActive={activePrimary === name}
                      key={name}
                      name={name}
                      onClick={setActivePrimary}
                    />
                  ))}
                </div>
                <AdjustmentSlider
                  defaultValue={0}
                  density="compact"
                  label={t('adjustments.color.calibration.hue')}
                  min={-100}
                  max={100}
                  step={1}
                  testId="color-calibration-primary-hue-range"
                  value={currentValues.hue}
                  onValueChange={(value) => {
                    handlePrimaryChange('Hue', value);
                  }}
                  onDragStateChange={onDragStateChange}
                  trackClassName={`hue-slider-${trackSuffix}`}
                />
                <AdjustmentSlider
                  defaultValue={0}
                  density="compact"
                  label={t('adjustments.color.calibration.saturation')}
                  min={-100}
                  max={100}
                  step={1}
                  value={currentValues.saturation}
                  onValueChange={(value) => {
                    handlePrimaryChange('Saturation', value);
                  }}
                  onDragStateChange={onDragStateChange}
                  trackClassName={`sat-slider-${trackSuffix}`}
                />
              </div>
            </div>
          </section>
        )}
      </div>
    </details>
  );
};
