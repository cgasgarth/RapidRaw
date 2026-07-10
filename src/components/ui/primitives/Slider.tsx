import cx from 'clsx';
import type React from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GLOBAL_KEYS } from '../AppProperties';
import { compactInspectorSliderTokens, inspectorSliderTokens } from '../inspectorTokens';

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
  density?: 'default' | 'compact';
  testId?: string;
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
  density = 'default',
  testId,
}: SliderProps) => {
  const { t } = useTranslation();
  const [displayValue, setDisplayValue] = useState<number>(value);
  const displayValueRef = useRef<number>(value);
  const [isDragging, setIsDragging] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState<string>(String(value));
  const editStartValueRef = useRef<number>(value);
  const skipNextBlurCommitRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rangeInputRef = useRef<HTMLInputElement | null>(null);
  const valueButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreValueFocusAfterEditRef = useRef(false);
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
    if (!isDragging && !isWheelActive) {
      setDisplayValue(value);
    }
  }, [isDragging, isWheelActive, value]);

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
      const clampedValue = snapToStep(displayValueRef.current + direction * step);

      if (clampedValue !== value && !Number.isNaN(clampedValue)) {
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
  }, [value, min, max, step, onChange, snapToStep]);

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

  useEffect(() => {
    if (isEditing || !restoreValueFocusAfterEditRef.current) {
      return undefined;
    }

    restoreValueFocusAfterEditRef.current = false;
    const restoreFocusTimeout = window.setTimeout(() => {
      valueButtonRef.current?.focus();
    }, 0);

    return () => {
      window.clearTimeout(restoreFocusTimeout);
    };
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

  const handleRangeValueChange = (e: React.FormEvent<HTMLInputElement>) => {
    if (disabled) {
      return;
    }

    if (suppressTouchChangeRef.current) {
      return;
    }

    if (!isDragging) {
      setDisplayValue(Number(e.currentTarget.value));
      onChange({
        target: {
          value: e.currentTarget.value,
        },
      });
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

    editStartValueRef.current = value;
    setInputValue(String(value));
    setIsEditing(true);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const textVal = e.target.value;
    if (!/^[0-9.,-]*$/.test(textVal)) {
      return;
    }
    setInputValue(textVal);
  };

  const handleInputCommit = () => {
    const committedText = inputRef.current?.value ?? inputValue;
    let newValue = parseFloat(committedText.replace(',', '.'));
    if (Number.isNaN(newValue)) {
      newValue = value;
    } else {
      newValue = Math.max(min, Math.min(max, newValue));
    }
    const syntheticEvent = {
      target: {
        value: newValue,
      },
    };
    setIsEditing(false);
    onChange(syntheticEvent);
  };

  const handleInputBlur = () => {
    if (skipNextBlurCommitRef.current) {
      skipNextBlurCommitRef.current = false;
      return;
    }
    handleInputCommit();
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();

    if (e.key === 'Enter') {
      skipNextBlurCommitRef.current = true;
      restoreValueFocusAfterEditRef.current = true;
      handleInputCommit();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      skipNextBlurCommitRef.current = true;
      restoreValueFocusAfterEditRef.current = true;
      const startingValue = editStartValueRef.current;
      setInputValue(String(startingValue));
      onChange({
        target: {
          value: startingValue,
        },
      });
      setIsEditing(false);
      e.currentTarget.blur();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      let currentNum = parseFloat(inputValue.replace(',', '.'));
      if (Number.isNaN(currentNum)) {
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
  const tokens = density === 'compact' ? compactInspectorSliderTokens : inspectorSliderTokens;
  const isModified = !disabled && Math.abs(value - defaultValue) > Math.max(Number.EPSILON, step / 1_000);
  const labelContent = (
    <>
      <span
        aria-hidden={isLabelHovered && typeof label === 'string'}
        className={cx(
          tokens.label,
          disabled && 'text-text-tertiary',
          isLabelHovered && typeof label === 'string' ? 'opacity-0' : 'opacity-100',
        )}
      >
        {label}
      </span>
      {typeof label === 'string' && (
        <span
          aria-hidden={!isLabelHovered}
          className={cx(
            tokens.resetLabel,
            disabled && 'text-text-tertiary',
            isLabelHovered ? 'opacity-100' : 'opacity-0',
          )}
        >
          {t('ui.slider.reset')}
        </span>
      )}
    </>
  );

  const labelControl = canResetFromLabel ? (
    <button
      className={tokens.labelButton}
      data-testid={testId ? `${testId}-label` : undefined}
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
    <div className={tokens.labelStatic} data-testid={testId ? `${testId}-label` : undefined}>
      {labelContent}
    </div>
  );

  const valueControl = (
    <div className={tokens.valueSlot} data-slider-value-slot="true">
      {isEditing ? (
        <input
          aria-label={typeof label === 'string' ? `${label} value` : undefined}
          className={tokens.valueInput}
          data-testid={testId ? `${testId}-input` : undefined}
          disabled={disabled}
          max={max}
          min={min}
          onBlur={handleInputBlur}
          onChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
          ref={inputRef}
          step={step}
          type="text"
          value={inputValue}
        />
      ) : (
        <button
          aria-label={typeof label === 'string' ? `${label} value` : undefined}
          className={cx(tokens.valueButton, disabled ? 'text-text-tertiary' : 'cursor-text')}
          data-testid={testId ? `${testId}-value` : undefined}
          disabled={disabled}
          onClick={handleValueClick}
          onDoubleClick={handleReset}
          data-tooltip={t('ui.slider.clickToEdit')}
          ref={valueButtonRef}
          type="button"
        >
          {decimalPlaces > 0 && numericValue === 0 ? '0' : numericValue.toFixed(decimalPlaces)}
          {suffix && <span className={tokens.suffix}>{suffix}</span>}
        </button>
      )}
    </div>
  );

  const trackControl = (
    <div className={tokens.trackWrap} data-slider-track="true">
      <div className={cx(tokens.track, trackClassName || 'bg-editor-panel-raised', disabled && 'opacity-70')} />
      <div
        className={cx(tokens.fill, disabled && 'opacity-40')}
        style={{
          left: formatPercent(Math.min(fillPercentage, originPercentage)),
          width: formatPercent(Math.abs(fillPercentage - originPercentage)),
        }}
      />
      <input
        ref={rangeInputRef}
        aria-label={typeof label === 'string' ? label : undefined}
        className={cx(
          tokens.input,
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
          isDragging && 'slider-thumb-active',
        )}
        disabled={disabled}
        data-testid={testId ? `${testId}-range` : undefined}
        style={{ margin: 0, touchAction: isDragging ? 'none' : 'pan-y' }}
        max={String(max)}
        min={String(min)}
        onInput={handleRangeValueChange}
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
  );

  if (density === 'compact') {
    return (
      <div
        className={cx(tokens.root, disabled && 'opacity-65')}
        data-density="compact"
        data-modified={String(isModified)}
        data-testid={testId}
        ref={containerRef}
      >
        {isModified ? <span className="sr-only">{t('ui.slider.modified', { defaultValue: 'Modified' })}</span> : null}
        {labelControl}
        {trackControl}
        {valueControl}
      </div>
    );
  }

  return (
    <div
      className={cx(tokens.root, disabled && 'opacity-65')}
      data-density="default"
      data-modified={String(isModified)}
      data-testid={testId}
      ref={containerRef}
    >
      <div className={inspectorSliderTokens.header}>
        {labelControl}
        {valueControl}
      </div>

      {trackControl}
    </div>
  );
};

export default Slider;
