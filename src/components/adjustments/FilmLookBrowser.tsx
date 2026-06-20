import { ArrowLeftRight, Check, Film, Save, Share2, Star, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TextVariants } from '../../types/typography';
import {
  clampFilmLookStrength,
  getFilmLookAdjustmentSummaries,
  type FilmLookBrowserItem,
  type FilmLookCategory,
} from '../../utils/filmLookBrowser';
import { getFilmLookBrowserGroups } from '../../utils/filmLookRegistry';
import UiText from '../ui/Text';

interface FilmLookBrowserProps {
  onApplyLook: (look: FilmLookBrowserItem, strength: number) => void;
  onSaveLook: (look: FilmLookBrowserItem, strength: number) => void;
  onShareLook: (look: FilmLookBrowserItem, strength: number) => void;
}

type FilmLookComparisonSlot = 'a' | 'b';
type FilmLookCategoryFilter = FilmLookCategory | 'all';

type FilmLookComparisonSelection = Record<FilmLookComparisonSlot, string | null>;

const FILM_LOOK_COMPARE_SLOT_LABELS: Record<FilmLookComparisonSlot, string> = {
  a: 'A',
  b: 'B',
};
const FILM_LOOK_COMPARE_SLOTS: Array<FilmLookComparisonSlot> = ['a', 'b'];
const FILM_LOOK_FAVORITES_STORAGE_KEY = 'rapidraw.filmLookFavorites.v1';
const formatFilmLookStrength = (strength: number) => `${strength}%`;
const formatFilmLookAdjustmentValue = (value: number) => (value > 0 ? `+${value}` : `${value}`);
const formatFilmLookToken = (value: string) => value.split('_').join(' ');
const getFilmLookSwatchStyle = (look: FilmLookBrowserItem) => {
  const warmth = look.adjustmentPatch.temperature ?? 0;
  const saturation = look.adjustmentPatch.saturation ?? 0;
  const contrast = look.adjustmentPatch.contrast ?? 0;
  const hue = warmth >= 0 ? 34 : 210;
  const secondaryHue = look.category === 'black_and_white' ? 0 : hue + 18;
  const chroma = Math.max(8, Math.min(80, 38 + saturation));
  const lift = Math.max(18, Math.min(72, 44 + contrast));

  if (look.category === 'black_and_white') {
    return {
      background:
        'linear-gradient(135deg, hsl(0 0% 18%), hsl(0 0% 54%) 48%, hsl(0 0% 86%)), radial-gradient(circle at 22% 18%, hsl(0 0% 100% / 0.28), transparent 34%)',
    };
  }

  return {
    background: `linear-gradient(135deg, hsl(${hue} ${chroma}% ${lift - 16}%), hsl(${secondaryHue} ${chroma + 8}% ${lift + 6}%) 54%, hsl(${hue + 54} ${Math.max(20, chroma - 8)}% ${lift + 22}%))`,
  };
};
const isStringArray = (value: unknown): value is Array<string> =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const readFavoriteLookIds = (): Set<string> => {
  if (typeof window === 'undefined') {
    return new Set();
  }

  const storedFavorites = window.localStorage.getItem(FILM_LOOK_FAVORITES_STORAGE_KEY);
  if (storedFavorites === null) {
    return new Set();
  }

  const parsedFavorites: unknown = JSON.parse(storedFavorites);
  return isStringArray(parsedFavorites) ? new Set(parsedFavorites) : new Set();
};

