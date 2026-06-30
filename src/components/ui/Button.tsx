import cx from 'clsx';
import { type ButtonHTMLAttributes, forwardRef, type MouseEventHandler, type ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  onClick: MouseEventHandler<HTMLButtonElement>;
  size?: string;
  variant?: string;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ children, onClick, disabled, className = '', ...props }, ref) => {
    const baseClasses = `
    flex items-center justify-center gap-2 
    font-semibold py-2 px-4 rounded-md 
    text-button-text text-md
    transition-transform duration-200 
    hover:scale-[1.01] active:scale-[.98]
    disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:hover:scale-100
  `;

    const hasSurfaceBg = className.includes('bg-surface');

    const combinedClasses = cx(
      baseClasses,
      {
        'bg-accent shadow-shiny': !hasSurfaceBg,
        'bg-surface': hasSurfaceBg,
      },
      className,
    );

    return (
      <button ref={ref} onClick={onClick} disabled={disabled} className={combinedClasses} {...props}>
        {children}
      </button>
    );
  },
);

Button.displayName = 'Button';

export default Button;
