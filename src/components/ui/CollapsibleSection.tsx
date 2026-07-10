import cx from 'clsx';
import { ChevronDown, Eye, EyeOff, type LucideIcon, MoreHorizontal } from 'lucide-react';
import {
  type KeyboardEvent,
  type MouseEvent,
  type MouseEventHandler,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from 'react';
import { useTranslation } from 'react-i18next';
import { TextVariants, TextWeights } from '../../types/typography';
import { inspectorSectionTokens, inspectorTokens } from './inspectorTokens';
import UiText from './primitives/Text';

export interface CollapsibleSectionHeaderAction {
  className?: string;
  disabled?: boolean;
  disabledReason?: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  testId?: string;
}

export interface CollapsibleSectionProps {
  actionsMenuLabel?: string;
  actionsMenuTestId?: string;
  canToggleVisibility?: boolean;
  children: ReactNode;
  headerActions?: CollapsibleSectionHeaderAction[];
  isContentVisible: boolean;
  isDirty?: boolean;
  isOpen: boolean;
  onContextMenu?: MouseEventHandler<HTMLDivElement>;
  onOpenActionsMenu?: (x: number, y: number) => void;
  onToggle: () => void;
  onToggleVisibility?: () => void;
  status?: ReactNode;
  testId?: string;
  title: string;
}

export default function CollapsibleSection({
  actionsMenuLabel,
  actionsMenuTestId,
  canToggleVisibility = false,
  children,
  headerActions = [],
  isContentVisible,
  isDirty = false,
  isOpen,
  onContextMenu,
  onOpenActionsMenu,
  onToggle,
  onToggleVisibility = () => {},
  status,
  testId,
  title,
}: CollapsibleSectionProps) {
  const { t } = useTranslation();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLButtonElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const contentId = useId();
  const titleId = useId();

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

    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const resizeObserver = new ResizeObserver(updateMaxHeight);
    resizeObserver.observe(content);

    return () => {
      resizeObserver.disconnect();
    };
  }, [isOpen]);

  useEffect(() => {
    const content = contentRef.current;
    if (!isOpen && content?.contains(document.activeElement)) {
      headerRef.current?.focus();
    }
  }, [isOpen]);

  const handleVisibilityClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onToggleVisibility();
  };

  const handleActionClick = (event: MouseEvent<HTMLButtonElement>, action: CollapsibleSectionHeaderAction) => {
    event.stopPropagation();
    if (action.disabled) {
      return;
    }
    action.onClick();
  };

  const handleMenuClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    onOpenActionsMenu?.(rect.left, rect.bottom + 4);
  };

  const handleActionKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  const handleHeaderKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.shiftKey && event.key === 'F10' && onOpenActionsMenu) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      onOpenActionsMenu(rect.left, rect.bottom + 4);
      return;
    }
  };

  return (
    <div className={inspectorSectionTokens.shell} onContextMenu={onContextMenu}>
      <div className={cx(inspectorSectionTokens.header, !isContentVisible && 'bg-bg-primary')}>
        <button
          aria-controls={contentId}
          aria-expanded={isOpen}
          className={cx(
            inspectorSectionTokens.titleRow,
            'min-h-6 flex-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring',
          )}
          data-testid={testId ? `${testId}-toggle` : undefined}
          onClick={onToggle}
          onKeyDown={handleHeaderKeyDown}
          ref={headerRef}
          type="button"
        >
          <ChevronDown
            aria-hidden="true"
            className={cx(inspectorSectionTokens.chevron, { 'rotate-180': isOpen })}
            size={14}
          />
          <UiText
            id={titleId}
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
            <span
              aria-label={t('ui.collapsibleSection.dirtyBadge', { defaultValue: 'Edited' })}
              className={inspectorSectionTokens.dirtyIndicator}
              role="status"
              title={t('ui.collapsibleSection.dirtyBadge', { defaultValue: 'Edited' })}
            >
              {t('ui.collapsibleSection.dirtyBadge', { defaultValue: 'Edited' })}
            </span>
          )}
          {status ? <span className="shrink-0 text-[10px] leading-4 text-text-secondary">{status}</span> : null}
        </button>
        <div className={inspectorTokens.actionRow.root}>
          {headerActions.length > 0 && (
            <div className={inspectorSectionTokens.headerActions}>
              {headerActions.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    aria-label={action.label}
                    aria-pressed={action.pressed}
                    className={cx(
                      inspectorSectionTokens.headerActionButton,
                      action.disabled && 'cursor-not-allowed opacity-50',
                      action.className,
                    )}
                    data-tooltip={action.disabledReason ?? action.label}
                    data-testid={action.testId}
                    disabled={action.disabled ?? false}
                    key={action.label}
                    onClick={(event) => {
                      handleActionClick(event, action);
                    }}
                    onKeyDown={handleActionKeyDown}
                    title={action.disabledReason ?? action.label}
                    type="button"
                  >
                    <Icon size={14} />
                  </button>
                );
              })}
            </div>
          )}
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
                onKeyDown={handleActionKeyDown}
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
          {onOpenActionsMenu && (
            <div className={inspectorSectionTokens.actionsMenuSlot}>
              <button
                aria-label={actionsMenuLabel ?? title}
                className={inspectorSectionTokens.headerActionButton}
                data-tooltip={actionsMenuLabel ?? title}
                data-testid={actionsMenuTestId}
                onClick={handleMenuClick}
                onKeyDown={handleActionKeyDown}
                type="button"
              >
                <MoreHorizontal size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
      <div ref={wrapperRef} className="overflow-hidden transition-all duration-200 ease-in-out">
        <div
          aria-hidden={!isOpen || !isContentVisible}
          aria-labelledby={titleId}
          className={cx(inspectorSectionTokens.body, !isContentVisible && 'opacity-30 pointer-events-none')}
          id={contentId}
          inert={!isOpen || !isContentVisible ? true : undefined}
          ref={contentRef}
          role="region"
        >
          {children}
        </div>
      </div>
    </div>
  );
}