export function FilmLookBrowser({ onApplyLook, onSaveLook, onShareLook }: FilmLookBrowserProps) {
  const { t } = useTranslation();
  const groups = useMemo(() => getFilmLookBrowserGroups(), []);
  const looksById = useMemo(
    () => new Map(groups.flatMap((group) => group.looks.map((look): [string, FilmLookBrowserItem] => [look.id, look]))),
    [groups],
  );
  const [selectedLookId, setSelectedLookId] = useState<string | null>(null);
  const [comparisonSelection, setComparisonSelection] = useState<FilmLookComparisonSelection>({
    a: null,
    b: null,
  });
  const [favoriteLookIds, setFavoriteLookIds] = useState<Set<string>>(readFavoriteLookIds);
  const [strengthPercent, setStrengthPercent] = useState<number>(70);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [activeCategory, setActiveCategory] = useState<FilmLookCategoryFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const favoriteLookCount = useMemo(
    () => groups.reduce((count, group) => count + group.looks.filter((look) => favoriteLookIds.has(look.id)).length, 0),
    [favoriteLookIds, groups],
  );
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase('en-US');
  const categoryTabs = useMemo(
    () => [
      {
        category: 'all' as const,
        count: groups.reduce((count, group) => count + group.looks.length, 0),
        displayName: t('adjustments.effects.filmLookBrowser.allFamilies'),
      },
      ...groups.map((group) => ({
        category: group.category,
        count: group.looks.length,
        displayName: group.displayName,
      })),
    ],
    [groups, t],
  );
  const visibleGroups = useMemo(
    () =>
      groups
        .filter((group) => activeCategory === 'all' || group.category === activeCategory)
        .map((group) => ({
          ...group,
          looks: group.looks.filter((look) => {
            if (showFavoritesOnly && !favoriteLookIds.has(look.id)) {
              return false;
            }

            if (normalizedSearchQuery.length === 0) {
              return true;
            }

            return [look.displayName, look.description, group.displayName]
              .join(' ')
              .toLocaleLowerCase('en-US')
              .includes(normalizedSearchQuery);
          }),
        }))
        .filter((group) => group.looks.length > 0),
    [activeCategory, favoriteLookIds, groups, normalizedSearchQuery, showFavoritesOnly],
  );
  const visibleLookCount = visibleGroups.reduce((total, group) => total + group.looks.length, 0);
  const selectedLook = selectedLookId === null ? undefined : looksById.get(selectedLookId);
  const selectedLookAdjustmentSummaries =
    selectedLook === undefined ? [] : getFilmLookAdjustmentSummaries(selectedLook);

  useEffect(() => {
    window.localStorage.setItem(FILM_LOOK_FAVORITES_STORAGE_KEY, JSON.stringify([...favoriteLookIds].toSorted()));
  }, [favoriteLookIds]);

  const handleApplyLook = (look: FilmLookBrowserItem) => {
    setSelectedLookId(look.id);
    setStrengthPercent(look.strengthDefault);
    onApplyLook(look, look.strengthDefault);
  };

  const handleApplyLookAtCurrentStrength = (look: FilmLookBrowserItem) => {
    const lookStrength = selectedLookId === look.id ? strengthPercent : look.strengthDefault;
    setSelectedLookId(look.id);
    setStrengthPercent(lookStrength);
    onApplyLook(look, lookStrength);
  };

  const handleStrengthChange = (value: number) => {
    const nextStrength = clampFilmLookStrength(value);
    setStrengthPercent(nextStrength);

    if (selectedLookId !== null) {
      const look = looksById.get(selectedLookId);
      if (look !== undefined) {
        onApplyLook(look, nextStrength);
      }
    }
  };

  const toggleFavoriteLook = (look: FilmLookBrowserItem) => {
    setFavoriteLookIds((currentFavorites) => {
      const nextFavorites = new Set(currentFavorites);

      if (nextFavorites.has(look.id)) {
        nextFavorites.delete(look.id);
      } else {
        nextFavorites.add(look.id);
      }

      return nextFavorites;
    });
  };

  const handlePinComparisonLook = (slot: FilmLookComparisonSlot, look: FilmLookBrowserItem) => {
    setComparisonSelection((currentSelection) => ({
      ...currentSelection,
      [slot]: look.id,
    }));
  };

  const handleClearComparisonLook = (slot: FilmLookComparisonSlot) => {
    setComparisonSelection((currentSelection) => ({
      ...currentSelection,
      [slot]: null,
    }));
  };

  const handleSwapComparisonLooks = () => {
    setComparisonSelection((currentSelection) => ({
      a: currentSelection.b,
      b: currentSelection.a,
    }));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <UiText variant={TextVariants.heading}>{t('adjustments.effects.filmLookBrowser.title')}</UiText>
        <UiText className="tabular-nums" variant={TextVariants.small}>
          {t('adjustments.effects.filmLookBrowser.lookCount', { count: visibleLookCount })}
        </UiText>
      </div>

      <input
        aria-label={t('adjustments.effects.filmLookBrowser.search')}
        className="w-full rounded-md border border-surface bg-bg-secondary px-3 py-2 text-sm text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-accent"
        onChange={(event) => {
          setSearchQuery(event.target.value);
        }}
        placeholder={t('adjustments.effects.filmLookBrowser.search')}
        type="search"
        value={searchQuery}
      />

      <div className="grid grid-cols-2 gap-2">
        <button
          aria-pressed={!showFavoritesOnly}
          className={`rounded-md border px-3 py-2 text-sm transition-colors ${
            showFavoritesOnly
              ? 'border-surface bg-bg-secondary text-text-secondary hover:bg-surface'
              : 'border-accent bg-accent/10 text-text-primary'
          }`}
          onClick={() => {
            setShowFavoritesOnly(false);
          }}
          type="button"
        >
          {t('adjustments.effects.filmLookBrowser.allLooks')}
        </button>
        <button
          aria-pressed={showFavoritesOnly}
          className={`rounded-md border px-3 py-2 text-sm transition-colors ${
            showFavoritesOnly
              ? 'border-accent bg-accent/10 text-text-primary'
              : 'border-surface bg-bg-secondary text-text-secondary hover:bg-surface'
          }`}
          onClick={() => {
            setShowFavoritesOnly(true);
          }}
          type="button"
        >
          {t('adjustments.effects.filmLookBrowser.favorites')}
        </button>
      </div>

      <section className="space-y-2" aria-label={t('adjustments.effects.filmLookBrowser.categoryFilter')}>
        <UiText variant={TextVariants.small} className="uppercase tracking-normal text-text-secondary">
          {t('adjustments.effects.filmLookBrowser.categoryFilter')}
        </UiText>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {categoryTabs.map((tab) => {
            const isActive = activeCategory === tab.category;

            return (
              <button
                aria-pressed={isActive}
                className={`shrink-0 rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                  isActive
                    ? 'border-accent bg-accent/10 text-text-primary'
                    : 'border-surface bg-bg-secondary text-text-secondary hover:bg-surface'
                }`}
                key={tab.category}
                onClick={() => {
                  setActiveCategory(tab.category);
                }}
                type="button"
              >
                <span className="block font-medium">{tab.displayName}</span>
                <span className="block tabular-nums opacity-70">
                  {t('adjustments.effects.filmLookBrowser.lookCount', { count: tab.count })}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-2" aria-label={t('adjustments.effects.filmLookBrowser.compareTitle')}>
        <div className="flex items-center justify-between gap-2">
          <UiText variant={TextVariants.small} className="uppercase tracking-normal text-text-secondary">
            {t('adjustments.effects.filmLookBrowser.compareTitle')}
          </UiText>
          <button
            aria-label={t('adjustments.effects.filmLookBrowser.compareSwap')}
            className="inline-flex items-center gap-1 rounded-md border border-surface bg-bg-secondary px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
            data-tooltip={t('adjustments.effects.filmLookBrowser.compareSwap')}
            disabled={comparisonSelection.a === null && comparisonSelection.b === null}
            onClick={handleSwapComparisonLooks}
            type="button"
          >
            <ArrowLeftRight size={13} aria-hidden="true" />
            {t('adjustments.effects.filmLookBrowser.compareSwap')}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {FILM_LOOK_COMPARE_SLOTS.map((slot) => {
            const slotLabel = FILM_LOOK_COMPARE_SLOT_LABELS[slot];
            const lookId = comparisonSelection[slot];
            const look = lookId === null ? undefined : looksById.get(lookId);
            const adjustmentSummaries = look === undefined ? [] : getFilmLookAdjustmentSummaries(look);

            return (
              <div className="min-h-28 rounded-md border border-surface bg-bg-secondary p-2" key={slot}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <UiText variant={TextVariants.small} className="tabular-nums text-text-secondary">
                    {slotLabel}
                  </UiText>
                  {look !== undefined && (
                    <button
                      aria-label={t('adjustments.effects.filmLookBrowser.clearCompare', { slot: slotLabel })}
                      className="rounded p-1 text-text-secondary hover:bg-surface hover:text-text-primary"
                      data-tooltip={t('adjustments.effects.filmLookBrowser.clearCompare', { slot: slotLabel })}
                      onClick={() => {
                        handleClearComparisonLook(slot);
                      }}
                      type="button"
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  )}
                </div>

                {look === undefined ? (
                  <UiText variant={TextVariants.small} className="text-text-secondary">
                    {t('adjustments.effects.filmLookBrowser.compareEmpty')}
                  </UiText>
                ) : (
                  <div className="space-y-2">
                    <UiText className="block truncate" variant={TextVariants.body}>
                      {look.displayName}
                    </UiText>
                    <div className="h-5 rounded-sm border border-surface" style={getFilmLookSwatchStyle(look)} />
                    <div className="flex flex-wrap gap-1">
                      {adjustmentSummaries.map((summary) => (
                        <span
                          className="rounded bg-surface px-1.5 py-0.5 text-xs text-text-secondary"
                          key={summary.label}
                        >
                          {summary.label} {formatFilmLookAdjustmentValue(summary.value)}
                        </span>
                      ))}
                    </div>
                    <button
                      className="w-full rounded bg-accent px-2 py-1 text-xs font-medium text-white hover:opacity-90"
                      onClick={() => {
                        handleApplyLookAtCurrentStrength(look);
                      }}
                      type="button"
                    >
                      {t('adjustments.effects.filmLookBrowser.compareApply', { slot: slotLabel })}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-2" aria-label={t('adjustments.effects.filmLookBrowser.strength')}>
        <div className="flex items-center justify-between gap-2">
          <UiText variant={TextVariants.small} className="uppercase tracking-normal text-text-secondary">
            {t('adjustments.effects.filmLookBrowser.strength')}
          </UiText>
          <UiText variant={TextVariants.small} className="tabular-nums text-text-secondary">
            {formatFilmLookStrength(strengthPercent)}
          </UiText>
        </div>
        <input
          aria-label={t('adjustments.effects.filmLookBrowser.strength')}
          className="w-full accent-accent"
          max={100}
          min={0}
          onChange={(event) => {
            handleStrengthChange(Number(event.target.value));
          }}
          step={1}
          type="range"
          value={strengthPercent}
        />
      </section>

      {selectedLook !== undefined && (
        <section
          className="space-y-2 rounded-md border border-surface bg-bg-secondary p-3"
          data-runtime-support={selectedLook.runtimeSupport}
          data-testid="film-look-provenance-inspector"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <UiText variant={TextVariants.small} className="font-semibold text-text-primary">
                {t('adjustments.effects.filmLookBrowser.provenanceTitle')}
              </UiText>
              <UiText variant={TextVariants.small} className="truncate text-text-tertiary">
                {selectedLook.displayName}
              </UiText>
            </div>
            <span className="rounded border border-surface bg-bg-primary px-2 py-1 text-[11px] text-text-secondary">
              {formatFilmLookToken(selectedLook.runtimeSupport)}
            </span>
          </div>
          <div
            className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px] text-text-tertiary"
            data-testid="film-look-provenance-fields"
          >
            <span>{t('adjustments.effects.filmLookBrowser.claimLevel')}</span>
            <span className="text-right text-text-secondary">
              {formatFilmLookToken(selectedLook.provenance.claimLevel)}
            </span>
            <span>{t('adjustments.effects.filmLookBrowser.measurementSource')}</span>
            <span className="text-right text-text-secondary">
              {formatFilmLookToken(selectedLook.provenance.measurementSource)}
            </span>
            <span>{t('adjustments.effects.filmLookBrowser.legalNamingStatus')}</span>
            <span className="text-right text-text-secondary">
              {formatFilmLookToken(selectedLook.provenance.legalNamingStatus)}
            </span>
          </div>
          <UiText variant={TextVariants.small} className="text-text-tertiary">
            {selectedLook.provenance.legalNote}
          </UiText>
          <div className="flex flex-wrap gap-1" data-testid="film-look-adjustment-summary">
            {selectedLookAdjustmentSummaries.map((summary) => (
              <span className="rounded bg-bg-primary px-1.5 py-0.5 text-xs text-text-secondary" key={summary.label}>
                {summary.label} {formatFilmLookAdjustmentValue(summary.value)}
              </span>
            ))}
          </div>
        </section>
      )}

      <div className="space-y-3">
        {showFavoritesOnly && favoriteLookCount === 0 && (
          <div className="rounded-md border border-dashed border-surface bg-bg-secondary p-3 text-center">
            <UiText variant={TextVariants.small} className="text-text-secondary">
              {t('adjustments.effects.filmLookBrowser.emptyFavorites')}
            </UiText>
          </div>
        )}
        {visibleLookCount === 0 && !(showFavoritesOnly && favoriteLookCount === 0) && (
          <div className="rounded-md border border-dashed border-surface bg-bg-secondary p-3 text-center">
            <UiText variant={TextVariants.small} className="text-text-secondary">
              {t('adjustments.effects.filmLookBrowser.emptySearch')}
            </UiText>
          </div>
        )}
        {visibleGroups.map((group) => (
          <section className="space-y-2" key={group.category}>
            <UiText variant={TextVariants.small} className="uppercase tracking-normal text-text-secondary">
              {group.displayName}
            </UiText>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {group.looks.map((look) => {
                const isSelected = selectedLookId === look.id;
                const isFavorite = favoriteLookIds.has(look.id);
                const activeStrength = isSelected ? strengthPercent : look.strengthDefault;
                const favoriteLabel = isFavorite
                  ? t('adjustments.effects.filmLookBrowser.unfavoriteLook', { displayName: look.displayName })
                  : t('adjustments.effects.filmLookBrowser.favoriteLook', { displayName: look.displayName });

                return (
                  <div
                    className={`flex h-40 min-w-40 max-w-40 flex-col rounded-md border p-2 transition-colors ${
                      isSelected
                        ? 'border-accent bg-surface text-text-primary'
                        : 'border-surface bg-bg-secondary text-text-secondary hover:bg-surface hover:text-text-primary'
                    }`}
                    key={look.id}
                  >
                    <button
                      aria-label={look.displayName}
                      className="flex min-h-0 flex-1 flex-col justify-between text-left"
                      data-tooltip={look.description}
                      onClick={() => {
                        handleApplyLook(look);
                      }}
                      type="button"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <Film size={16} aria-hidden="true" />
                        <span
                          className="h-5 flex-1 rounded-sm border border-surface"
                          style={getFilmLookSwatchStyle(look)}
                        />
                        <span className="flex items-center gap-1">
                          {isFavorite && <span className="size-2 rounded-full bg-accent" aria-hidden="true" />}
                          {isSelected && <Check size={15} aria-hidden="true" />}
                        </span>
                      </span>
                      <span className="space-y-1">
                        <UiText className="block truncate" variant={TextVariants.body}>
                          {look.displayName}
                        </UiText>
                        <UiText className="block" variant={TextVariants.small}>
                          {formatFilmLookStrength(activeStrength)}
                        </UiText>
                      </span>
                    </button>
                    <div className="mt-2 grid grid-cols-5 gap-1">
                      {FILM_LOOK_COMPARE_SLOTS.map((slot) => {
                        const slotLabel = FILM_LOOK_COMPARE_SLOT_LABELS[slot];
                        const isPinned = comparisonSelection[slot] === look.id;

                        return (
                          <button
                            aria-label={t('adjustments.effects.filmLookBrowser.compareLook', {
                              displayName: look.displayName,
                              slot: slotLabel,
                            })}
                            aria-pressed={isPinned}
                            className={`rounded px-2 py-1 text-xs font-medium tabular-nums ${
                              isPinned ? 'bg-accent text-white' : 'bg-bg-tertiary text-text-secondary hover:bg-surface'
                            }`}
                            data-tooltip={t('adjustments.effects.filmLookBrowser.compareLook', {
                              displayName: look.displayName,
                              slot: slotLabel,
                            })}
                            key={slot}
                            onClick={() => {
                              handlePinComparisonLook(slot, look);
                            }}
                            type="button"
                          >
                            {slotLabel}
                          </button>
                        );
                      })}
                      <button
                        aria-label={favoriteLabel}
                        aria-pressed={isFavorite}
                        className={`rounded bg-bg-tertiary px-2 py-1 text-text-secondary hover:bg-surface ${
                          isFavorite ? 'text-accent' : ''
                        }`}
                        data-tooltip={favoriteLabel}
                        onClick={() => {
                          toggleFavoriteLook(look);
                        }}
                        type="button"
                      >
                        <Star
                          size={13}
                          aria-hidden="true"
                          className="mx-auto"
                          fill={isFavorite ? 'currentColor' : 'none'}
                        />
                      </button>
                      <button
                        aria-label={t('adjustments.effects.filmLookBrowser.saveLook', {
                          displayName: look.displayName,
                        })}
                        className="rounded bg-bg-tertiary px-2 py-1 text-text-secondary hover:bg-surface"
                        data-tooltip={t('adjustments.effects.filmLookBrowser.saveLook', {
                          displayName: look.displayName,
                        })}
                        onClick={() => {
                          onSaveLook(look, activeStrength);
                        }}
                        type="button"
                      >
                        <Save size={13} aria-hidden="true" className="mx-auto" />
                      </button>
                      <button
                        aria-label={t('adjustments.effects.filmLookBrowser.shareLook', {
                          displayName: look.displayName,
                        })}
                        className="rounded bg-bg-tertiary px-2 py-1 text-text-secondary hover:bg-surface"
                        data-tooltip={t('adjustments.effects.filmLookBrowser.shareLook', {
                          displayName: look.displayName,
                        })}
                        onClick={() => {
                          onShareLook(look, activeStrength);
                        }}
                        type="button"
                      >
                        <Share2 size={13} aria-hidden="true" className="mx-auto" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export default FilmLookBrowser;
