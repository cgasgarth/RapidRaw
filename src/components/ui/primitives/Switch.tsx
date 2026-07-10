import cx from 'clsx';
import type { ChangeEvent } from 'react';
import { TextVariants } from '../../../types/typography';
import { inspectorTokens } from '../inspectorTokens';
import UiText from './Text';

interface SwitchProps {
  checked: boolean;
  chrome?: 'app' | 'editor';
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
  chrome = 'app',
  className = '',
  disabled = false,
  id,
  label,
  onChange,
  tooltip,
  trackClassName,
}: SwitchProps) => {
  const uniqueId = id ?? `switch-${label.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <label
      className={cx(
        'flex items-center justify-between',
        chrome === 'editor' && inspectorTokens.control.switch.root,
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className,
      )}
      htmlFor={uniqueId}
      data-tooltip={tooltip}
      title={disabled ? tooltip : undefined}
    >
      <UiText
        variant={TextVariants.label}
        className={cx('select-none', chrome === 'editor' && inspectorTokens.control.switch.label)}
      >
        {label}
      </UiText>
      <div className={cx('relative', chrome === 'editor' ? inspectorTokens.control.switch.control : 'w-10 h-5')}>
        <input
          checked={checked}
          className="peer sr-only"
          disabled={disabled}
          id={uniqueId}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            if (!disabled) {
              onChange(e.target.checked);
            }
          }}
          type="checkbox"
        />
        <div
          className={cx(
            'h-full w-full rounded-full shadow-inner transition-colors',
            chrome === 'editor' ? inspectorTokens.control.switch.track : 'bg-card-active/50',
            trackClassName,
          )}
        ></div>
        <div
          className={cx(
            'absolute rounded-full transition-[background-color,transform]',
            chrome === 'editor' ? inspectorTokens.control.switch.thumb : 'top-0.5 left-0.5 w-4 h-4',
            {
              'bg-accent': checked && chrome !== 'editor',
              'bg-editor-primary-active': checked && chrome === 'editor',
              'bg-text-secondary/80': !checked && chrome !== 'editor',
              'bg-editor-disabled': !checked && chrome === 'editor',
            },
          )}
          style={{ transform: `translateX(${checked ? (chrome === 'editor' ? 16 : 20) : 0}px)` }}
        />
      </div>
    </label>
  );
};

export default Switch;
