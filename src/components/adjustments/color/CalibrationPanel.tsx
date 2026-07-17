import cx from 'clsx';
import { RotateCcw } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useEditorStore } from '../../../store/useEditorStore';
import { ColorAdjustment, type ColorCalibration, INITIAL_ADJUSTMENTS } from '../../../utils/adjustments';
import {
  buildColorCalibrationEditTransaction,
  type ColorCalibrationCommitIdentity,
} from '../../../utils/colorCalibrationEditTransaction';
import { selectEditDocumentNode } from '../../../utils/editDocumentSelectors';
import CompactInspectorSectionHeader from '../../ui/CompactInspectorSectionHeader';
import { professionalInspectorDensityTokens } from '../../ui/inspectorTokens';
import AdjustmentSlider from '../AdjustmentSlider';
import { ColorSwatch } from './ColorSwatch';

interface CalibrationPanelProps {
  onDragStateChange?: (isDragging: boolean) => void;
}

/** The creative calibration stage, deliberately separate from the governed input profile. */
export default function CalibrationPanel({ onDragStateChange }: CalibrationPanelProps) {
  const { t } = useTranslation();
  const density = professionalInspectorDensityTokens;
  const [activePrimary, setActivePrimary] = useState<'red' | 'green' | 'blue'>('red');
  const adjustmentRevision = useEditorStore((state) => state.adjustmentRevision);
  const applyEditTransaction = useEditorStore((state) => state.applyEditTransaction);
  const imageSessionId = useEditorStore(
    (state) => state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
  );
  const selectedImage = useEditorStore((state) => state.selectedImage);
  const selectedImagePath = selectedImage?.path ?? null;
  const colorCalibration = useEditorStore(
    (state) => selectEditDocumentNode(state.editDocumentV2, 'color_calibration').params['colorCalibration'],
  );
  const commitIdentity = useMemo<ColorCalibrationCommitIdentity | null>(
    () =>
      selectedImagePath === null ? null : { adjustmentRevision, imageSessionId, sourceIdentity: selectedImagePath },
    [adjustmentRevision, imageSessionId, selectedImagePath],
  );
  const commitIdentityRef = useRef(commitIdentity);
  commitIdentityRef.current = commitIdentity;
  const colorCalibrationRef = useRef(colorCalibration);
  colorCalibrationRef.current = colorCalibration;

  const primaryColors = useMemo(
    () =>
      [
        { name: 'red' as const, color: '#f87171', label: t('adjustments.color.calibration.colors.red') },
        { name: 'green' as const, color: '#4ade80', label: t('adjustments.color.calibration.colors.green') },
        { name: 'blue' as const, color: '#60a5fa', label: t('adjustments.color.calibration.colors.blue') },
      ] satisfies ReadonlyArray<{ name: 'red' | 'green' | 'blue'; color: string; label: string }>,
    [t],
  );

  const isModified = (Object.keys(colorCalibration) as Array<keyof ColorCalibration>).some(
    (key) => colorCalibration[key] !== INITIAL_ADJUSTMENTS.colorCalibration[key],
  );
  const commitCalibration = (next: ColorCalibration) => {
    const identity = commitIdentityRef.current;
    if (identity === null) return;
    const result = applyEditTransaction(
      buildColorCalibrationEditTransaction(useEditorStore.getState(), identity, next, crypto.randomUUID()),
    );
    colorCalibrationRef.current = next;
    commitIdentityRef.current = { ...identity, adjustmentRevision: result.nextAdjustmentRevision };
  };
  const reset = () => commitCalibration(structuredClone(INITIAL_ADJUSTMENTS.colorCalibration));
  const handlePrimaryChange = (key: 'Hue' | 'Saturation', value: number) => {
    const fullKey = `${activePrimary}${key}` as keyof ColorCalibration;
    commitCalibration({ ...colorCalibrationRef.current, [fullKey]: value });
  };
  const currentValues = {
    hue: colorCalibration[`${activePrimary}Hue` as keyof ColorCalibration] ?? 0,
    saturation: colorCalibration[`${activePrimary}Saturation` as keyof ColorCalibration] ?? 0,
  };
  const runtimeProfile = selectedImage?.rawDevelopmentReport?.cameraProfile ?? null;
  const runtimeProcess = selectedImage?.rawDevelopmentReport?.processingProfile ?? null;
  const profileLabel =
    runtimeProfile === null
      ? t('adjustments.color.profileTone.runtimeNotReported')
      : t(`editor.metadata.cameraProfile.status.${runtimeProfile.status}`);
  const processLabel = runtimeProcess
    ? t('adjustments.color.profileTone.runtimeProcess', { process: runtimeProcess })
    : t('adjustments.color.profileTone.runtimeNotReported');
  const activePrimaryLabel = primaryColors.find((primary) => primary.name === activePrimary)?.label ?? activePrimary;

  return (
    <section
      className="space-y-1.5 py-1.5"
      data-commit-adjustment-revision={commitIdentity?.adjustmentRevision}
      data-commit-image-session={commitIdentity?.imageSessionId}
      data-commit-source-identity={commitIdentity?.sourceIdentity}
      data-testid="calibration-controls"
    >
      <CompactInspectorSectionHeader
        actions={
          <button
            aria-label={t('adjustments.basic.reset')}
            className={cx(density.actionButton.base, density.actionButton.icon, density.actionButton.quiet)}
            data-testid="calibration-reset"
            disabled={!isModified}
            onClick={reset}
            title={t('adjustments.basic.reset')}
            type="button"
          >
            <RotateCcw aria-hidden="true" size={13} />
          </button>
        }
        modified={isModified}
        modifiedLabel={t('ui.collapsibleSection.dirtyBadge', { defaultValue: 'Edited' })}
        summary={activePrimaryLabel}
        title={t('adjustments.color.calibration.title')}
      />
      <div
        className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 px-0.5 text-[10px] leading-4"
        data-testid="calibration-provenance"
      >
        <span className="text-text-secondary">{t('adjustments.color.profileTone.inputTransform')}</span>
        <span className="truncate text-right text-text-primary" data-testid="calibration-profile-status">
          {profileLabel}
        </span>
        <span className="text-text-secondary">{t('adjustments.color.calibration.advancedTitle')}</span>
        <span className="truncate text-right text-text-secondary" data-testid="calibration-process-status">
          {processLabel}
        </span>
      </div>
      <AdjustmentSlider
        defaultValue={0}
        density="compact"
        label={t('adjustments.color.calibration.tint')}
        max={100}
        min={-100}
        onDragStateChange={onDragStateChange}
        onValueChange={(value) => commitCalibration({ ...colorCalibrationRef.current, shadowsTint: value })}
        step={1}
        testId="calibration-shadows-tint-range"
        trackClassName="tint-gradient-track"
        value={colorCalibration.shadowsTint}
      />
      <div className="space-y-1 pt-0.5">
        <div className="flex gap-1 px-0.5" role="tablist" aria-label={t('adjustments.color.calibration.primaries')}>
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
          max={100}
          min={-100}
          onDragStateChange={onDragStateChange}
          onValueChange={(value) => handlePrimaryChange('Hue', value)}
          step={1}
          testId="calibration-primary-hue-range"
          trackClassName={`hue-slider-${activePrimary}s`}
          value={currentValues.hue}
        />
        <AdjustmentSlider
          defaultValue={0}
          density="compact"
          label={t('adjustments.color.calibration.saturation')}
          max={100}
          min={-100}
          onDragStateChange={onDragStateChange}
          onValueChange={(value) => handlePrimaryChange('Saturation', value)}
          step={1}
          testId="calibration-primary-saturation-range"
          trackClassName={`sat-slider-${activePrimary}s`}
          value={currentValues.saturation}
        />
      </div>
    </section>
  );
}
