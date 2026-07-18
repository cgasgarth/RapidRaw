import { type ColorResult, type HsvaColor, hsvaToHex } from '@uiw/color-convert';
import Wheel from '@uiw/react-color-wheel';
import { AnimatePresence, motion } from 'framer-motion';
import { Sun } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextColors, TextVariants } from '../../types/typography';
import type { HueSatLum } from '../../utils/adjustments';
import Slider, { type SliderChangeEvent } from '../ui/primitives/Slider';
import UiText from '../ui/primitives/Text';

interface ColorWheelProps {
  defaultValue: HueSatLum;
  label: string;
  onChange: (hsl: HueSatLum) => void;
  onInteractionCancel?: (() => void) | undefined;
  onInteractionCommit?: (() => void) | undefined;
  onInteractionStart?: (() => void) | undefined;
  value: HueSatLum;
  onDragStateChange?: ((isDragging: boolean) => void) | undefined;
  isExpanded?: boolean | undefined;
}

type ColorWheelSliderSource = 'hue' | 'luminance' | 'saturation';

export interface ColorWheelInteractionState {
  wheel: boolean;
  sliderCount: number;
}

interface ColorWheelInteractionController {
  activate: () => void;
  cancel: () => void;
  dispose: () => void;
  finish: () => void;
  getState: () => ColorWheelInteractionState;
  setSlider: (source: ColorWheelSliderSource, active: boolean) => void;
  startWheel: () => void;
}

export function createColorWheelInteractionController(
  onTransition: (state: ColorWheelInteractionState) => void,
  onAggregateChange: (active: boolean, cancelled?: boolean) => void,
): ColorWheelInteractionController {
  let state: ColorWheelInteractionState = { sliderCount: 0, wheel: false };
  let disposed = false;
  const sliders = new Set<ColorWheelSliderSource>();
  const commit = (next: ColorWheelInteractionState, cancelled = false) => {
    if (disposed) return;
    const wasActive = state.wheel || state.sliderCount > 0;
    const isActive = next.wheel || next.sliderCount > 0;
    state = next;
    onTransition(next);
    if (wasActive !== isActive) onAggregateChange(isActive, cancelled);
  };
  return {
    activate: () => {
      disposed = false;
    },
    cancel: () => {
      if (!state.wheel && state.sliderCount === 0) return;
      sliders.clear();
      commit({ sliderCount: 0, wheel: false }, true);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      const wasActive = state.wheel || state.sliderCount > 0;
      state = { sliderCount: 0, wheel: false };
      sliders.clear();
      if (wasActive) onAggregateChange(false, true);
    },
    finish: () => {
      if (!state.wheel) return;
      commit({ ...state, wheel: false });
    },
    getState: () => state,
    setSlider: (source, active) => {
      const wasActive = sliders.has(source);
      if (wasActive === active) return;
      if (active) sliders.add(source);
      else sliders.delete(source);
      commit({ ...state, sliderCount: sliders.size });
    },
    startWheel: () => {
      if (state.wheel) return;
      commit({ ...state, wheel: true });
    },
  };
}

export function resolveColorWheelChange(
  value: HueSatLum,
  nextHue: number,
  nextSaturation: number,
  modifiers: { ctrl: boolean; shift: boolean },
): HueSatLum {
  if (modifiers.ctrl && !modifiers.shift) return { ...value, hue: nextHue };
  if (modifiers.shift && !modifiers.ctrl) {
    const hueDelta = Math.abs(nextHue - value.hue);
    return {
      ...value,
      saturation: Math.max(0, Math.min(100, hueDelta > 30 ? 0 : nextSaturation)),
    };
  }
  return { ...value, hue: nextHue, saturation: nextSaturation };
}

const formatPercent = (value: number) => `${String(value)}%`;
const formatPx = (value: number) => `${String(value)}px`;

