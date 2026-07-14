import cx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { FilmLookBrowserItem } from '../../utils/film-look/filmLookBrowser';

interface FilmProfileCardProps {
  favorite: boolean;
  look: FilmLookBrowserItem;
  onApply: (look: FilmLookBrowserItem) => void;
  onToggleFavorite: (id: string) => void;
  selected: boolean;
}

export function FilmProfileCard({ favorite, look, onApply, onToggleFavorite, selected }: FilmProfileCardProps) {
  const { t } = useTranslation();
  const applyLabel = t('film.workspace.applyProfile', { defaultValue: 'Apply profile' });
  return (
    <article
      aria-label={t('film.workspace.profileAria', {
        defaultValue: `${look.displayName}, ${look.provenance.claimLevel}`,
        name: look.displayName,
        claim: look.provenance.claimLevel,
      })}
      className={cx(
        'rounded-md border p-2',
        selected ? 'border-editor-focus-ring bg-editor-selected-quiet' : 'border-editor-border bg-editor-panel-well',
      )}
      data-claim-class={look.provenance.claimLevel}
      data-film-profile-id={look.id}
      data-profile-state={selected ? 'selected' : 'available'}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-[12px] font-semibold text-text-primary">{look.displayName}</h3>
          <p className="mt-0.5 text-[10px] leading-4 text-text-secondary">{look.description}</p>
        </div>
        <button
          aria-pressed={favorite}
          aria-label={t(favorite ? 'film.workspace.removeFavorite' : 'film.workspace.addFavorite', {
            defaultValue: `${favorite ? 'Remove' : 'Add'} ${look.displayName} favorite`,
            name: look.displayName,
          })}
          className="rounded px-1 text-sm text-text-secondary hover:bg-editor-panel-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring"
          onClick={() => onToggleFavorite(look.id)}
          type="button"
        >
          {favorite ? '★' : '☆'}
        </button>
      </div>
      <button
        aria-label={t('film.workspace.applyNamedProfile', {
          defaultValue: `Apply ${look.displayName}`,
          name: look.displayName,
        })}
        className="mt-2 min-h-8 w-full rounded border border-editor-border bg-editor-panel-raised px-2 text-left text-[11px] font-medium text-text-primary hover:bg-editor-selected-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring"
        onClick={() => onApply(look)}
        type="button"
      >
        {selected
          ? t('film.workspace.selectedReplace', { defaultValue: 'Selected · Apply again to replace' })
          : applyLabel}
      </button>
    </article>
  );
}
