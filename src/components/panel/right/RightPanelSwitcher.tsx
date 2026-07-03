import cx from 'clsx';
import { motion } from 'framer-motion';
import { Clock3, Search, X } from 'lucide-react';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useUIStore } from '../../../store/useUIStore';
import type { Panel } from '../../ui/AppProperties';
import { getRightPanelEntry, RIGHT_PANEL_GROUPS, searchRightPanels } from './rightPanelRegistry';

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
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { recentRightPanels } = useUIStore(
    useShallow((state) => ({
      recentRightPanels: state.recentRightPanels,
    })),
  );

  const searchResults = useMemo(() => searchRightPanels(query), [query]);
  const visibleRecentPanels = useMemo(
    () =>
      recentRightPanels
        .filter((panel) => panel !== activePanel)
        .slice(0, 4)
        .map(getRightPanelEntry),
    [activePanel, recentRightPanels],
  );

  useEffect(() => {
    if (!isSearchOpen) return;

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isSearchOpen]);

  const closeSearch = () => {
    setIsSearchOpen(false);
    setQuery('');
  };

  const selectPanel = (id: Panel) => {
    onPanelSelect(id);
    closeSearch();
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSearch();
      return;
    }

    if (event.key === 'Enter') {
      const firstResult = searchResults[0];
      if (firstResult === undefined) return;

      event.preventDefault();
      selectPanel(firstResult.id);
    }
  };

  return (
    <div
      data-testid={`right-panel-switcher-${layout}`}
      className={cx(
        'relative bg-editor-matte',
        isHorizontal ? 'min-h-11 px-1.5 py-1' : 'flex h-full flex-col items-center gap-1 overflow-visible px-1 py-1.5',
      )}
    >
      <div
        className={cx(isHorizontal ? 'flex items-center gap-1 overflow-x-auto' : 'flex flex-col items-center gap-1')}
      >
        <button
          aria-expanded={isSearchOpen}
          aria-label={t('editor.switcher.search.open', { defaultValue: 'Search panels' })}
          className={cx(
            'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-transparent text-text-secondary transition-colors duration-150 hover:border-editor-border hover:bg-editor-panel-raised hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-editor-matte',
            isSearchOpen && 'border-editor-border bg-editor-panel-raised text-text-primary',
          )}
          data-testid={`right-panel-search-disclosure-${layout}`}
          data-tooltip={t('editor.switcher.search.open', { defaultValue: 'Search panels' })}
          onClick={() => {
            setIsSearchOpen((current) => !current);
          }}
          type="button"
        >
          <Search size={17} />
        </button>

        {RIGHT_PANEL_GROUPS.map((group, groupIndex) => (
          <div
            key={groupIndex}
            className={isHorizontal ? 'flex items-center gap-1' : 'flex flex-col gap-1'}
            data-testid={`right-panel-switcher-group-${groupIndex}`}
          >
            {groupIndex > 0 && (
              <div
                className={
                  isHorizontal
                    ? 'my-auto h-6 w-px self-center bg-editor-border'
                    : 'my-1 h-px w-6 self-center bg-editor-border'
                }
              />
            )}
            {group.map(({ fallbackLabel, icon: Icon, id, priority, tooltipKey }) => {
              const isActive = activePanel === id;
              const isPrimary = priority === 'primary';

              return (
                <button
                  aria-label={t(tooltipKey, { defaultValue: fallbackLabel })}
                  aria-pressed={isActive}
                  className={cx(
                    'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-transparent transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-editor-matte disabled:cursor-not-allowed disabled:opacity-45',
                    isActive
                      ? isPrimary
                        ? 'text-editor-primary-active-text'
                        : 'text-editor-selected-quiet-text'
                      : isPrimary
                        ? 'text-text-primary hover:border-editor-border hover:bg-editor-selected-quiet'
                        : 'text-text-secondary hover:bg-editor-panel-raised hover:text-text-primary',
                  )}
                  data-panel-id={id}
                  data-panel-priority={priority}
                  data-testid={`right-panel-switcher-button-${id}`}
                  data-tooltip={t(tooltipKey, { defaultValue: fallbackLabel })}
                  key={id}
                  onClick={() => {
                    onPanelSelect(id);
                  }}
                  type="button"
                >
                  {isActive && (
                    <motion.div
                      layoutId="active-panel-indicator"
                      className={cx(
                        'absolute inset-0 rounded-md',
                        isPrimary ? 'bg-editor-primary-active' : 'bg-editor-selected-quiet',
                      )}
                      transition={
                        isInstantTransition ? { duration: 0 } : { type: 'spring', bounce: 0.2, duration: 0.32 }
                      }
                    />
                  )}
                  {isPrimary && !isActive && (
                    <span className="absolute left-1 top-1 h-1 w-1 rounded-full bg-text-tertiary" />
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
          className={cx(
            'absolute z-30 flex max-h-80 w-64 flex-col overflow-hidden rounded-md border border-editor-border bg-editor-panel text-text-primary shadow-2xl',
            isHorizontal ? 'bottom-full left-1 mb-1 max-h-56 w-[min(22rem,calc(100vw-1rem))]' : 'left-full top-1 ml-1',
          )}
          data-testid={`right-panel-search-popover-${layout}`}
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
              onClick={closeSearch}
              type="button"
            >
              <X size={15} />
            </button>
          </div>

          <div className="min-h-0 overflow-y-auto py-1">
            {visibleRecentPanels.length > 0 && (
              <div className="pb-1">
                <div className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-normal text-text-tertiary">
                  {t('editor.switcher.search.recent', { defaultValue: 'Recent' })}
                </div>
                {visibleRecentPanels.map(({ fallbackLabel, icon: Icon, id, shortLabel, tooltipKey }) => (
                  <button
                    className="flex min-h-9 w-full items-center gap-2 px-2 text-left text-sm text-text-primary hover:bg-editor-selected-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-editor-focus-ring"
                    data-panel-id={id}
                    data-testid={`right-panel-recent-row-${id}`}
                    key={id}
                    onClick={() => {
                      selectPanel(id);
                    }}
                    type="button"
                  >
                    <Clock3 size={14} className="shrink-0 text-text-tertiary" />
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
              {searchResults.map(({ fallbackLabel, icon: Icon, id, keywords, shortLabel, tooltipKey }) => (
                <button
                  className="grid min-h-11 w-full grid-cols-[18px_minmax(0,1fr)] items-center gap-x-2 px-2 text-left hover:bg-editor-selected-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-editor-focus-ring"
                  data-panel-id={id}
                  data-testid={`right-panel-search-result-row-${id}`}
                  key={id}
                  onClick={() => {
                    selectPanel(id);
                  }}
                  type="button"
                >
                  <Icon size={16} className="row-span-2 shrink-0 text-text-secondary" />
                  <span className="min-w-0 truncate text-sm text-text-primary">
                    {t(tooltipKey, { defaultValue: fallbackLabel })}
                  </span>
                  <span className="min-w-0 truncate text-xs text-text-tertiary">
                    {shortLabel} - {keywords.slice(0, 3).join(', ')}
                  </span>
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
