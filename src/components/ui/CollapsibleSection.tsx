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
import { inspectorSectionTokens } from './inspectorTokens';
import UiText from './primitives/Text';

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
    <div className={inspectorSectionTokens.shell} onContextMenu={onContextMenu}>
      <div
        className={inspectorSectionTokens.header}
        aria-expanded={isOpen}
        onClick={onToggle}
        onKeyDown={handleHeaderKeyDown}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        role="button"
        tabIndex={0}
      >
        <div className={inspectorSectionTokens.titleRow}>
          <UiText variant={TextVariants.label} weight={TextWeights.medium} className={inspectorSectionTokens.title}>
            {title}
          </UiText>
          {canToggleVisibility && (
            <div className={inspectorSectionTokens.visibilitySlot}>
              <button
                className={cx(
                  inspectorSectionTokens.visibilityButton,
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
        <ChevronDown className={cx(inspectorSectionTokens.chevron, { 'rotate-180': isOpen })} size={16} />
      </div>
      <div ref={wrapperRef} className="overflow-hidden transition-all duration-300 ease-in-out">
        <div
          className={cx(inspectorSectionTokens.body, !isContentVisible && 'opacity-30 pointer-events-none')}
          ref={contentRef}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
