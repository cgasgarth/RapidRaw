import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FilmLookBrowserItem } from '../../utils/film-look/filmLookBrowser';
import { getFilmLookBrowserGroups } from '../../utils/film-look/filmLookRegistry';
import { FilmProfileCard } from './FilmProfileCard';

interface FilmProfileBrowserProps {
  activeProfileId: string | null;
  favorites: ReadonlySet<string>;
  onApply: (look: FilmLookBrowserItem) => void;
  onToggleFavorite: (id: string) => void;
}

export function FilmProfileBrowser({ activeProfileId, favorites, onApply, onToggleFavorite }: FilmProfileBrowserProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'favorites' | 'recommended'>('all');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const groups = useMemo(
    () =>
      getFilmLookBrowserGroups()
        .map((group) => ({
          ...group,
          looks: group.looks.filter((look) => {
            const matchesQuery =
              normalizedQuery.length === 0 ||
              `${look.displayName} ${look.description} ${look.category}`.toLocaleLowerCase().includes(normalizedQuery);
            const matchesFilter =
              filter === 'all' ||
              (filter === 'favorites' && favorites.has(look.id)) ||
              (filter === 'recommended' && look.strengthDefault >= 70);
            return matchesQuery && matchesFilter;
          }),
        }))
        .filter((group) => group.looks.length > 0),
    [favorites, filter, normalizedQuery],
  );

  return (
    <section
      aria-label={t('film.workspace.browserLabel', { defaultValue: 'Verified film profile browser' })}
      className="space-y-2"
      data-testid="film-profile-browser"
    >
      <label className="relative block">
        <span className="sr-only">{t('film.workspace.searchLabel', { defaultValue: 'Search film profiles' })}</span>
        <Search className="pointer-events-none absolute left-2 top-2.5 text-text-tertiary" size={14} />
        <input
          aria-label={t('film.workspace.searchLabel', { defaultValue: 'Search film profiles' })}
          className="h-8 w-full rounded border border-editor-border bg-editor-panel-well pl-7 pr-2 text-[11px] text-text-primary outline-none focus:border-editor-focus-ring"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('film.workspace.searchPlaceholder', { defaultValue: 'Search profiles' })}
          type="search"
          value={query}
        />
      </label>
      <div
        aria-label={t('film.workspace.filtersLabel', { defaultValue: 'Profile filters' })}
        className="flex gap-1"
        role="group"
      >
        {(['all', 'favorites', 'recommended'] as const).map((option) => (
          <button
            aria-pressed={filter === option}
            className="min-h-7 rounded border border-editor-border px-2 text-[10px] capitalize text-text-secondary hover:bg-editor-panel-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring"
            key={option}
            onClick={() => setFilter(option)}
            type="button"
          >
            {option}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {groups.length === 0 ? (
          <p className="py-4 text-center text-[11px] text-text-secondary">
            {t('film.workspace.noProfiles', { defaultValue: 'No profiles match.' })}
          </p>
        ) : null}
        {groups.map((group) => (
          <section aria-labelledby={`film-family-${group.category}`} key={group.category}>
            <h2
              className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary"
              id={`film-family-${group.category}`}
            >
              {group.displayName}
            </h2>
            <div className="space-y-1.5">
              {group.looks.map((look) => (
                <FilmProfileCard
                  favorite={favorites.has(look.id)}
                  key={look.id}
                  look={look}
                  onApply={onApply}
                  onToggleFavorite={onToggleFavorite}
                  selected={activeProfileId === look.id}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
