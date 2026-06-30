import type React from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GLOBAL_KEYS } from './AppProperties';

export type SliderChangeEvent =
  | React.ChangeEvent<HTMLInputElement>
  | {
      target: {
        value: number | string;
      };
    };

interface SliderProps {
  defaultValue?: number;
  label: React.ReactNode;
  max: number;
  min: number;
  onChange: (event: SliderChangeEvent) => void;
  disabled?: boolean;
  onDragStateChange?: ((state: boolean) => void) | undefined;
  step: number;
  value: number;
  trackClassName?: string;
  fillOrigin?: 'min' | 'default';
  suffix?: string;
}

const DOUBLE_CLICK_THRESHOLD_MS = 300;
const FINE_ADJUSTMENT_MULTIPLIER = 0.2;
const TOUCH_DRAG_THRESHOLD_PX = 10;
const TOUCH_THUMB_HIT_RADIUS_PX = 24;

const formatPercent = (value: number) => `${String(value)}%`;

const Slider = ({
  defaultValue = 0,
  label,
  max,
  min,
  onChange,
  disabled = false,
  onDragStateChange = () => {},
  step,
  value,
  trackClassName,
  fillOrigin = 'default',
  suffix = '',
}: SliderProps) => {
  const { t } = useTranslation();
  const [displayValue, setDisplayValue] = useState<number>(value);
  const displayValueRef = useRef<number>(value);
  const [isDragging, setIsDragging] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState<string>(String(value));
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rangeInputRef = useRef<HTMLInputElement | null>(null);
  const [isLabelHovered, setIsLabelHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastUpTime = useRef(0);
  const lastPointerXRef = useRef<number>(0);
  const accumulatedValueRef = useRef<number>(0);
  const pendingTouchRef = useRef<{
    startX: number;
    startY: number;
    latestX: number;
    startValue: number;
  } | null>(null);
  const suppressTouchChangeRef = useRef(false);
  const [isWheelActive, setIsWheelActive] = useState(false);
  const wheelTimeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (wheelTimeoutRef.current !== undefined) {
        window.clearTimeout(wheelTimeoutRef.current);
      }
    };
  }, []);

  const rangeValue = isDragging || isWheelActive ? displayValue : value;
  const fillPercentage = max !== min ? ((rangeValue - min) / (max - min)) * 100 : 0;
  const originPercentage = useMemo(() => {
    if (fillOrigin === 'min') {
      return 0;
    }
    return max !== min ? ((defaultValue - min) / (max - min)) * 100 : 0;
  }, [fillOrigin, defaultValue, min, max]);

  const stepStr = String(step);
  const decimalPlaces = stepStr.includes('.') ? (stepStr.split('.')[1] ?? '').length : 0;

  const snapToStep = useCallback(
    (val: number): number => {
      const snapped = Math.round((val - min) / step) * step + min;
      const clamped = Math.max(min, Math.min(max, snapped));
      return parseFloat(clamped.toFixed(decimalPlaces));
    },
    [min, max, step, decimalPlaces],
  );

  const onChangeRef = useRef(onChange);
  const snapToStepRef = useRef(snapToStep);
  const rangeRef = useRef({ min, max });

  useLayoutEffect(() => {
    displayValueRef.current = rangeValue;
    onChangeRef.current = onChange;
    snapToStepRef.current = snapToStep;
    rangeRef.current = { min, max };
  }, [rangeValue, max, min, onChange, snapToStep]);

  useEffect(() => {
    onDragStateChange(isDragging);
  }, [isDragging, onDragStateChange]);

  useEffect(() => {
    const sliderElement = containerRef.current;
    if (!sliderElement) return;

    const handleWheel = (event: WheelEvent) => {
      if (!event.shiftKey) {
        return;
      }

      event.preventDefault();
      const direction = -Math.sign(event.deltaY || event.deltaX);
      const newValue = value + direction * step;
      const roundedNewValue = parseFloat(newValue.toFixed(decimalPlaces));

      const clampedValue = Math.max(min, Math.min(max, roundedNewValue));

      if (clampedValue !== value && !isNaN(clampedValue)) {
        setIsWheelActive(true);
        setDisplayValue(clampedValue);

        if (wheelTimeoutRef.current !== undefined) {
          window.clearTimeout(wheelTimeoutRef.current);
        }
        wheelTimeoutRef.current = window.setTimeout(() => {
          setIsWheelActive(false);
        }, 150);

        const syntheticEvent = {
          target: {
            value: clampedValue,
          },
        };
        onChange(syntheticEvent);
      }
    };

    sliderElement.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      sliderElement.removeEventListener('wheel', handleWheel);
    };
  }, [value, min, max, step, onChange, decimalPlaces]);

  // Handle Dragging
  useEffect(() => {
    if (!isDragging) return;

    const inputEl = rangeInputRef.current;
    if (!inputEl) return;
    const sliderWidth = inputEl.getBoundingClientRect().width || 1;

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      let clientX: number;
      let shiftKey: boolean;

      if ('touches' in e) {
        if (e.touches.length === 0) return;
        const touch = e.touches[0];
        if (!touch) return;
        clientX = touch.clientX;
        shiftKey = e.shiftKey || e.altKey;
        if (e.cancelable) e.preventDefault();
      } else {
        clientX = e.clientX;
        shiftKey = e.shiftKey || e.altKey;
      }

      const deltaX = clientX - lastPointerXRef.current;
      const { min: curMin, max: curMax } = rangeRef.current;

      const multiplier = shiftKey ? FINE_ADJUSTMENT_MULTIPLIER : 1;
      const deltaValue = (deltaX / sliderWidth) * (curMax - curMin) * multiplier;

      const prevAccumulated = accumulatedValueRef.current;
      accumulatedValueRef.current = Math.max(curMin, Math.min(curMax, prevAccumulated + deltaValue));

      const actualDeltaValue = accumulatedValueRef.current - prevAccumulated;
      if (deltaValue !== 0) {
        lastPointerXRef.current += deltaX * (actualDeltaValue / deltaValue);
      } else {
        lastPointerXRef.current = clientX;
      }

      const snappedValue = snapToStepRef.current(accumulatedValueRef.current);

      setDisplayValue(snappedValue);
      onChangeRef.current({ target: { value: snappedValue } });
    };

    const handlePointerUp = () => {
      lastUpTime.current = Date.now();
      pendingTouchRef.current = null;
      suppressTouchChangeRef.current = false;
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handlePointerMove, { passive: false });
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchmove', handlePointerMove, { passive: false });
    window.addEventListener('touchend', handlePointerUp);
    window.addEventListener('touchcancel', handlePointerUp);

    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('touchend', handlePointerUp);
      window.removeEventListener('touchcancel', handlePointerUp);
    };
  }, [isDragging]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleReset = () => {
    if (disabled) {
      return;
    }

    const syntheticEvent = {
      target: {
        value: defaultValue,
      },
    };
    onChange(syntheticEvent);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) {
      return;
    }

    if (suppressTouchChangeRef.current) {
      return;
    }

    if (!isDragging) {
      setDisplayValue(Number(e.target.value));
      onChange(e);
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLInputElement>) => {
    if (disabled) {
      return;
    }

    if (Date.now() - lastUpTime.current < DOUBLE_CLICK_THRESHOLD_MS) {
      e.preventDefault();
      return;
    }
    e.preventDefault();

    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const rawValue = min + fraction * (max - min);
    const snappedValue = snapToStep(rawValue);

    accumulatedValueRef.current = rawValue;
    lastPointerXRef.current = e.clientX;

    setIsDragging(true);
    setDisplayValue(snappedValue);
    onChange({ target: { value: snappedValue } });
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLInputElement>) => {
    if (disabled) {
      return;
    }

    if (e.touches.length === 0) return;

    const touch = e.touches[0];
    if (!touch) return;
    suppressTouchChangeRef.current = true;

    const inputEl = rangeInputRef.current;
    if (!inputEl) return;

    const rect = inputEl.getBoundingClientRect();
    const fraction = max !== min ? (rangeValue - min) / (max - min) : 0;
    const thumbX = rect.left + Math.max(0, Math.min(1, fraction)) * rect.width;

    if (Math.abs(touch.clientX - thumbX) > TOUCH_THUMB_HIT_RADIUS_PX) {
      pendingTouchRef.current = null;
      return;
    }

    pendingTouchRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      latestX: touch.clientX,
      startValue: rangeValue,
    };
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLInputElement>) => {
    if (isDragging || !pendingTouchRef.current || e.touches.length === 0) return;

    const touch = e.touches[0];
    if (!touch) return;
    const pendingTouch = pendingTouchRef.current;
    pendingTouch.latestX = touch.clientX;

    const deltaX = touch.clientX - pendingTouch.startX;
    const deltaY = touch.clientY - pendingTouch.startY;

    if (Math.abs(deltaY) > TOUCH_DRAG_THRESHOLD_PX && Math.abs(deltaY) > Math.abs(deltaX)) {
      pendingTouchRef.current = null;
      return;
    }

    if (Math.abs(deltaX) < TOUCH_DRAG_THRESHOLD_PX || Math.abs(deltaX) < Math.abs(deltaY)) {
      return;
    }

    const inputEl = rangeInputRef.current;
    if (!inputEl) return;

    const rect = inputEl.getBoundingClientRect();
    const rawValue = pendingTouch.startValue + (deltaX / rect.width) * (max - min);
    const snappedValue = snapToStep(rawValue);

    accumulatedValueRef.current = rawValue;
    lastPointerXRef.current = touch.clientX;
    pendingTouchRef.current = null;

    if (e.cancelable) {
      e.preventDefault();
    }

    setIsDragging(true);
    setDisplayValue(snappedValue);
    onChange({ target: { value: snappedValue } });
  };

  const handleTouchEnd = () => {
    pendingTouchRef.current = null;
    suppressTouchChangeRef.current = false;
  };

  const handleValueClick = () => {
    if (disabled) {
      return;
    }

    setInputValue(String(value));
    setIsEditing(true);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const textVal = e.target.value;
    if (!/^[0-9.,-]*$/.test(textVal)) {
      return;
    }
    setInputValue(textVal);
    const parseableText = textVal.replace(',', '.');
    const parsedValue = parseFloat(parseableText);
    if (!isNaN(parsedValue)) {
      const clampedValue = Math.max(min, Math.min(max, parsedValue));
      onChange({
        target: {
          value: clampedValue,
        },
      });
    }
  };

  const handleInputCommit = () => {
    let newValue = parseFloat(inputValue.replace(',', '.'));
    if (isNaN(newValue)) {
      newValue = value;
    } else {
      newValue = Math.max(min, Math.min(max, newValue));
    }
    const syntheticEvent = {
      target: {
        value: newValue,
      },
    };
    onChange(syntheticEvent);
    setIsEditing(false);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleInputCommit();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setInputValue(String(value));
      setIsEditing(false);
      e.currentTarget.blur();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      let currentNum = parseFloat(inputValue.replace(',', '.'));
      if (isNaN(currentNum)) {
        currentNum = value;
      }
      const direction = e.key === 'ArrowUp' ? 1 : -1;
      const newValue = currentNum + direction * step;
      const snappedNewValue = snapToStep(newValue);
      setInputValue(String(snappedNewValue));
      onChange({
        target: {
          value: snappedNewValue,
        },
      });
    }
  };

  const handleRangeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.currentTarget.blur();
      return;
    }
    if (GLOBAL_KEYS.includes(e.key)) {
      e.currentTarget.blur();
    }
  };

  const numericValue = Number.isNaN(value) ? 0 : value;
  const canResetFromLabel = typeof label === 'string' && !disabled;
  const labelContent = (
    <>
      <span
        aria-hidden={isLabelHovered && typeof label === 'string'}
        className={`col-start-1 row-start-1 text-sm font-medium text-text-secondary select-none transition-opacity duration-200 ease-in-out ${
          isLabelHovered && typeof label === 'string' ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {label}
      </span>
      {typeof label === 'string' && (
        <span
          aria-hidden={!isLabelHovered}
          className={`col-start-1 row-start-1 text-sm font-medium text-text-primary select-none transition-opacity duration-200 ease-in-out pointer-events-none ${
            isLabelHovered ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {t('ui.slider.reset')}
        </span>
      )}
    </>
  );

  return (
    <div className="mb-2 group" ref={containerRef}>
      <div className="flex justify-between items-center mb-1">
        {canResetFromLabel ? (
          <button
            className="grid border-0 bg-transparent p-0 text-left cursor-pointer"
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
            {labelContent}
          </button>
        ) : (
          <div className="grid border-0 bg-transparent p-0 text-left cursor-default">{labelContent}</div>
        )}
        <div className="w-12 text-right">
          {isEditing ? (
            <input
              className="w-full text-sm text-right bg-card-active border border-gray-500 rounded-sm px-1 py-0 outline-none focus:ring-1 focus:ring-blue-500 text-text-primary"
              disabled={disabled}
              max={max}
              min={min}
              onBlur={handleInputCommit}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              ref={inputRef}
              step={step}
              type="text"
              value={inputValue}
            />
          ) : (
            <button
              className={`border-0 bg-transparent p-0 text-sm text-text-primary w-full text-right select-none ${disabled ? '' : 'cursor-text'}`}
              disabled={disabled}
              onClick={handleValueClick}
              onDoubleClick={handleReset}
              data-tooltip={t('ui.slider.clickToEdit')}
              type="button"
            >
              {decimalPlaces > 0 && numericValue === 0 ? '0' : numericValue.toFixed(decimalPlaces)}
              {suffix && <span className="text-[10px] align-top inline-block mt-0.5 ml-0.5">{suffix}</span>}
            </button>
          )}
        </div>
      </div>

      <div className="relative w-full h-5">
        <div
          className={`absolute top-1/2 left-0 w-full h-1.5 -translate-y-1/4 rounded-full pointer-events-none ${
            trackClassName || 'bg-card-active'
          }`}
        />
        <div
          className="absolute top-1/2 h-1.5 -translate-y-1/4 rounded-full pointer-events-none bg-accent/25"
          style={{
            left: formatPercent(Math.min(fillPercentage, originPercentage)),
            width: formatPercent(Math.abs(fillPercentage - originPercentage)),
          }}
        />
        <input
          ref={rangeInputRef}
          aria-label={typeof label === 'string' ? label : undefined}
          className={`absolute top-1/2 left-0 w-full h-1.5 appearance-none bg-transparent m-0 p-0 slider-input z-10 ${
            disabled ? 'cursor-not-allowed' : 'cursor-pointer'
          } ${isDragging ? 'slider-thumb-active' : ''}`}
          disabled={disabled}
          style={{ margin: 0, touchAction: isDragging ? 'none' : 'pan-y' }}
          max={String(max)}
          min={String(min)}
          onChange={handleChange}
          onDoubleClick={handleReset}
          onKeyDown={handleRangeKeyDown}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          step={String(step)}
          type="range"
          value={rangeValue}
        />
      </div>
    </div>
  );
};

export default Slider;
