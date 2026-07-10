import cx from 'clsx';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type Adjustments, BasicAdjustment, INITIAL_ADJUSTMENTS } from '../../utils/adjustments';
import type { AppSettings } from '../ui/AppProperties';
import { compactInspectorSliderTokens } from '../ui/inspectorTokens';
import InspectorSegmentedControl from '../ui/primitives/InspectorSegmentedControl';
import AdjustmentSlider from './AdjustmentSlider';

interface BasicAdjustmentsProps {
  adjustments: Adjustments;
  setAdjustments: (adjustments: AdjustmentUpdate) => void;
  isForMask?: boolean;
  onDragStateChange?: ((isDragging: boolean) => void) | undefined;
  appSettings?: Pick<AppSettings, 'tonemapperOverrideEnabled'> | null;
}

interface ToneMapperSwitchProps {
  selectedMapper: Adjustments['toneMapper'];
  onMapperChange: (mapper: Adjustments['toneMapper']) => void;
  onReset: () => void;
}

type AdjustmentUpdate = Partial<Adjustments> | ((prev: Adjustments) => Adjustments);

const TONE_CONTROL_ORDER = [
  BasicAdjustment.Contrast,
  BasicAdjustment.Highlights,
  BasicAdjustment.Shadows,
  BasicAdjustment.Whites,
  BasicAdjustment.Blacks,
] as const;

const ToneMapperSwitch = ({ selectedMapper, onMapperChange, onReset }: ToneMapperSwitchProps) => {
  const { t } = useTranslation();
  const [isLabelHovered, setIsLabelHovered] = useState(false);
  const isModified = selectedMapper !== INITIAL_ADJUSTMENTS.toneMapper;
  const toneMapperOptions = useMemo(
    () => [
      {
        label: t('adjustments.basic.mappers.basic'),
        value: 'basic' as const,
      },
      {
        label: t('adjustments.basic.mappers.agx'),
        value: 'agx' as const,
      },
    ],
    [t],
  );

  return (
    <div
      className={cx(compactInspectorSliderTokens.root, 'mb-0.5 max-[319px]:grid-cols-[minmax(0,1fr)_3.5rem]')}
      data-modified={String(isModified)}
      data-testid="basic-tone-mapper"
    >
      {isModified ? <span className="sr-only">{t('ui.slider.modified', { defaultValue: 'Modified' })}</span> : null}
      <button
        className={compactInspectorSliderTokens.labelButton}
        data-testid="basic-tone-mapper-label"
        onClick={onReset}
        onDoubleClick={onReset}
        onMouseEnter={() => {
          setIsLabelHovered(true);
        }}
        onMouseLeave={() => {
          setIsLabelHovered(false);
        }}
        type="button"
      >
        <span
          aria-hidden={isLabelHovered}
          className={cx(compactInspectorSliderTokens.label, isLabelHovered ? 'opacity-0' : 'opacity-100')}
          data-tooltip={t('adjustments.basic.toneMapper')}
        >
          {t('adjustments.basic.toneMapper')}
        </span>
        <span
          aria-hidden={!isLabelHovered}
          className={cx(compactInspectorSliderTokens.resetLabel, isLabelHovered ? 'opacity-100' : 'opacity-0')}
        >
          {t('adjustments.basic.reset')}
        </span>
      </button>
      <InspectorSegmentedControl
        ariaLabel={t('adjustments.basic.toneMapper')}
        className="col-span-2 min-w-0 max-[319px]:col-span-2 max-[319px]:col-start-1 max-[319px]:row-start-2"
        onChange={onMapperChange}
        options={toneMapperOptions}
        value={selectedMapper}
      />
    </div>
  );
};

export default function BasicAdjustments({
  adjustments,
  setAdjustments,
  isForMask = false,
  onDragStateChange,
  appSettings,
}: BasicAdjustmentsProps) {
  const { t } = useTranslation();

  const handleAdjustmentChange = (key: BasicAdjustment, value: number) => {
    setAdjustments((prev: Adjustments) => ({ ...prev, [key]: value }));
  };

  const handleToneMapperChange = (mapper: Adjustments['toneMapper']) => {
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      toneMapper: mapper,
    }));
  };

  const handleToneMapperReset = () => {
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      exposure: INITIAL_ADJUSTMENTS.exposure,
      toneMapper: INITIAL_ADJUSTMENTS.toneMapper,
    }));
  };

  const renderSlider = (key: BasicAdjustment, label: string, range: { max: number; min: number; step: number }) => (
    <AdjustmentSlider
      defaultValue={INITIAL_ADJUSTMENTS[key]}
      density="compact"
      label={label}
      max={range.max}
      min={range.min}
      onDragStateChange={onDragStateChange}
      onValueChange={(value) => {
        handleAdjustmentChange(key, value);
      }}
      step={range.step}
      testId={`basic-control-${key}`}
      value={adjustments[key]}
    />
  );

  const hideToneMapper = isForMask || appSettings?.tonemapperOverrideEnabled;
  const toneLabels: Record<(typeof TONE_CONTROL_ORDER)[number], string> = {
    [BasicAdjustment.Blacks]: t('adjustments.basic.blacks'),
    [BasicAdjustment.Contrast]: t('adjustments.basic.contrast'),
    [BasicAdjustment.Highlights]: t('adjustments.basic.highlights'),
    [BasicAdjustment.Shadows]: t('adjustments.basic.shadows'),
    [BasicAdjustment.Whites]: t('adjustments.basic.whites'),
  };

  return (
    <div className="min-w-0 space-y-px" data-testid="basic-light-controls">
      {!hideToneMapper && (
        <ToneMapperSwitch
          selectedMapper={adjustments.toneMapper}
          onMapperChange={handleToneMapperChange}
          onReset={handleToneMapperReset}
        />
      )}

      {renderSlider(BasicAdjustment.Exposure, t('adjustments.basic.evShift'), {
        max: 5,
        min: -5,
        step: 0.01,
      })}

      {TONE_CONTROL_ORDER.map((key) => (
        <div key={key}>{renderSlider(key, toneLabels[key], { max: 100, min: -100, step: 1 })}</div>
      ))}

      <div className="mt-1 border-t border-editor-divider pt-1" data-testid="basic-secondary-controls">
        {renderSlider(
          BasicAdjustment.Brightness,
          t('adjustments.basic.brightness', { defaultValue: t('adjustments.basic.exposure') }),
          { max: 5, min: -5, step: 0.01 },
        )}
      </div>
    </div>
  );
}
