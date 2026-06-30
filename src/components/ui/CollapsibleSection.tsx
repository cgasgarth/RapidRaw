import cx from 'clsx';
import { ChevronDown, Eye, EyeOff } from 'lucide-react';
import { type KeyboardEvent, type MouseEvent, type MouseEventHandler, type ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { TextVariants, TextWeights } from '../../types/typography';
import { inspectorSectionTokens } from './inspectorTokens';
import UiText from './primitives/Text';

interface CollapsibleSectionProps {
  canToggleVisibility?: boolean;
  children: ReactNode;
  isContentVisible: boolean;
  isDirty?: boolean;
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
  isDirty = false,
  isOpen,
  onContextMenu,
  onToggle,
  onToggleVisibility = () => {},
  title,
}: CollapsibleSectionProps) {
  const { t } = useTranslation();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

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
        className={cx(inspectorSectionTokens.header, !isContentVisible && 'bg-bg-primary')}
        aria-expanded={isOpen}
        onClick={onToggle}
        onKeyDown={handleHeaderKeyDown}
        role="button"
        tabIndex={0}
      >
        <div className={inspectorSectionTokens.titleRow}>
          <ChevronDown className={cx(inspectorSectionTokens.chevron, { 'rotate-180': isOpen })} size={14} />
          <UiText
            variant={TextVariants.label}
            weight={TextWeights.medium}
            className={cx(inspectorSectionTokens.title, !isContentVisible && 'text-text-secondary')}
          >
            {title}
          </UiText>
          {!isContentVisible && (
            <span className={cx(inspectorSectionTokens.badge, inspectorSectionTokens.hiddenBadge)}>
              {t('ui.collapsibleSection.disabledBadge', { defaultValue: 'Off' })}
            </span>
          )}
          {isDirty && (
            <span className={cx(inspectorSectionTokens.badge, inspectorSectionTokens.dirtyBadge)}>
              {t('ui.collapsibleSection.dirtyBadge', { defaultValue: 'Edited' })}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canToggleVisibility && (
            <div className={inspectorSectionTokens.visibilitySlot}>
              <button
                aria-label={
                  isContentVisible
                    ? t('ui.collapsibleSection.disableSection')
                    : t('ui.collapsibleSection.enableSection')
                }
                aria-pressed={!isContentVisible}
                className={cx(inspectorSectionTokens.visibilityButton, !isContentVisible && 'text-accent')}
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
      </div>
      <div ref={wrapperRef} className="overflow-hidden transition-all duration-200 ease-in-out">
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