const ColorWheel = ({
  defaultValue,
  label,
  onInteractionCancel,
  onInteractionCommit,
  onInteractionStart,
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
  const [interactionState, setInteractionState] = useState<ColorWheelInteractionState>({
    sliderCount: 0,
    wheel: false,
  });
  const [isLabelHovered, setIsLabelHovered] = useState(false);
  const modifierState = useRef({ ctrl: false, shift: false });
  const onDragStateChangeRef = useRef(onDragStateChange);
  const onInteractionCancelRef = useRef(onInteractionCancel);
  const onInteractionCommitRef = useRef(onInteractionCommit);
  const onInteractionStartRef = useRef(onInteractionStart);
  onDragStateChangeRef.current = onDragStateChange;
  onInteractionCancelRef.current = onInteractionCancel;
  onInteractionCommitRef.current = onInteractionCommit;
  onInteractionStartRef.current = onInteractionStart;
  const interactionController = useRef<ColorWheelInteractionController | null>(null);
  if (interactionController.current === null) {
    interactionController.current = createColorWheelInteractionController(setInteractionState, (active, cancelled) => {
      onDragStateChangeRef.current?.(active);
      if (active) onInteractionStartRef.current?.();
      else if (cancelled) onInteractionCancelRef.current?.();
      else onInteractionCommitRef.current?.();
    });
  }
  const isDragging = interactionState.wheel || interactionState.sliderCount > 0;

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

  const finishWheelInteraction = useCallback(() => {
    interactionController.current?.finish();
  }, []);
  const cancelWheelInteraction = useCallback(() => {
    interactionController.current?.cancel();
  }, []);

  useEffect(() => {
    window.addEventListener('mouseup', finishWheelInteraction);
    window.addEventListener('blur', cancelWheelInteraction);
    window.addEventListener('pointercancel', cancelWheelInteraction);
    window.addEventListener('touchcancel', cancelWheelInteraction);
    window.addEventListener('touchend', finishWheelInteraction);
    return () => {
      window.removeEventListener('mouseup', finishWheelInteraction);
      window.removeEventListener('blur', cancelWheelInteraction);
      window.removeEventListener('pointercancel', cancelWheelInteraction);
      window.removeEventListener('touchcancel', cancelWheelInteraction);
      window.removeEventListener('touchend', finishWheelInteraction);
    };
  }, [cancelWheelInteraction, finishWheelInteraction]);

  useEffect(() => {
    interactionController.current?.activate();
    return () => {
      interactionController.current?.dispose();
    };
  }, []);

  const handleWheelChange = (color: ColorResult) => {
    onChange(resolveColorWheelChange(effectiveValue, color.hsva.h, color.hsva.s, modifierState.current));
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
    interactionController.current?.startWheel();
  };

  const hsva: HsvaColor = { h: hue, s: saturation, v: 100, a: 1 };
  const hexColor = hsvaToHex(hsva);

  const pointerSize = interactionState.wheel ? 14 : 12;
  const pointerOffset = pointerSize / 2;

  const wheelStyle = {
    '--cg-hue': String(hue),
    '--cg-sat': formatPercent(saturation),
  } as React.CSSProperties;

  return (
    <div
      className="relative flex flex-col items-center gap-2"
      data-testid="color-wheel"
      ref={containerRef}
      style={wheelStyle}
    >
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
            data-testid="color-wheel-surface"
            onDoubleClick={handleReset}
            onMouseDownCapture={handleDragStart}
            onMouseUpCapture={finishWheelInteraction}
            onPointerCancel={cancelWheelInteraction}
            onTouchStartCapture={handleDragStart}
            onTouchCancel={cancelWheelInteraction}
            onTouchEndCapture={finishWheelInteraction}
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
                onDragStateChange={(active) => {
                  interactionController.current?.setSlider('hue', active);
                }}
                onInteractionCancel={cancelWheelInteraction}
                onInteractionCommit={() => {
                  interactionController.current?.setSlider('hue', false);
                }}
                onInteractionStart={() => {
                  interactionController.current?.setSlider('hue', true);
                }}
                step={1}
                value={hue}
                trackClassName="cg-hue-gradient"
              />
            </div>

            <div className="w-full">
              <Slider
                defaultValue={defaultValue.saturation}
                label={t('ui.colorWheel.saturation')}
                max={100}
                min={0}
                onChange={handleSaturationChange}
                onDragStateChange={(active) => {
                  interactionController.current?.setSlider('saturation', active);
                }}
                onInteractionCancel={cancelWheelInteraction}
                onInteractionCommit={() => {
                  interactionController.current?.setSlider('saturation', false);
                }}
                onInteractionStart={() => {
                  interactionController.current?.setSlider('saturation', true);
                }}
                step={1}
                value={saturation}
                trackClassName="cg-sat-gradient"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="w-full">
        <Slider
          ariaLabel={t('ui.colorWheel.luminance')}
          defaultValue={defaultValue.luminance}
          label={isExpanded ? t('ui.colorWheel.luminance') : <Sun size={16} className="text-text-secondary" />}
          max={100}
          min={-100}
          onChange={handleLumChange}
          onDragStateChange={(active) => {
            interactionController.current?.setSlider('luminance', active);
          }}
          onInteractionCancel={cancelWheelInteraction}
          onInteractionCommit={() => {
            interactionController.current?.setSlider('luminance', false);
          }}
          onInteractionStart={() => {
            interactionController.current?.setSlider('luminance', true);
          }}
          step={1}
          value={luminance}
          trackClassName="cg-lum-gradient"
        />
      </div>
    </div>
  );
};

export default ColorWheel;
