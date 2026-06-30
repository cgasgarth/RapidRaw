import cx from 'clsx';
import { ChevronDown, Eye, EyeOff } from 'lucide-react';
import {
  type KeyboardEvent,
  type MouseEvent,
  type MouseEventHandler,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { TextVariants, TextWeights } from '../../types/typography';
import UiText from './Text';

interface CollapsibleSectionProps {
  canToggleVisibility?: boolean;
  children: ReactNode;
  isContentVisible: boolean;
  isOpen: boolean;
  onContextMenu?: MouseEventHandler<HTMLDivElement>;
  onToggle: () => void;
  onToggleVisibility?: () => void;
  title: string;
}

export default function CollapsibleSection({
  canToggleVisibility = true,
  children,
  isContentVisible,
  isOpen,
  onContextMenu,
  onToggle,
  onToggleVisibility = () => {},
  title,
}: CollapsibleSectionProps) {
  const { t } = useTranslation();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const content = contentRef.current;
    if (!wrapper || !content) {
      return;
    }

    const updateMaxHeight = () => {
      if (isOpen) {
        const contentHeight = content.scrollHeight;
        wrapper.style.maxHeight = `${String(contentHeight)}px`;
      } else {
        wrapper.style.maxHeight = '0px';
      }
    };

    updateMaxHeight();

    const resizeObserver = new ResizeObserver(updateMaxHeight);
    resizeObserver.observe(content);

    return () => {
      resizeObserver.disconnect();
    };
  }, [isOpen]);

  const handleMouseEnter = () => {
    if (!canToggleVisibility) {
      return;
    }
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovering(true);
    }, 250);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setIsHovering(false);
  };

  const handleVisibilityClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onToggleVisibility();
  };

  const handleHeaderKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    onToggle();
  };

  return (
    <div className="bg-surface rounded-lg overflow-hidden shrink-0" onContextMenu={onContextMenu}>
      <div
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-card-active transition-colors duration-200"
        aria-expanded={isOpen}
        onClick={onToggle}
        onKeyDown={handleHeaderKeyDown}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        role="button"
        tabIndex={0}
      >
        <div className="flex items-center gap-2">
          <UiText variant={TextVariants.title} weight={TextWeights.normal}>
            {title}
          </UiText>
          {canToggleVisibility && (
            <div className="w-6 h-6 flex items-center justify-center">
              <button
                className={cx(
                  'p-1 rounded-full text-text-secondary hover:bg-bg-primary z-10 transition-opacity duration-300',
                  isHovering || !isContentVisible ? 'opacity-100' : 'opacity-0 pointer-events-none',
                )}
                onClick={handleVisibilityClick}
                data-tooltip={
                  isContentVisible
                    ? t('ui.collapsibleSection.disableSection')
                    : t('ui.collapsibleSection.enableSection')
                }
              >
                {isContentVisible ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
            </div>
          )}
        </div>
        <ChevronDown
          className={cx('text-accent transition-transform duration-300', { 'rotate-180': isOpen })}
          size={20}
        />
      </div>
      <div ref={wrapperRef} className="overflow-hidden transition-all duration-300 ease-in-out">
        <div
          className={cx(
            'px-4 pb-4 transition-opacity duration-300',
            !isContentVisible && 'opacity-30 pointer-events-none',
          )}
          ref={contentRef}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
