import { type ColorResult, type HsvaColor, hsvaToHex } from '@uiw/color-convert';
import Wheel from '@uiw/react-color-wheel';
import { AnimatePresence, motion } from 'framer-motion';
import { Sun } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextColors, TextVariants } from '../../types/typography';
import type { HueSatLum } from '../../utils/adjustments';
import Slider, { type SliderChangeEvent } from './primitives/Slider';
import UiText from './primitives/Text';

interface ColorWheelProps {
  defaultValue: HueSatLum;
  label: string;
  onChange: (hsl: HueSatLum) => void;
  value: HueSatLum;
  onDragStateChange?: ((isDragging: boolean) => void) | undefined;
  isExpanded?: boolean | undefined;
}

const formatPercent = (value: number) => `${String(value)}%`;
const formatPx = (value: number) => `${String(value)}px`;

const ColorWheel = ({
  defaultValue,
  label,
  onChange,
  value,
  onDragStateChange,
  isExpanded = false,
}: ColorWheelProps) => {
  const { t } = useTranslation();
  const effectiveValue = { ...defaultValue, ...value };
  const { hue, saturation, luminance } = effectiveValue;
  const sizerRef = useRef<HTMLDivElement>(null);
  const [wheelSize, setWheelSize] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isWheelDragging, setIsWheelDragging] = useState(false);
  const [isSliderDragging, setIsSliderDragging] = useState(false);
  const [isLabelHovered, setIsLabelHovered] = useState(false);
  const modifierState = useRef({ ctrl: false, shift: false });
  const instanceId = useId().replace(/:/g, '');

  const isDragging = isWheelDragging || isSliderDragging;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      modifierState.current = {
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
      };
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      modifierState.current = {
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
      };
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty(`--cg-hue-${instanceId}`, hue.toString());
    document.documentElement.style.setProperty(`--cg-sat-${instanceId}`, formatPercent(saturation));
  }, [hue, saturation, instanceId]);

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        const width = entries[0].contentRect.width;
        if (width > 0) {
          setWheelSize(width);
        }
      }
    });

    const currentSizer = sizerRef.current;
    if (currentSizer) {
      observer.observe(currentSizer);
    }

    return () => {
      if (currentSizer) {
        observer.unobserve(currentSizer);
      }
    };
  }, []);

  useEffect(() => {
    const handleInteractionEnd = () => {
      setIsWheelDragging(false);
      onDragStateChange?.(isSliderDragging);
    };
    if (isWheelDragging) {
      window.addEventListener('mouseup', handleInteractionEnd);
      window.addEventListener('touchend', handleInteractionEnd);
    }
    return () => {
      window.removeEventListener('mouseup', handleInteractionEnd);
      window.removeEventListener('touchend', handleInteractionEnd);
    };
  }, [isWheelDragging, isSliderDragging, onDragStateChange]);

  useEffect(() => {
    onDragStateChange?.(isDragging);
  }, [isDragging, onDragStateChange]);

  const handleWheelChange = (color: ColorResult) => {
    const { ctrl, shift } = modifierState.current;
    const newValues = { ...effectiveValue };

    if (ctrl && !shift) {
      newValues.hue = color.hsva.h;
      newValues.saturation = saturation;
    } else if (shift && !ctrl) {
      let newSaturation = color.hsva.s;

      const hueDelta = Math.abs(color.hsva.h - hue);

      if (hueDelta > 30) {
        newSaturation = 0;
      }

      newSaturation = Math.max(0, Math.min(100, newSaturation));

      newValues.saturation = newSaturation;
      newValues.hue = hue;
    } else {
      newValues.hue = color.hsva.h;
      newValues.saturation = color.hsva.s;
    }

    onChange(newValues);
  };

  const handleHueChange = (e: SliderChangeEvent) => {
    onChange({ ...effectiveValue, hue: parseFloat(String(e.target.value)) });
  };

  const handleSaturationChange = (e: SliderChangeEvent) => {
    onChange({ ...effectiveValue, saturation: parseFloat(String(e.target.value)) });
  };

  const handleLumChange = (e: SliderChangeEvent) => {
    onChange({ ...effectiveValue, luminance: parseFloat(String(e.target.value)) });
  };

  const handleReset = () => {
    onChange(defaultValue);
  };

  const handleDragStart = () => {
    onDragStateChange?.(true);
    setIsWheelDragging(true);
  };

  const hsva: HsvaColor = { h: hue, s: saturation, v: 100, a: 1 };
  const hexColor = hsvaToHex(hsva);

  const pointerSize = isWheelDragging ? 14 : 12;
  const pointerOffset = pointerSize / 2;

  const satWrapperStyle = { '--cg-hue': `var(--cg-hue-${instanceId})` } as React.CSSProperties;
  const lumWrapperStyle = {
    '--cg-hue': `var(--cg-hue-${instanceId})`,
    '--cg-sat': `var(--cg-sat-${instanceId})`,
  } as React.CSSProperties;

  return (
    <div className="relative flex flex-col items-center gap-2" ref={containerRef}>
      <button
        className="relative cursor-pointer h-5 w-full overflow-hidden border-0 bg-transparent p-0 text-inherit"
        onClick={handleReset}
        onDoubleClick={handleReset}
        onMouseEnter={() => {
          setIsLabelHovered(true);
        }}
        onMouseLeave={() => {
          setIsLabelHovered(false);
        }}
        type="button"
      >
        <UiText
          variant={TextVariants.label}
          className={`absolute inset-0 flex items-center justify-center whitespace-nowrap select-none transition-opacity duration-200 ease-in-out ${
            !isDragging && !isLabelHovered ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {label}
        </UiText>

        <UiText
          variant={TextVariants.label}
          color={TextColors.primary}
          className={`absolute inset-0 flex items-center justify-center whitespace-nowrap select-none transition-opacity duration-200 ease-in-out ${
            !isDragging && isLabelHovered ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {t('ui.colorWheel.reset')}
        </UiText>

        <UiText
          as="div"
          variant={TextVariants.label}
          className={`absolute inset-0 flex items-center justify-center gap-2 whitespace-nowrap select-none transition-opacity duration-200 ease-in-out ${
            isDragging ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div className="flex items-center tabular-nums">
            <span className="font-bold">{t('ui.colorWheel.hueAbbreviation')}</span>
            <span className="w-8 text-right">{Math.round(hue)}&deg;</span>
          </div>

          <div className="flex items-center tabular-nums">
            <span className="font-bold">{t('ui.colorWheel.saturationAbbreviation')}</span>
            <span className="w-6 text-right">{Math.round(saturation)}</span>
          </div>
        </UiText>
      </button>

      <div ref={sizerRef} className="relative w-full aspect-square">
        {wheelSize > 0 && (
          <div
            className="absolute inset-0 cursor-pointer"
            onDoubleClick={handleReset}
            onMouseDownCapture={handleDragStart}
            onTouchStartCapture={handleDragStart}
          >
            <Wheel
              color={hsva}
              height={wheelSize}
              onChange={handleWheelChange}
              angle={0}
              pointer={({ style }) => (
                <div style={{ ...style, zIndex: 1 }}>
                  <div
                    style={{
                      backgroundColor: saturation > 5 ? hexColor : 'transparent',
                      border: '2px solid white',
                      borderRadius: '50%',
                      boxShadow: '0 0 2px rgba(0,0,0,0.5)',
                      height: pointerSize,
                      width: pointerSize,
                      transform: `translate(-${formatPx(pointerOffset)}, -${formatPx(pointerOffset)})`,
                      transition: 'width 150ms ease-out, height 150ms ease-out, transform 150ms ease-out',
                    }}
                  />
                </div>
              )}
              width={wheelSize}
            />
          </div>
        )}
      </div>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{
              height: 'auto',
              opacity: 1,
              transitionEnd: { overflow: 'visible' },
            }}
            exit={{ height: 0, opacity: 0, overflow: 'hidden' }}
            transition={{ duration: 0.2 }}
            className="w-full flex flex-col gap-2"
          >
            <div className="w-full">
              <Slider
                defaultValue={defaultValue.hue}
                label={t('ui.colorWheel.hue')}
                max={360}
                min={0}
                onChange={handleHueChange}
                onDragStateChange={setIsSliderDragging}
                step={1}
                value={hue}
                trackClassName="cg-hue-gradient"
              />
            </div>

            <div className="w-full" style={satWrapperStyle}>
              <Slider
                defaultValue={defaultValue.saturation}
                label={t('ui.colorWheel.saturation')}
                max={100}
                min={0}
                onChange={handleSaturationChange}
                onDragStateChange={setIsSliderDragging}
                step={1}
                value={saturation}
                trackClassName="cg-sat-gradient"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="w-full" style={lumWrapperStyle}>
        <Slider
          defaultValue={defaultValue.luminance}
          label={isExpanded ? t('ui.colorWheel.luminance') : <Sun size={16} className="text-text-secondary" />}
          max={100}
          min={-100}
          onChange={handleLumChange}
          onDragStateChange={setIsSliderDragging}
          step={1}
          value={luminance}
          trackClassName="cg-lum-gradient"
        />
      </div>
    </div>
  );
};

export default ColorWheel;
