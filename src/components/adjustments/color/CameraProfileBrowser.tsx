import cx from 'clsx';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CameraProfileBrowserEntry } from '../../../schemas/color/cameraProfileBrowserSchemas';
import {
  type BuiltInCameraProfileId,
  type CameraProfileId,
  cameraProfileIdSchema,
} from '../../../schemas/color/profileToneSchemas';
import { groupCameraProfiles, queryCameraProfiles } from '../../../utils/color/profile/cameraProfileBrowserRuntime';
import { editorChromeTokens } from '../../ui/editorChromeTokens';

interface BuiltInEntry {
  id: BuiltInCameraProfileId;
  label: string;
}
interface CameraProfileBrowserProps {
  builtIns: ReadonlyArray<BuiltInEntry>;
  amount: number;
  entries: ReadonlyArray<CameraProfileBrowserEntry>;
  errorCode: string | null;
  label: string;
  loading: boolean;
  onSelect: (id: CameraProfileId) => void;
  onAmountChange: (amount: number) => void;
  onImport: () => void;
  onRemove: (id: string) => void;
  onReveal: (id: string) => void;
  selected: CameraProfileId;
}
const SOURCE_ORDER = ['embedded', 'open', 'user', 'generated', 'matrix_fallback'] as const;
const STORAGE_KEY = 'rapidraw.camera-profile-browser.v1';
interface BrowserMemory {
  favorites: Array<string>;
  recent: Record<string, number>;
}
const loadMemory = (): BrowserMemory => {
  if (typeof localStorage === 'undefined') return { favorites: [], recent: {} };
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (typeof value !== 'object' || value === null) return { favorites: [], recent: {} };
    const candidate = value as Partial<BrowserMemory>;
    return {
      favorites: Array.isArray(candidate.favorites)
        ? candidate.favorites.filter((id): id is string => cameraProfileIdSchema.safeParse(id).success).slice(0, 256)
        : [],
      recent:
        typeof candidate.recent === 'object' && candidate.recent !== null
          ? Object.fromEntries(
              Object.entries(candidate.recent)
                .filter(
                  (entry): entry is [string, number] =>
                    cameraProfileIdSchema.safeParse(entry[0]).success &&
                    typeof entry[1] === 'number' &&
                    Number.isFinite(entry[1]),
                )
                .slice(0, 256),
            )
          : {},
    };
  } catch {
    return { favorites: [], recent: {} };
  }
};

