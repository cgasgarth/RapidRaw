import cx from 'clsx';
import { useRef } from 'react';
import { inspectorTokens } from '../inspectorTokens';

export interface InspectorSegmentedControlOption<T extends string> {
  disabled?: boolean;
  label: string;
  value: T;
}

interface InspectorSegmentedControlProps<T extends string> {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  onChange: (value: T) => void;
  options: readonly InspectorSegmentedControlOption<T>[];
  value: T;
}

export default function InspectorSegmentedControl<T extends string>({
  ariaLabel,
  className,
  disabled = false,
  onChange,
  options,
  value,
}: InspectorSegmentedControlProps<T>) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectAtIndex = (index: number) => {
    const option = options[index];
    if (!option || disabled || option.disabled) {
      return;
    }
    onChange(option.value);
    optionRefs.current[index]?.focus();
  };

  const findEnabledIndex = (startIndex: number, direction: 1 | -1) => {
    for (let offset = 1; offset <= options.length; offset += 1) {
      const index = (startIndex + direction * offset + options.length) % options.length;
      const option = options[index];
      if (option && !option.disabled) {
        return index;
      }
    }
    return startIndex;
  };

  return (
    <div aria-label={ariaLabel} className={cx(inspectorTokens.control.segmented.root, className)} role="radiogroup">
      {options.map((option, index) => {
        const isSelected = option.value === value;
        const isDisabled = disabled || option.disabled === true;

        return (
          <button
            aria-checked={isSelected}
            className={inspectorTokens.control.segmented.option}
            disabled={isDisabled}
            key={option.value}
            onClick={() => {
              if (!isDisabled) {
                onChange(option.value);
              }
            }}
            onKeyDown={(event) => {
              let nextIndex: number | null = null;
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                nextIndex = findEnabledIndex(index, 1);
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                nextIndex = findEnabledIndex(index, -1);
              } else if (event.key === 'Home') {
                nextIndex = options.findIndex((candidate) => !candidate.disabled);
              } else if (event.key === 'End') {
                nextIndex = options.findLastIndex((candidate) => !candidate.disabled);
              }

              if (nextIndex !== null && nextIndex >= 0) {
                event.preventDefault();
                selectAtIndex(nextIndex);
              }
            }}
            ref={(element) => {
              optionRefs.current[index] = element;
            }}
            role="radio"
            tabIndex={isSelected ? 0 : -1}
            type="button"
          >
            <span className="block truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
