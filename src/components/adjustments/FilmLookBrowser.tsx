import { Check, Film } from 'lucide-react';
import { useMemo, useState } from 'react';

import { TextVariants } from '../../types/typography';
import { getFilmLookBrowserGroups, type FilmLookBrowserItem } from '../../utils/filmLookBrowser';
import UiText from '../ui/Text';

interface FilmLookBrowserProps {
  onApplyLook: (look: FilmLookBrowserItem) => void;
}

const FILM_LOOK_BROWSER_TITLE = 'Film Looks';
const formatFilmLookCount = (count: number) => `${count} looks`;
const formatFilmLookStrength = (strength: number) => `${strength}%`;

export default function FilmLookBrowser({ onApplyLook }: FilmLookBrowserProps) {
  const groups = useMemo(() => getFilmLookBrowserGroups(), []);
  const lookCount = groups.reduce((total, group) => total + group.looks.length, 0);
  const [selectedLookId, setSelectedLookId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <UiText variant={TextVariants.heading}>{FILM_LOOK_BROWSER_TITLE}</UiText>
        <UiText className="tabular-nums" variant={TextVariants.small}>
          {formatFilmLookCount(lookCount)}
        </UiText>
      </div>

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
                  <button
                    className={`relative flex h-24 min-w-36 max-w-36 flex-col justify-between rounded-md border p-3 text-left transition-colors ${
                      isSelected
                        ? 'border-accent bg-surface text-text-primary'
                        : 'border-surface bg-bg-secondary text-text-secondary hover:bg-surface hover:text-text-primary'
                    }`}
                    data-tooltip={look.description}
                    key={look.id}
                    onClick={() => {
                      setSelectedLookId(look.id);
                      onApplyLook(look);
                    }}
                    type="button"
                    aria-label={look.displayName}
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
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
