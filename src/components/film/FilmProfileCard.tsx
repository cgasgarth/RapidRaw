import cx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { FilmProfileManifestV1 } from '../../../packages/rawengine-schema/src/film/filmProfileRegistrySchemas';

interface FilmProfileCardProps {
  favorite: boolean;
  profile: FilmProfileManifestV1;
  onApply: (profile: FilmProfileManifestV1) => void;
  onToggleFavorite: (id: string) => void;
  selected: boolean;
}

export function FilmProfileCard({ favorite, profile, onApply, onToggleFavorite, selected }: FilmProfileCardProps) {
  const { t } = useTranslation();
  const applyLabel = t('film.workspace.applyProfile', { defaultValue: 'Apply profile' });
  const claimClass = profile.claim.class;
  const profileId = profile.profile.id;
  return (
    <article
      aria-label={t('film.workspace.profileAria', {
        defaultValue: `${profile.presentation.displayName}, ${claimClass}`,
        name: profile.presentation.displayName,
        claim: claimClass,
      })}
      className={cx(
        'rounded-md border p-2',
        selected ? 'border-editor-focus-ring bg-editor-selected-quiet' : 'border-editor-border bg-editor-panel-well',
      )}
      data-claim-class={claimClass}
      data-film-profile-id={profileId}
      data-profile-state={selected ? 'selected' : 'available'}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-[12px] font-semibold text-text-primary">{profile.presentation.displayName}</h3>
          <p className="mt-0.5 text-[10px] leading-4 text-text-secondary">{profile.presentation.description}</p>
        </div>
        <button
          aria-pressed={favorite}
          aria-label={t(favorite ? 'film.workspace.removeFavorite' : 'film.workspace.addFavorite', {
            defaultValue: `${favorite ? 'Remove' : 'Add'} ${profile.presentation.displayName} favorite`,
            name: profile.presentation.displayName,
          })}
          className="rounded px-1 text-sm text-text-secondary hover:bg-editor-panel-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring"
          onClick={() => onToggleFavorite(profileId)}
          type="button"
        >
          {favorite ? '★' : '☆'}
        </button>
      </div>
      <button
        aria-label={t('film.workspace.applyNamedProfile', {
          defaultValue: `Apply ${profile.presentation.displayName}`,
          name: profile.presentation.displayName,
        })}
        className="mt-2 min-h-8 w-full rounded border border-editor-border bg-editor-panel-raised px-2 text-left text-[11px] font-medium text-text-primary hover:bg-editor-selected-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring"
        onClick={() => onApply(profile)}
        type="button"
      >
        {selected
          ? t('film.workspace.selectedReplace', { defaultValue: 'Selected · Apply again to replace' })
          : applyLabel}
      </button>
    </article>
  );
}
