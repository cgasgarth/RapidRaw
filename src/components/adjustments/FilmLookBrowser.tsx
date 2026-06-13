import { Check, Film, Save, Share2, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { TextVariants } from '../../types/typography';
import {
  getFilmLookAdjustmentSummaries,
  getFilmLookBrowserGroups,
  type FilmLookBrowserItem,
} from '../../utils/filmLookBrowser';
import UiText from '../ui/Text';

interface FilmLookBrowserProps {
  onApplyLook: (look: FilmLookBrowserItem) => void;
  onSaveLook: (look: FilmLookBrowserItem) => void;
  onShareLook: (look: FilmLookBrowserItem) => void;
}

type FilmLookComparisonSlot = 'a' | 'b';

type FilmLookComparisonSelection = Record<FilmLookComparisonSlot, string | null>;

const FILM_LOOK_BROWSER_TITLE = 'Film Looks';
const FILM_LOOK_COMPARE_TITLE = 'A/B Compare';
const FILM_LOOK_COMPARE_EMPTY = 'Choose look';
const FILM_LOOK_COMPARE_SLOT_LABELS: Record<FilmLookComparisonSlot, string> = {
  a: 'A',
  b: 'B',
};
const FILM_LOOK_COMPARE_APPLY_LABELS: Record<FilmLookComparisonSlot, string> = {
  a: 'Apply A',
  b: 'Apply B',
};
const FILM_LOOK_COMPARE_SLOTS: Array<FilmLookComparisonSlot> = ['a', 'b'];
const formatFilmLookCount = (count: number) => `${count} looks`;
const formatFilmLookStrength = (strength: number) => `${strength}%`;
const formatFilmLookAdjustmentValue = (value: number) => (value > 0 ? `+${value}` : `${value}`);
const formatFilmLookSaveLabel = (displayName: string) => `Save ${displayName} as preset`;
const formatFilmLookShareLabel = (displayName: string) => `Share ${displayName} preset`;

export default function FilmLookBrowser({ onApplyLook, onSaveLook, onShareLook }: FilmLookBrowserProps) {
  const groups = useMemo(() => getFilmLookBrowserGroups(), []);
  const looksById = useMemo(
    () => new Map(groups.flatMap((group) => group.looks.map((look): [string, FilmLookBrowserItem] => [look.id, look]))),
    [groups],
  );
  const lookCount = groups.reduce((total, group) => total + group.looks.length, 0);
  const [selectedLookId, setSelectedLookId] = useState<string | null>(null);
  const [comparisonSelection, setComparisonSelection] = useState<FilmLookComparisonSelection>({
    a: null,
    b: null,
  });

  const handleApplyLook = (look: FilmLookBrowserItem) => {
    setSelectedLookId(look.id);
    onApplyLook(look);
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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <UiText variant={TextVariants.heading}>{FILM_LOOK_BROWSER_TITLE}</UiText>
        <UiText className="tabular-nums" variant={TextVariants.small}>
          {formatFilmLookCount(lookCount)}
        </UiText>
      </div>

      <section className="space-y-2" aria-label={FILM_LOOK_COMPARE_TITLE}>
        <div className="flex items-center justify-between gap-2">
          <UiText variant={TextVariants.small} className="uppercase tracking-normal text-text-secondary">
            {FILM_LOOK_COMPARE_TITLE}
          </UiText>
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
                      aria-label={`Clear compare ${slotLabel}`}
                      className="rounded p-1 text-text-secondary hover:bg-surface hover:text-text-primary"
                      data-tooltip={`Clear compare ${slotLabel}`}
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
                    {FILM_LOOK_COMPARE_EMPTY}
                  </UiText>
                ) : (
                  <div className="space-y-2">
                    <UiText className="block truncate" variant={TextVariants.body}>
                      {look.displayName}
                    </UiText>
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
                        handleApplyLook(look);
                      }}
                      type="button"
                    >
                      {FILM_LOOK_COMPARE_APPLY_LABELS[slot]}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="space-y-3">
        {groups.map((group) => (
          <section className="space-y-2" key={group.category}>
            <UiText variant={TextVariants.small} className="uppercase tracking-normal text-text-secondary">
              {group.displayName}
            </UiText>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {group.looks.map((look) => {
                const isSelected = selectedLookId === look.id;

                return (
                  <div
                    className={`flex h-36 min-w-40 max-w-40 flex-col rounded-md border p-2 transition-colors ${
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
                        {isSelected && <Check size={15} aria-hidden="true" />}
                      </span>
                      <span className="space-y-1">
                        <UiText className="block truncate" variant={TextVariants.body}>
                          {look.displayName}
                        </UiText>
                        <UiText className="block" variant={TextVariants.small}>
                          {formatFilmLookStrength(look.strengthDefault)}
                        </UiText>
                      </span>
                    </button>
                    <div className="mt-2 grid grid-cols-4 gap-1">
                      {FILM_LOOK_COMPARE_SLOTS.map((slot) => {
                        const slotLabel = FILM_LOOK_COMPARE_SLOT_LABELS[slot];
                        const isPinned = comparisonSelection[slot] === look.id;

                        return (
                          <button
                            aria-label={`Compare ${slotLabel}: ${look.displayName}`}
                            aria-pressed={isPinned}
                            className={`rounded px-2 py-1 text-xs font-medium tabular-nums ${
                              isPinned ? 'bg-accent text-white' : 'bg-bg-tertiary text-text-secondary hover:bg-surface'
                            }`}
                            data-tooltip={`Compare ${slotLabel}: ${look.displayName}`}
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
                        aria-label={formatFilmLookSaveLabel(look.displayName)}
                        className="rounded bg-bg-tertiary px-2 py-1 text-text-secondary hover:bg-surface"
                        data-tooltip={formatFilmLookSaveLabel(look.displayName)}
                        onClick={() => {
                          onSaveLook(look);
                        }}
                        type="button"
                      >
                        <Save size={13} aria-hidden="true" className="mx-auto" />
                      </button>
                      <button
                        aria-label={formatFilmLookShareLabel(look.displayName)}
                        className="rounded bg-bg-tertiary px-2 py-1 text-text-secondary hover:bg-surface"
                        data-tooltip={formatFilmLookShareLabel(look.displayName)}
                        onClick={() => {
                          onShareLook(look);
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
