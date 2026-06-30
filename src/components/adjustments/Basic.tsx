import cx from 'clsx';
import { motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type Adjustments, BasicAdjustment } from '../../utils/adjustments';
import type { AppSettings } from '../ui/AppProperties';
import AdjustmentSlider from './AdjustmentSlider';

interface BasicAdjustmentsProps {
  adjustments: Adjustments;
  setAdjustments: (adjustments: AdjustmentUpdate) => void;
  isForMask?: boolean;
  onDragStateChange?: ((isDragging: boolean) => void) | undefined;
  appSettings?: AppSettings | null;
}

interface ToneMapperSwitchProps {
  selectedMapper: string;
  onMapperChange: (mapper: string) => void;
  evShiftValue: number;
  onEvShiftChange: (value: number) => void;
  onDragStateChange?: ((isDragging: boolean) => void) | undefined;
}

type AdjustmentUpdate = Partial<Adjustments> | ((prev: Adjustments) => Adjustments);

const formatPercent = (value: number) => `${String(value)}%`;

const ToneMapperSwitch = ({
  selectedMapper,
  onMapperChange,
  evShiftValue,
  onEvShiftChange,
  onDragStateChange,
}: ToneMapperSwitchProps) => {
  const { t } = useTranslation();
  const [bubbleStyle, setBubbleStyle] = useState({});
  const isInitialAnimation = useRef(true);
  const [isLabelHovered, setIsLabelHovered] = useState(false);

  const toneMapperOptions = useMemo(
    () => [
      {
        id: 'basic',
        label: t('adjustments.basic.mappers.basic'),
        title: t('adjustments.basic.mappers.basicDesc'),
      },
      {
        id: 'agx',
        label: t('adjustments.basic.mappers.agx'),
        title: t('adjustments.basic.mappers.agxDesc'),
      },
    ],
    [t],
  );

  const handleReset = () => {
    onMapperChange('basic');
    onEvShiftChange(0);
  };

  useEffect(() => {
    const selectedIndex = toneMapperOptions.findIndex((m) => m.id === selectedMapper);
    const safeIndex = selectedIndex >= 0 ? selectedIndex : 0;

    const widthPercent = 100 / toneMapperOptions.length;
    const targetX = formatPercent(safeIndex * 100);
    const targetWidth = formatPercent(widthPercent);

    if (isInitialAnimation.current) {
      let initialX;
      if (selectedMapper === 'agx') {
        initialX = formatPercent(toneMapperOptions.length * 100);
      } else {
        initialX = '-25%';
      }

      setBubbleStyle({
        x: [initialX, targetX],
        width: targetWidth,
      });
      isInitialAnimation.current = false;
    } else {
      setBubbleStyle({
        x: targetX,
        width: targetWidth,
      });
    }
  }, [selectedMapper, toneMapperOptions]);

  return (
    <div className="group mb-2">
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          className="grid cursor-pointer bg-transparent border-0 p-0 font-inherit text-left"
          onClick={handleReset}
          onDoubleClick={handleReset}
          onMouseEnter={() => {
            setIsLabelHovered(true);
          }}
          onMouseLeave={() => {
            setIsLabelHovered(false);
          }}
        >
          <span
            aria-hidden={isLabelHovered}
            className={`col-start-1 row-start-1 text-[12px] font-medium leading-4 text-text-secondary select-none transition-opacity duration-200 ease-in-out ${
              isLabelHovered ? 'opacity-0' : 'opacity-100'
            }`}
          >
            {t('adjustments.basic.toneMapper')}
          </span>
          <span
            aria-hidden={!isLabelHovered}
            className={`col-start-1 row-start-1 text-[12px] font-medium leading-4 text-text-primary select-none transition-opacity duration-200 ease-in-out pointer-events-none ${
              isLabelHovered ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {t('adjustments.basic.reset')}
          </span>
        </button>
      </div>
      <div className="w-full rounded-md bg-card-active p-1.5 pb-1">
        <div className="relative flex w-full">
          <motion.div
            className="absolute top-0 bottom-0 z-0 bg-accent"
            style={{ borderRadius: 6 }}
            animate={bubbleStyle}
            transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
          />
          {toneMapperOptions.map((mapper) => (
            <button
              key={mapper.id}
              data-tooltip={mapper.title}
              onClick={() => {
                onMapperChange(mapper.id);
              }}
              className={cx(
                'relative flex-1 flex items-center justify-center gap-2 rounded-md px-2 py-1 text-[12px] font-medium leading-4 transition-colors',
                {
                  'text-text-primary hover:bg-surface': selectedMapper !== mapper.id,
                  'text-button-text': selectedMapper === mapper.id,
                },
              )}
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              <span className="relative z-10 flex items-center">{mapper.label}</span>
            </button>
          ))}
        </div>
        <div className="mt-1.5 px-0.5">
          <AdjustmentSlider
            density="compact"
            label={t('adjustments.basic.evShift')}
            max={5}
            min={-5}
            onValueChange={onEvShiftChange}
            step={0.01}
            value={evShiftValue}
            trackClassName="bg-surface"
            onDragStateChange={onDragStateChange}
          />
        </div>
      </div>
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

  const handleToneMapperChange = (mapper: string) => {
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      toneMapper: mapper as 'basic' | 'agx',
    }));
  };

  const hideTonemapper = isForMask || appSettings?.tonemapperOverrideEnabled;

  return (
    <div>
      {hideTonemapper ? (
        <AdjustmentSlider
          density="compact"
          label={t('adjustments.basic.evShift')}
          max={5}
          min={-5}
          onValueChange={(value) => {
            handleAdjustmentChange(BasicAdjustment.Exposure, value);
          }}
          step={0.01}
          value={adjustments.exposure}
          onDragStateChange={onDragStateChange}
        />
      ) : (
        <ToneMapperSwitch
          selectedMapper={adjustments.toneMapper}
          onMapperChange={handleToneMapperChange}
          evShiftValue={adjustments.exposure}
          onEvShiftChange={(value) => {
            handleAdjustmentChange(BasicAdjustment.Exposure, value);
          }}
          onDragStateChange={onDragStateChange}
        />
      )}
      <AdjustmentSlider
        density="compact"
        label={t('adjustments.basic.exposure')}
        max={5}
        min={-5}
        onValueChange={(value) => {
          handleAdjustmentChange(BasicAdjustment.Brightness, value);
        }}
        step={0.01}
        value={adjustments.brightness}
        onDragStateChange={onDragStateChange}
      />
      <AdjustmentSlider
        density="compact"
        label={t('adjustments.basic.contrast')}
        max={100}
        min={-100}
        onValueChange={(value) => {
          handleAdjustmentChange(BasicAdjustment.Contrast, value);
        }}
        step={1}
        value={adjustments.contrast}
        onDragStateChange={onDragStateChange}
      />
      <AdjustmentSlider
        density="compact"
        label={t('adjustments.basic.highlights')}
        max={100}
        min={-100}
        onValueChange={(value) => {
          handleAdjustmentChange(BasicAdjustment.Highlights, value);
        }}
        step={1}
        value={adjustments.highlights}
        onDragStateChange={onDragStateChange}
      />
      <AdjustmentSlider
        density="compact"
        label={t('adjustments.basic.shadows')}
        max={100}
        min={-100}
        onValueChange={(value) => {
          handleAdjustmentChange(BasicAdjustment.Shadows, value);
        }}
        step={1}
        value={adjustments.shadows}
        onDragStateChange={onDragStateChange}
      />
      <AdjustmentSlider
        density="compact"
        label={t('adjustments.basic.whites')}
        max={100}
        min={-100}
        onValueChange={(value) => {
          handleAdjustmentChange(BasicAdjustment.Whites, value);
        }}
        step={1}
        value={adjustments.whites}
        onDragStateChange={onDragStateChange}
      />
      <AdjustmentSlider
        density="compact"
        label={t('adjustments.basic.blacks')}
        max={100}
        min={-100}
        onValueChange={(value) => {
          handleAdjustmentChange(BasicAdjustment.Blacks, value);
        }}
        step={1}
        value={adjustments.blacks}
        onDragStateChange={onDragStateChange}
      />
    </div>
  );
}
