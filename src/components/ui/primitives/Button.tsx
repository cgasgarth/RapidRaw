import cx from 'clsx';
import { LoaderCircle } from 'lucide-react';
import { type ButtonHTMLAttributes, forwardRef, type MouseEventHandler, type ReactNode } from 'react';
import { editorChromeTokens } from '../editorChromeTokens';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  onClick: MouseEventHandler<HTMLButtonElement>;
  size?: string;
  variant?: string;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ children, onClick, disabled, className = '', size = 'default', variant = 'default', ...props }, ref) => {
    const isBusy = props['aria-busy'] === true || props['aria-busy'] === 'true';
    const isEditorVariant = variant.startsWith('editor');
    const baseClasses = isEditorVariant
      ? cx(
          editorChromeTokens.button.base,
          editorChromeTokens.focusRing,
          editorChromeTokens.button.disabled,
          editorChromeTokens.button.loading,
          size === 'icon' ? editorChromeTokens.button.icon : 'min-h-8 px-3 py-1.5 text-[12px] leading-4',
        )
      : `
        flex items-center justify-center gap-2
        font-semibold py-2 px-4 rounded-md
        text-button-text text-md
        transition-transform duration-200
        hover:scale-[1.01] active:scale-[.98]
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
        disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:hover:scale-100
      `;

    const hasSurfaceBg = className.includes('bg-surface');
    const variantClasses = {
      default: hasSurfaceBg ? 'bg-surface' : 'bg-accent shadow-shiny',
      destructive: 'bg-danger text-white shadow-none hover:bg-danger/90',
      editorDestructive: editorChromeTokens.button.destructive,
      editorPrimary: editorChromeTokens.button.primary,
      editorQuiet: editorChromeTokens.button.quiet,
      editorSelected: cx(editorChromeTokens.button.quiet, editorChromeTokens.button.selectedQuiet),
      secondary: 'bg-surface text-text-primary shadow-none hover:bg-card-active',
    } as const;

    const combinedClasses = cx(
      baseClasses,
      variant in variantClasses ? variantClasses[variant as keyof typeof variantClasses] : variantClasses.default,
      className,
    );

    return (
      <button ref={ref} onClick={onClick} disabled={disabled || isBusy} className={combinedClasses} {...props}>
        {isBusy && <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />}
        {children}
      </button>
    );
  },
);

Button.displayName = 'Button';

export default Button;
