import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FilmProfileManifestV1 } from '../../../packages/rawengine-schema/src/film/filmProfileRegistrySchemas';
import { getFilmBaselineProfileCatalog } from '../../utils/film-look/filmBaselineProfiles';
import { FilmProfileCard } from './FilmProfileCard';

interface FilmProfileBrowserProps {
  activeProfileId: string | null;
  favorites: ReadonlySet<string>;
  onApply: (profile: FilmProfileManifestV1) => void;
  onToggleFavorite: (id: string) => void;
}

export function FilmProfileBrowser({ activeProfileId, favorites, onApply, onToggleFavorite }: FilmProfileBrowserProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'favorites' | 'recommended'>('all');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const profiles = useMemo(
    () =>
      getFilmBaselineProfileCatalog().filter((profile) => {
        const matchesQuery =
          normalizedQuery.length === 0 ||
          `${profile.presentation.displayName} ${profile.presentation.description} ${profile.presentation.family}`
            .toLocaleLowerCase()
            .includes(normalizedQuery);
        const matchesFilter =
          filter === 'all' ||
          (filter === 'favorites' && favorites.has(profile.profile.id)) ||
          (filter === 'recommended' && profile.profile.lifecycle === 'active');
        return matchesQuery && matchesFilter;
      }),
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
        {profiles.length === 0 ? (
          <p className="py-4 text-center text-[11px] text-text-secondary">
            {t('film.workspace.noProfiles', { defaultValue: 'No profiles match.' })}
          </p>
        ) : null}
        {profiles.length > 0 ? (
          <section aria-labelledby="film-family-current">
            <h2
              className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary"
              id="film-family-current"
            >
              {t('film.workspace.currentProfiles', { defaultValue: 'Current profiles' })}
            </h2>
            <div className="space-y-1.5">
              {profiles.map((profile) => (
                <FilmProfileCard
                  favorite={favorites.has(profile.profile.id)}
                  key={profile.profile.id}
                  profile={profile}
                  onApply={onApply}
                  onToggleFavorite={onToggleFavorite}
                  selected={activeProfileId === profile.profile.id}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}
