import cx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useManagedFocus } from '../../../hooks/ui/useManagedFocus';
import { TEXT_COLOR_KEYS, TextColors, TextVariants, TextWeights } from '../../../types/typography';
import { editorChromeTokens } from '../editorChromeTokens';
import { inspectorTokens } from '../inspectorTokens';
import Input from './Input';
import UiText from './Text';

export interface OptionItem<T extends React.Key> {
  label: string;
  value: T;
}

interface DropdownProps<T extends React.Key> {
  className?: string;
  onChange: (value: T) => void;
  options: Array<OptionItem<T>>;
  placement?: 'bottom' | 'top';
  placeholder?: string;
  searchPlaceholder?: string;
  value: T | null;
  chrome?: 'app' | 'editor';
  disabled?: boolean;
  ariaLabel?: string;
  density?: 'default' | 'compact';
  triggerClassName?: string;
}

const Dropdown = <T extends React.Key>({
  className = '',
  onChange,
  options,
  placement = 'bottom',
  placeholder = 'Select an option',
  searchPlaceholder = 'Filter options...',
  value,
  chrome = 'app',
  disabled = false,
  ariaLabel,
  density = 'compact',
  triggerClassName = '',
}: DropdownProps<T>) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const selectedOption = options.find((opt) => opt.value === value) || null;

  useManagedFocus(searchInputRef, isOpen && showSearch);

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    setSearchTerm('');
    setShowSearch(false);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        closeDropdown();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [closeDropdown]);

  const handleSelect = (option: OptionItem<T>) => {
    onChange(option.value);
    closeDropdown();
  };

  const filteredOptions = useMemo(() => {
    if (!searchTerm) return options;
    return options.filter((opt) => opt.label.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [options, searchTerm]);

  const isPrintableKey = (e: React.KeyboardEvent): boolean => {
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    return e.key.length === 1;
  };

  const handleContainerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeDropdown();
      return;
    }

    if (e.key === 'Enter') {
      if (isOpen && filteredOptions.length === 1) {
        e.stopPropagation();
        e.preventDefault();
        const option = filteredOptions[0];
        if (option) handleSelect(option);
      }
      return;
    }

    if (e.target === searchInputRef.current) return;

    if (isPrintableKey(e)) {
      e.stopPropagation();
      e.preventDefault();

      setIsOpen(true);
      setShowSearch(true);
      setSearchTerm((prev) => prev + e.key);
    }
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel ?? selectedOption?.label ?? placeholder}
        disabled={disabled}
        className={cx(
          chrome === 'editor'
            ? [
                'flex w-full items-center justify-between gap-2 rounded-sm px-2 text-left text-text-primary',
                inspectorTokens.control.field,
                density === 'compact' ? inspectorTokens.control.fieldCompact : inspectorTokens.control.fieldDefault,
                editorChromeTokens.focusRing,
              ]
            : [
                'w-full border border-border-color rounded-md px-3 mr-4 py-2 flex justify-between items-center text-left disabled:opacity-50 disabled:cursor-not-allowed',
                'focus:ring-accent focus:border-accent focus:outline-hidden focus:ring-2',
                triggerClassName || 'bg-surface',
              ],
          chrome === 'editor' ? triggerClassName : '',
        )}
        onClick={() => {
          if (isOpen) {
            closeDropdown();
            return;
          }

          setIsOpen(true);
        }}
        onKeyDown={handleContainerKeyDown}
        type="button"
      >
        <UiText as="span" variant={TextVariants.label} color={TextColors.primary} className="truncate">
          {selectedOption ? selectedOption.label : placeholder}
        </UiText>
        <ChevronDown
          className={`${TEXT_COLOR_KEYS[TextColors.secondary]} transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          size={20}
        />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            animate={{ opacity: 1, scale: 1 }}
            className={cx(
              'absolute right-0 w-full origin-top-right z-20',
              placement === 'top' ? 'bottom-full mb-2' : 'mt-2',
            )}
            exit={{ opacity: 0, scale: 0.95 }}
            initial={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.1, ease: 'easeOut' }}
          >
            <div
              aria-orientation="vertical"
              className={cx(
                'max-h-80 overflow-y-auto backdrop-blur-md',
                chrome === 'editor'
                  ? 'rounded-sm border border-editor-border bg-editor-panel/95 p-1 shadow-[0_14px_34px_var(--editor-overlay-shadow)]'
                  : 'bg-surface/95 rounded-lg shadow-xl p-2',
              )}
              role="listbox"
            >
              {showSearch && (
                <Input
                  chrome={chrome}
                  density={chrome === 'editor' ? 'compact' : 'default'}
                  ref={searchInputRef}
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                  }}
                  onKeyDown={handleContainerKeyDown}
                  placeholder={searchPlaceholder}
                  className="mb-2"
                />
              )}

              {filteredOptions.map((option: OptionItem<T>) => {
                const isSelected = value === option.value;
                return (
                  <button
                    key={option.value}
                    onClick={() => {
                      handleSelect(option);
                    }}
                    onKeyDown={handleContainerKeyDown}
                    className={cx(
                      'w-full text-left rounded-md flex items-center justify-between',
                      chrome === 'editor'
                        ? 'min-h-7 rounded-sm px-2 py-1 text-[12px] leading-4 transition-colors duration-150 hover:bg-editor-selected-quiet focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring'
                        : 'px-3 py-2 transition-colors duration-150 hover:bg-bg-primary',
                      {
                        'bg-bg-primary': isSelected && chrome !== 'editor',
                        'bg-editor-selected-quiet text-editor-selected-quiet-text': isSelected && chrome === 'editor',
                      },
                    )}
                    role="option"
                    aria-selected={isSelected}
                  >
                    <UiText color={TextColors.primary} weight={isSelected ? TextWeights.semibold : TextWeights.normal}>
                      {option.label}
                    </UiText>
                    {isSelected && <Check size={16} className={TEXT_COLOR_KEYS[TextColors.primary]} />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Dropdown;
