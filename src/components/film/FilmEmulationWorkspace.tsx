import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../store/useEditorStore';
import { type Adjustments, INITIAL_ADJUSTMENTS } from '../../utils/adjustments';
import { buildFilmLookAppliedAdjustmentPatch, type FilmLookBrowserItem } from '../../utils/film-look/filmLookBrowser';
import { getFilmLookBrowserGroups } from '../../utils/film-look/filmLookRegistry';
import { FilmProfileBrowser } from './FilmProfileBrowser';

const FAVORITES_STORAGE_KEY = 'rapidraw.film.workspace.favorites.v1';
const readFavorites = (): Set<string> => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(FAVORITES_STORAGE_KEY) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []);
  } catch {
    return new Set();
  }
};

export function FilmEmulationWorkspace() {
  const { t } = useTranslation();
  const { adjustments, setEditor } = useEditorStore((state) => ({
    adjustments: state.adjustments,
    setEditor: state.setEditor,
  }));
  const [favorites, setFavorites] = useState(readFavorites);
  const [compare, setCompare] = useState(false);
  const [printVariant, setPrintVariant] = useState('None');
  const activeProfile = useMemo(
    () =>
      getFilmLookBrowserGroups()
        .flatMap((group) => group.looks)
        .find((look) => look.id === adjustments.filmLookId) ?? null,
    [adjustments.filmLookId],
  );
  const updateAdjustments = (update: (previous: Adjustments) => Adjustments) =>
    setEditor((state) => ({ adjustments: update(state.adjustments) }));
  const applyProfile = (look: FilmLookBrowserItem) =>
    updateAdjustments((previous) => ({
      ...previous,
      ...buildFilmLookAppliedAdjustmentPatch(
        look,
        previous.filmLookId === look.id ? previous.filmLookStrength : look.strengthDefault,
      ),
      filmLookId: look.id,
      filmLookStrength: previous.filmLookId === look.id ? previous.filmLookStrength : look.strengthDefault,
    }));
  const resetFilm = () =>
    updateAdjustments((previous) => ({ ...previous, ...INITIAL_ADJUSTMENTS, filmLookId: null, filmLookStrength: 100 }));
  const toggleFavorite = (id: string) =>
    setFavorites((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-editor-panel text-text-primary"
      data-testid="film-emulation-workspace"
    >
      <header className="shrink-0 border-b border-editor-border px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-sm font-semibold">{t('film.workspace.title', { defaultValue: 'Film Emulation' })}</h1>
            <p className="text-[10px] text-text-secondary">
              {t('film.workspace.subtitle', { defaultValue: 'Positive scene-referred creative workspace' })}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              aria-pressed={adjustments.filmLookId !== null}
              aria-label={t('film.workspace.enable', { defaultValue: 'Enable film emulation' })}
              className="rounded border border-editor-border px-2 py-1 text-[10px]"
              onClick={() =>
                updateAdjustments((previous) => ({
                  ...previous,
                  filmLookId: previous.filmLookId ?? 'film_look.generic.mono_silver.v1',
                }))
              }
              type="button"
            >
              {adjustments.filmLookId === null
                ? t('common.enable', { defaultValue: 'Enable' })
                : t('common.enabled', { defaultValue: 'Enabled' })}
            </button>
            <button
              aria-label={t('film.workspace.reset', { defaultValue: 'Reset film emulation' })}
              className="rounded border border-editor-border p-1 text-text-secondary hover:text-text-primary"
              onClick={resetFilm}
              type="button"
            >
              <RotateCcw size={14} />
            </button>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2 text-[10px] text-text-secondary">
          <span className="truncate">
            {activeProfile?.displayName ?? t('film.workspace.noProfile', { defaultValue: 'No profile selected' })}
          </span>
          <span aria-live="polite" className="ml-auto">
            {compare
              ? t('film.workspace.abBypass', { defaultValue: 'A/B: Film bypass' })
              : t('film.workspace.abOn', { defaultValue: 'A/B: Film on' })}
          </span>
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" data-right-panel-scroll-root>
        <section
          aria-label={t('film.workspace.mixLabel', { defaultValue: 'Film mix' })}
          className="rounded border border-editor-border bg-editor-panel-well p-2"
        >
          <div className="mb-1 flex items-center justify-between text-[11px] font-medium">
            <span>{t('film.workspace.mix', { defaultValue: 'Mix' })}</span>
            <output aria-label={t('film.workspace.mixValue', { defaultValue: 'Film mix value' })}>
              {adjustments.filmLookStrength}%
            </output>
          </div>
          <input
            aria-label={t('film.workspace.mix', { defaultValue: 'Film mix' })}
            className="w-full accent-editor-focus-ring"
            max={100}
            min={0}
            onChange={(event) =>
              updateAdjustments((previous) => ({ ...previous, filmLookStrength: Number(event.target.value) }))
            }
            step={1}
            type="range"
            value={adjustments.filmLookStrength}
          />
          <div className="mt-2 flex items-center gap-1">
            <button
              aria-pressed={compare}
              className="min-h-7 rounded border border-editor-border px-2 text-[10px]"
              onClick={() => setCompare((value) => !value)}
              type="button"
            >
              {t('film.workspace.localAb', { defaultValue: 'Local A/B' })}
            </button>
            <select
              aria-label={t('film.workspace.compatiblePrint', { defaultValue: 'Compatible print' })}
              className="min-h-7 min-w-0 flex-1 rounded border border-editor-border bg-editor-panel px-2 text-[10px]"
              onChange={(event) => setPrintVariant(event.target.value)}
              value={printVariant}
            >
              <option>{t('film.workspace.none', { defaultValue: 'None' })}</option>
              <option>{t('film.workspace.projectPrint', { defaultValue: 'Project print · verified' })}</option>
            </select>
          </div>
        </section>
        <section
          aria-label={t('film.workspace.provenanceLabel', { defaultValue: 'Film profile provenance' })}
          className="rounded border border-editor-border bg-editor-panel-well p-2 text-[10px] text-text-secondary"
        >
          <div className="flex items-center gap-1 font-medium text-text-primary">
            <SlidersHorizontal size={13} /> {t('film.workspace.provenance', { defaultValue: 'Profile provenance' })}
          </div>
          <p className="mt-1">
            {activeProfile?.provenance.claimLevel ??
              t('film.workspace.noVerifiedProfile', { defaultValue: 'No verified profile selected' })}{' '}
            · {t('film.workspace.rendererBacked', { defaultValue: 'renderer-backed selection' })} ·{' '}
            {t('film.workspace.separateBoundary', { defaultValue: 'Film remains separate from Negative Lab.' })}
          </p>
          <p className="mt-1">
            {t('film.workspace.printSummary', {
              defaultValue: 'Print: {{print}}. A/B is local and does not create history.',
              print: printVariant,
            })}
          </p>
        </section>
        <FilmProfileBrowser
          activeProfileId={adjustments.filmLookId}
          favorites={favorites}
          onApply={applyProfile}
          onToggleFavorite={toggleFavorite}
        />
      </div>
    </div>
  );
}
