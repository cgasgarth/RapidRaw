import cx from 'clsx';
import { motion } from 'framer-motion';
import { Clock3, Search, X } from 'lucide-react';
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useUIStore } from '../../../store/useUIStore';
import type { Panel } from '../../ui/AppProperties';
import { getRecentRightPanelEntries, RIGHT_PANEL_GROUPS, searchRightPanels } from './rightPanelRegistry';

interface RightPanelSwitcherProps {
  activePanel: Panel | null;
  onPanelSelect: (id: Panel) => void;
  isInstantTransition: boolean;
  layout?: 'horizontal' | 'vertical';
}

export default function RightPanelSwitcher({
  activePanel,
  onPanelSelect,
  isInstantTransition,
  layout = 'vertical',
}: RightPanelSwitcherProps) {
  const { t } = useTranslation();
  const isHorizontal = layout === 'horizontal';
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const activeIndicatorId = useId();
  const searchPopoverId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const searchDisclosureRef = useRef<HTMLButtonElement | null>(null);
  const panelButtonRefs = useRef(new Map<Panel, HTMLButtonElement>());
  const searchResultButtonRefs = useRef(new Map<Panel, HTMLButtonElement>());
  const pendingFocusRef = useRef<Panel | 'search' | null>(null);
  const { recentRightPanels } = useUIStore(
    useShallow((state) => ({
      recentRightPanels: state.recentRightPanels,
    })),
  );

  const searchResults = useMemo(() => searchRightPanels(query), [query]);
  const visibleRecentPanels = useMemo(
    () => getRecentRightPanelEntries(recentRightPanels, activePanel),
    [activePanel, recentRightPanels],
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (isSearchOpen) {
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }

      const pendingFocus = pendingFocusRef.current;
      pendingFocusRef.current = null;
      if (pendingFocus === 'search') {
        searchDisclosureRef.current?.focus();
      } else if (pendingFocus !== null) {
        panelButtonRefs.current.get(pendingFocus)?.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isSearchOpen]);

  const closeSearch = (focusTarget: Panel | 'search' | null = null) => {
    if (isSearchOpen) {
      pendingFocusRef.current = focusTarget;
    }
    setIsSearchOpen(false);
    setQuery('');
  };

  const selectPanel = (id: Panel) => {
    onPanelSelect(id);
    closeSearch(id);
  };

  const focusSearchResult = (index: number) => {
    const panel = searchResults[index];
    if (panel !== undefined) {
      searchResultButtonRefs.current.get(panel.id)?.focus();
    }
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSearch('search');
      return;
    }

    if (event.key === 'Enter') {
      const firstResult = searchResults[0];
      if (firstResult === undefined) return;

      event.preventDefault();
      selectPanel(firstResult.id);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusSearchResult(0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusSearchResult(searchResults.length - 1);
    }
  };

  const handleSearchResultKeyDown = (event: KeyboardEvent<HTMLButtonElement>, panel: Panel) => {
    const currentIndex = searchResults.findIndex((result) => result.id === panel);
    if (currentIndex === -1) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusSearchResult(Math.min(currentIndex + 1, searchResults.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (currentIndex === 0) {
        inputRef.current?.focus();
      } else {
        focusSearchResult(currentIndex - 1);
      }
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusSearchResult(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusSearchResult(searchResults.length - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeSearch('search');
    }
  };

  return (
    <div
      data-testid={`right-panel-switcher-${layout}`}
      className={cx(
        'relative bg-editor-matte',
        isHorizontal
          ? 'min-h-11 px-1.5 py-1'
          : 'flex h-full min-h-0 flex-col items-center overflow-visible px-1 py-1.5',
      )}
    >
      <div
        className={cx(
          isHorizontal
            ? 'flex min-w-0 items-center overflow-x-auto'
            : 'flex h-full min-h-0 w-full flex-col items-center',
        )}
      >
        <div
          className={cx(
            'flex shrink-0 items-center',
            isHorizontal ? 'mr-1 border-r border-editor-border pr-1' : 'mb-1 border-b border-editor-border pb-1',
          )}
        >
          <button
            aria-controls={isSearchOpen ? searchPopoverId : undefined}
            aria-expanded={isSearchOpen}
            aria-label={t('editor.switcher.search.open', { defaultValue: 'Search panels' })}
            className={cx(
              'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-transparent text-text-secondary transition-colors duration-150 hover:border-editor-border hover:bg-editor-panel-raised hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-editor-matte',
              isSearchOpen && 'border-editor-border bg-editor-panel-raised text-text-primary',
            )}
            data-testid={`right-panel-search-disclosure-${layout}`}
            data-tooltip={t('editor.switcher.search.open', { defaultValue: 'Search panels' })}
            onClick={() => {
              if (isSearchOpen) {
                closeSearch('search');
              } else {
                setIsSearchOpen(true);
              }
            }}
            ref={searchDisclosureRef}
            type="button"
          >
            <Search size={17} />
          </button>
        </div>

        {RIGHT_PANEL_GROUPS.map((group, groupIndex) => (
          <div
            key={groupIndex}
            className={cx(
              isHorizontal
                ? cx('flex shrink-0 items-center gap-1', groupIndex > 0 && 'ml-1 border-l border-editor-border pl-1')
                : groupIndex === 0
                  ? 'flex min-h-0 flex-1 flex-col items-center gap-1'
                  : 'flex shrink-0 flex-col items-center gap-1 border-t border-editor-border pt-1',
            )}
            data-testid={`right-panel-switcher-group-${groupIndex}`}
          >
            {group.map(({ fallbackLabel, icon: Icon, id, priority, tooltipKey }) => {
              const isActive = activePanel === id;
              const isPrimary = priority === 'primary';

              return (
                <button
                  aria-label={t(tooltipKey, { defaultValue: fallbackLabel })}
                  aria-pressed={isActive}
                  className={cx(
                    'relative isolate flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-transparent transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-editor-matte disabled:cursor-not-allowed disabled:opacity-45',
                    isActive
                      ? isPrimary
                        ? 'bg-editor-primary-active text-editor-primary-active-text'
                        : 'bg-editor-selected-quiet text-editor-selected-quiet-text'
                      : isPrimary
                        ? 'text-text-primary hover:border-editor-border hover:bg-editor-panel-raised'
                        : 'text-text-secondary hover:bg-editor-panel-raised hover:text-text-primary',
                  )}
                  data-panel-id={id}
                  data-panel-priority={priority}
                  data-panel-state={isActive ? 'active' : 'idle'}
                  data-testid={`right-panel-switcher-button-${id}`}
                  data-tooltip={t(tooltipKey, { defaultValue: fallbackLabel })}
                  key={id}
                  onClick={() => {
                    selectPanel(id);
                  }}
                  ref={(button) => {
                    if (button === null) {
                      panelButtonRefs.current.delete(id);
                    } else {
                      panelButtonRefs.current.set(id, button);
                    }
                  }}
                  type="button"
                >
                  {isActive && (
                    <motion.span
                      aria-hidden="true"
                      layoutId={`${activeIndicatorId}-active-panel-indicator`}
                      className={cx(
                        'absolute inset-y-1 left-0 w-0.5 rounded-full',
                        isPrimary ? 'bg-editor-primary-active-text' : 'bg-editor-selected-quiet-text',
                      )}
                      transition={
                        isInstantTransition ? { duration: 0 } : { type: 'spring', bounce: 0.2, duration: 0.32 }
                      }
                    />
                  )}
                  <Icon size={18} className="relative z-10" />
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {isSearchOpen && (
        <div
          aria-label={t('editor.switcher.search.inputLabel', { defaultValue: 'Search right panels' })}
          className={cx(
            'absolute z-30 flex max-h-[min(28rem,calc(100vh-1rem))] w-72 flex-col overflow-hidden rounded-md border border-editor-border bg-editor-panel text-text-primary shadow-2xl',
            isHorizontal ? 'bottom-full left-0 mb-1 w-[min(24rem,calc(100vw-1rem))]' : 'left-full top-1 ml-1',
          )}
          data-testid={`right-panel-search-popover-${layout}`}
          id={searchPopoverId}
          role="dialog"
        >
          <div className="flex min-h-10 items-center gap-2 border-b border-editor-border px-2">
            <Search size={15} className="shrink-0 text-text-tertiary" />
            <input
              aria-label={t('editor.switcher.search.inputLabel', { defaultValue: 'Search right panels' })}
              className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
              data-testid={`right-panel-search-input-${layout}`}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder={t('editor.switcher.search.placeholder', { defaultValue: 'Find a panel' })}
              ref={inputRef}
              value={query}
            />
            <button
              aria-label={t('editor.switcher.search.close', { defaultValue: 'Close panel search' })}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-secondary hover:bg-editor-selected-quiet hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring"
              onClick={() => {
                closeSearch('search');
              }}
              type="button"
            >
              <X size={15} />
            </button>
          </div>

          <div className="min-h-0 overflow-y-auto py-1">
            {visibleRecentPanels.length > 0 && (
              <div className="pb-1">
                <div className="flex items-center gap-1.5 px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-normal text-text-tertiary">
                  <Clock3 size={12} aria-hidden="true" />
                  {t('editor.switcher.search.recent', { defaultValue: 'Recent' })}
                </div>
                {visibleRecentPanels.map(({ fallbackLabel, icon: Icon, id, shortLabel, tooltipKey }) => (
                  <button
                    aria-current={activePanel === id ? 'page' : undefined}
                    className={cx(
                      'flex min-h-9 w-full items-center gap-2 px-2 text-left text-sm text-text-primary hover:bg-editor-selected-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-editor-focus-ring',
                      activePanel === id && 'bg-editor-selected-quiet',
                    )}
                    data-panel-id={id}
                    data-testid={`right-panel-recent-row-${id}`}
                    key={id}
                    onClick={() => {
                      selectPanel(id);
                    }}
                    type="button"
                  >
                    <Icon size={16} className="shrink-0 text-text-secondary" />
                    <span className="min-w-0 flex-1 truncate">{t(tooltipKey, { defaultValue: fallbackLabel })}</span>
                    <span className="shrink-0 text-xs text-text-tertiary">{shortLabel}</span>
                  </button>
                ))}
              </div>
            )}

            <div>
              <div className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-normal text-text-tertiary">
                {t('editor.switcher.search.results', { defaultValue: 'Results' })}
              </div>
              {searchResults.map(({ fallbackLabel, icon: Icon, id, keywords, tooltipKey }) => (
                <button
                  aria-current={activePanel === id ? 'page' : undefined}
                  className={cx(
                    'grid min-h-11 w-full grid-cols-[18px_minmax(0,1fr)] items-center gap-x-2 px-2 text-left hover:bg-editor-selected-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-editor-focus-ring',
                    activePanel === id && 'bg-editor-selected-quiet',
                  )}
                  data-panel-id={id}
                  data-testid={`right-panel-search-result-row-${id}`}
                  key={id}
                  onClick={() => {
                    selectPanel(id);
                  }}
                  onKeyDown={(event) => {
                    handleSearchResultKeyDown(event, id);
                  }}
                  ref={(button) => {
                    if (button === null) {
                      searchResultButtonRefs.current.delete(id);
                    } else {
                      searchResultButtonRefs.current.set(id, button);
                    }
                  }}
                  type="button"
                >
                  <Icon size={16} className="row-span-2 shrink-0 text-text-secondary" />
                  <span className="min-w-0 truncate text-sm text-text-primary">
                    {t(tooltipKey, { defaultValue: fallbackLabel })}
                  </span>
                  <span className="min-w-0 truncate text-xs text-text-tertiary">{keywords.slice(0, 3).join(', ')}</span>
                </button>
              ))}
              {searchResults.length === 0 && (
                <div className="px-3 py-4 text-sm text-text-secondary" data-testid="right-panel-search-empty">
                  {t('editor.switcher.search.empty', { defaultValue: 'No panels found' })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
