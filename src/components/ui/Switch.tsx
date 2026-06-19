import cx from 'clsx';

import UiText from './Text';
import { TextVariants } from '../../types/typography';

import type { ChangeEvent } from 'react';

interface SwitchProps {
  checked: boolean;
  className?: string;
  disabled?: boolean;
  id?: string;
  label: string;
  onChange: (val: boolean) => void;
  tooltip?: string;
  trackClassName?: string;
}

/**
 * A beautiful, reusable, and accessible toggle switch component.
 *
 * @param {string} label - The text label for the switch.
 * @param {boolean} checked - The current state of the switch.
 * @param {function(boolean): void} onChange - Callback function that receives the new boolean state.
 * @param {boolean} [disabled=false] - Whether the switch is interactive.
 * @param {string} [className=''] - Additional classes for the container.
 * @param {string} [trackClassName] - Custom classes for the switch's background track.
 */
const Switch = ({
  checked,
  className = '',
  disabled = false,
  label,
  onChange,
  tooltip,
  trackClassName,
}: SwitchProps) => {
  const uniqueId = `switch-${label.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <label
      className={cx(
        'flex items-center justify-between',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className,
      )}
      htmlFor={uniqueId}
      data-tooltip={tooltip}
    >
      <UiText variant={TextVariants.label} className="select-none">
        {label}
      </UiText>
      <div className="relative w-10 h-5">
        <input
          checked={checked}
          className="sr-only"
          disabled={disabled}
          id={uniqueId}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            if (!disabled) {
              onChange(e.target.checked);
            }
          }}
          type="checkbox"
        />
        <div className={cx('w-full h-full bg-card-active/50 rounded-full shadow-inner', trackClassName)}></div>
        <div
          className={cx('absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-[background-color,transform]', {
            'bg-accent': checked,
            'bg-text-secondary/80': !checked,
          })}
          style={{ transform: `translateX(${checked ? 20 : 0}px)` }}
        />
      </div>
    </label>
  );
};

export default Switch;
