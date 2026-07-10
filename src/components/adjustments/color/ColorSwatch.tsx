import { useState } from 'react';

interface ColorSwatchProps<T extends string> {
  color: string;
  isActive: boolean;
  name: T;
  ariaLabel: string;
  label?: string;
  size?: 'sm' | 'md';
  testId?: string;
  onClick: (name: T) => void;
}

export const ColorSwatch = <T extends string>({
  color,
  name,
  isActive,
  ariaLabel,
  label,
  size = 'md',
  testId,
  onClick,
}: ColorSwatchProps<T>) => {
  const [isPressed, setIsPressed] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseDown = () => {
    setIsPressed(true);
  };

  const handleMouseUp = () => {
    setIsPressed(false);
  };

  const handleMouseLeave = () => {
    setIsPressed(false);
    setIsHovered(false);
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleClick = () => {
    onClick(name);
  };

  const getTransform = () => {
    if (isPressed) return 'scale(0.95)';
    if (isActive) return 'scale(1.1)';
    if (isHovered) return 'scale(1.08)';
    return 'scale(1)';
  };

  const swatchSizeClass = size === 'sm' ? 'h-5 w-5' : 'h-6 w-6';
  const activeScale = size === 'sm' ? 'scale(1.06)' : 'scale(1.1)';

  return (
    <button
      aria-label={ariaLabel}
      className={`group flex min-w-0 flex-col items-center gap-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring ${label ? 'w-full' : `${swatchSizeClass} justify-self-center`}`}
      data-testid={testId}
      data-tooltip={ariaLabel}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onMouseEnter={handleMouseEnter}
      onTouchStart={handleMouseDown}
      onTouchEnd={handleMouseUp}
      type="button"
    >
      <span className={`relative block shrink-0 ${swatchSizeClass}`}>
        <span
          className={`absolute inset-0 rounded-full border-2 transition-all duration-200 ease-out ${
            isActive ? 'border-white opacity-100' : 'scale-100 border-transparent opacity-0'
          }`}
          style={{
            transform: isActive ? (isPressed ? 'scale(1.1)' : 'scale(1.25)') : undefined,
            transition: isPressed
              ? 'transform 100ms cubic-bezier(0.4, 0, 0.2, 1), opacity 200ms ease-out'
              : 'transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 200ms ease-out',
          }}
        />

        <span
          className={`absolute inset-0 rounded-full transition-all duration-150 ease-out ${
            isActive ? 'shadow-lg' : 'shadow-md'
          }`}
          style={{
            backgroundColor: color,
            transform: isActive && !isPressed ? activeScale : getTransform(),
            transition: isPressed
              ? 'transform 100ms cubic-bezier(0.4, 0, 0.2, 1)'
              : 'transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
        />
      </span>
      {label && (
        <span
          className={`max-w-full truncate text-[10px] leading-none ${
            isActive ? 'font-semibold text-text-primary' : 'font-medium text-text-tertiary'
          }`}
        >
          {label}
        </span>
      )}
    </button>
  );
};
