import cx from 'clsx';
import type { PointerEventHandler } from 'react';
import { Orientation } from './AppProperties';

interface ResizerProps {
  ariaLabel?: string;
  className?: string | undefined;
  direction: Orientation;
  onMouseDown: PointerEventHandler<HTMLDivElement>;
  testId?: string;
}

const Resizer = ({ ariaLabel, className, direction, onMouseDown, testId }: ResizerProps) => (
  <div
    aria-label={ariaLabel}
    className={cx('shrink-0 bg-transparent z-10 touch-none', className, {
      'w-2 cursor-col-resize': direction === Orientation.Vertical,
      'h-2 cursor-row-resize': direction === Orientation.Horizontal,
    })}
    data-testid={testId}
    role="separator"
    aria-orientation={direction === Orientation.Vertical ? 'vertical' : 'horizontal'}
    onPointerDown={onMouseDown}
    style={{ touchAction: 'none' }}
  />
);

export default Resizer;