export const CameraProfileBrowser = ({
  amount,
  builtIns,
  entries,
  errorCode,
  label,
  loading,
  onAmountChange,
  onImport,
  onRemove,
  onReveal,
  onSelect,
  selected,
}: CameraProfileBrowserProps) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [compatibleOnly, setCompatibleOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [memory, setMemory] = useState(loadMemory);
  const favoriteIds = useMemo(
    () => new Set([...entries.filter((entry) => entry.favorite).map((entry) => entry.id), ...memory.favorites]),
    [entries, memory.favorites],
  );
  const visible = useMemo(
    () =>
      queryCameraProfiles(
        entries.map((entry) => ({
          ...entry,
          favorite: favoriteIds.has(entry.id),
          lastUsedEpochMs: memory.recent[entry.id] ?? entry.lastUsedEpochMs,
        })),
        { compatibleOnly, search },
      ),
    [compatibleOnly, entries, favoriteIds, memory.recent, search],
  );
  const groups = groupCameraProfiles(visible);
  const selectedLabel =
    builtIns.find((entry) => entry.id === selected)?.label ??
    entries.find((entry) => entry.id === selected)?.displayName ??
    selected;
  const amountSupported = entries.find((entry) => entry.id === selected)?.creativeAmountSupported ?? false;
  const updateMemory = (next: BrowserMemory) => {
    setMemory(next);
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };
  const toggleFavorite = (id: string) => {
    const next = new Set(favoriteIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    updateMemory({ ...memory, favorites: [...next] });
  };
  const selectProfile = (id: CameraProfileId) => {
    updateMemory({ ...memory, recent: { ...memory.recent, [id]: Date.now() } });
    onSelect(id);
    setExpanded(false);
  };

  return (
    <div className="relative min-w-0" data-testid="camera-profile-browser">
      <button
        aria-expanded={expanded}
        aria-label={label}
        className={cx(
          editorChromeTokens.input.base,
          editorChromeTokens.input.compact,
          'flex w-full items-center justify-between gap-2 text-left',
        )}
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <span className="truncate">{selectedLabel}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      {amountSupported && (
        <label className="mt-1 grid grid-cols-[1fr_auto] items-center gap-2 text-[9px] text-text-secondary">
          <input
            aria-label={`${label} amount`}
            max={100}
            min={0}
            onChange={(event) => onAmountChange(Number(event.target.value))}
            type="range"
            value={amount}
          />
          <span className="tabular-nums">{amount}%</span>
        </label>
      )}
      {expanded && (
        <div
          className="absolute right-0 z-30 mt-1 w-[18rem] rounded border border-editor-border bg-editor-panel p-2 shadow-xl"
          data-testid="camera-profile-browser-popover"
        >
          <input
            aria-label={`${label} search`}
            className={cx(editorChromeTokens.input.base, 'mb-1.5 w-full')}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search profiles or cameras"
            type="search"
            value={search}
          />
          <label className="mb-1.5 flex items-center gap-1 text-[10px] text-text-secondary">
            <input
              checked={compatibleOnly}
              onChange={(event) => setCompatibleOnly(event.target.checked)}
              type="checkbox"
            />
            {t('adjustments.color.profileTone.browser.compatibleOnly')}
          </label>
          <button
            className="mb-1.5 w-full rounded border border-editor-border px-2 py-1 text-[10px] hover:bg-white/5"
            data-testid="camera-profile-import"
            onClick={onImport}
            type="button"
          >
            {t('adjustments.color.profileTone.browser.importDcp')}
          </button>
          {errorCode !== null && (
            <div className="mb-1.5 rounded bg-editor-warning/10 px-2 py-1 text-[9px] text-editor-warning" role="status">
              {t('adjustments.color.profileTone.browser.registryError', { errorCode })}
            </div>
          )}
          <div className="max-h-64 overflow-y-auto">
            <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-text-tertiary">
              {t('adjustments.color.profileTone.browser.builtIn')}
            </div>
            {builtIns.map((entry) => (
              <button
                className={cx(
                  'block w-full rounded px-2 py-1 text-left text-[11px] hover:bg-white/5',
                  selected === entry.id && 'bg-white/10',
                )}
                key={entry.id}
                onClick={() => selectProfile(entry.id)}
                type="button"
              >
                {entry.label}
              </button>
            ))}
            {loading && (
              <div className="px-2 py-2 text-[10px] text-text-tertiary">
                {t('adjustments.color.profileTone.browser.scanning')}
              </div>
            )}
            {SOURCE_ORDER.map((source) => {
              const group = groups.get(source);
              if (!group?.length) return null;
              return (
                <div key={source}>
                  <div className="mb-1 mt-2 text-[9px] font-semibold uppercase tracking-wide text-text-tertiary">
                    {source.replace('_', ' ')}
                  </div>
                  {group.map((entry) => (
                    <div
                      className={cx(
                        'grid grid-cols-[1fr_auto_auto_auto] items-center rounded hover:bg-white/5',
                        selected === entry.id && 'bg-white/10',
                      )}
                      key={entry.id}
                    >
                      <button
                        className="min-w-0 px-2 py-1 text-left"
                        onClick={() => selectProfile(entry.id)}
                        type="button"
                      >
                        <span className="block truncate text-[11px]">{entry.displayName}</span>
                        <span
                          className={cx(
                            'block truncate text-[9px]',
                            entry.compatible ? 'text-text-tertiary' : 'text-editor-warning',
                          )}
                        >
                          {entry.compatible
                            ? (entry.cameraModel ?? 'Universal profile')
                            : `Incompatible · ${entry.cameraModel ?? 'unknown camera'}`}
                        </span>
                      </button>
                      <button
                        aria-label={`${favoriteIds.has(entry.id) ? 'Unfavorite' : 'Favorite'} ${entry.displayName}`}
                        className="p-2 text-[12px]"
                        onClick={() => toggleFavorite(entry.id)}
                        type="button"
                      >
                        {favoriteIds.has(entry.id) ? '★' : '☆'}
                      </button>
                      {entry.source === 'user' && (
                        <button
                          aria-label={`Reveal ${entry.displayName}`}
                          className="p-2 text-[10px]"
                          onClick={() => onReveal(entry.id)}
                          type="button"
                        >
                          ↗
                        </button>
                      )}
                      {entry.source === 'user' && (
                        <button
                          aria-label={`Remove ${entry.displayName}`}
                          className="p-2 text-[11px] text-editor-warning"
                          onClick={() => onRemove(entry.id)}
                          type="button"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
            {!loading && visible.length === 0 && entries.length > 0 && (
              <div className="px-2 py-2 text-[10px] text-text-tertiary">
                {t('adjustments.color.profileTone.browser.noMatches')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
