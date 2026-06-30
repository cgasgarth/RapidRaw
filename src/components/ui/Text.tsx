import cx from 'clsx';
import { type ElementType, forwardRef, type HTMLAttributes, type ReactNode } from 'react';

import {
  TEXT_COLOR_KEYS,
  TEXT_WEIGHT_KEYS,
  type TextColor,
  TextVariants,
  type TextWeight,
  type VariantConfig,
} from '../../types/typography';

export interface TextProps extends HTMLAttributes<HTMLElement> {
  variant?: VariantConfig;
  weight?: TextWeight;
  color?: TextColor;
  as?: ElementType;
  children: ReactNode;
}

export const Text = forwardRef<HTMLElement, TextProps>(
  ({ variant = TextVariants.body, weight, color, as, className, children, ...props }, ref) => {
    const Component = as || variant.defaultElement;

    return (
      <Component
        ref={ref}
        className={cx(
          variant.size,
          TEXT_WEIGHT_KEYS[weight ?? variant.defaultWeight],
          TEXT_COLOR_KEYS[color ?? variant.defaultColor],
          variant.extraClasses,
          className,
        )}
        {...props}
      >
        {children}
      </Component>
    );
  },
);

Text.displayName = 'Text';
export default Text;
