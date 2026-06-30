import cx from 'clsx';
import {
  Aperture,
  ArrowLeft,
  Command,
  Images,
  LayoutTemplate,
  PanelRight,
  Scan,
  ScanSearch,
  Search,
  Sparkles,
  Wand2,
  Waves,
  X,
} from 'lucide-react';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CommandPaletteCommand } from '../../schemas/commandPaletteSchemas';
import { useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useUIStore } from '../../store/useUIStore';
import { TextColors, TextVariants } from '../../types/typography';
import {
  commandCategoryKeys,
  commandLabelKeys,
  commandPaletteCommands,
  createCommandPaletteAction,
  getCommandPaletteDisabledReasonKey,
  getCommandPaletteSelectedImages,
  getCommandPaletteSelectedPaths,
} from '../../utils/commandPaletteModel';
import Button from '../ui/Button';
import Input from '../ui/Input';
import UiText from '../ui/Text';

interface CommandPaletteModalProps {
  isOpen: boolean;
  onBackToLibrary: () => void;
  onClose: () => void;
}

const getCommandIcon = (command: CommandPaletteCommand) => {
  switch (command.id) {
    case 'backToLibrary':
      return ArrowLeft;
    case 'copyPasteSettings':
    case 'importFiles':
      return Command;
    case 'collage':
      return LayoutTemplate;
    case 'lensCorrection':
      return Aperture;
    case 'transformTools':
      return Scan;
    case 'culling':
      return ScanSearch;
    case 'denoise':
      return Waves;
    case 'focusStack':
    case 'hdrMerge':
    case 'panorama':
    case 'superResolution':
      return Images;
    case 'negativeLab':
      return Wand2;
    case 'panelAdjustments':
    case 'panelCrop':
    case 'panelExport':
    case 'panelMasks':
    case 'panelMetadata':
    case 'panelPresets':
      return PanelRight;
    case 'panelAi':
      return Sparkles;
  }
};

export default function CommandPaletteModal({ isOpen, onBackToLibrary, onClose }: CommandPaletteModalProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const selectedImage = useEditorStore((state) => state.selectedImage);
  const imageList = useLibraryStore((state) => state.imageList);
  const multiSelectedPaths = useLibraryStore((state) => state.multiSelectedPaths);
  const setUI = useUIStore((state) => state.setUI);
  const setRightPanel = useUIStore((state) => state.setRightPanel);
  const selectedCommandPaths = useMemo(
    () => getCommandPaletteSelectedPaths(multiSelectedPaths, selectedImage),
    [multiSelectedPaths, selectedImage],
  );
  const selectedCommandImages = useMemo(() => {
    return getCommandPaletteSelectedImages(imageList, selectedCommandPaths);
  }, [imageList, selectedCommandPaths]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(focusTimer);
    };
  }, [isOpen]);

  const visibleCommands = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return commandPaletteCommands;

    return commandPaletteCommands.filter((command) => {
      const haystack = [
        t(commandLabelKeys[command.id]),
        t(commandCategoryKeys[command.category]),
        ...command.searchTokens,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [query, t]);

  const getDisabledReasonKey = (command: CommandPaletteCommand) => {
    return getCommandPaletteDisabledReasonKey(command, selectedCommandImages, selectedCommandPaths, selectedImage);
  };

  const resolvedActiveIndex = Math.min(activeIndex, Math.max(visibleCommands.length - 1, 0));
  const coverageCategories = useMemo(
    () =>
      Array.from(new Set(visibleCommands.map((command) => command.category))).map((category) =>
        t(commandCategoryKeys[category]),
      ),
    [t, visibleCommands],
  );

  if (!isOpen) return null;

  const handleClose = () => {
    setQuery('');
    setActiveIndex(0);
    onClose();
  };

  const closeAndRun = (run: () => void) => {
    handleClose();
    run();
  };

  const executeCommand = (command: CommandPaletteCommand) => {
    const action = createCommandPaletteAction(command, {
      imageList,
      onBackToLibrary,
      selectedCommandImages,
      selectedCommandPaths,
      selectedImage,
      setRightPanel,
      setUI,
    });
    if (action) closeAndRun(action);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      handleClose();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((currentIndex) =>
        visibleCommands.length === 0 ? 0 : (currentIndex + 1) % visibleCommands.length,
      );
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((currentIndex) =>
        visibleCommands.length === 0 ? 0 : (currentIndex - 1 + visibleCommands.length) % visibleCommands.length,
      );
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const command = visibleCommands[resolvedActiveIndex];
      if (command && !getDisabledReasonKey(command)) executeCommand(command);
    }
  };

  return (
    <div
      aria-modal="true"
      aria-labelledby="command-palette-title"
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 px-4 pt-[12vh]"
      role="dialog"
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-lg border border-border-color bg-bg-primary shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border-color px-4 py-3">
          <Search size={18} className="text-text-secondary" />
          <Input
            aria-label={t('modals.commandPalette.searchLabel')}
            bgClassName="bg-transparent"
            className="h-9 border-0 px-0 text-base focus-visible:ring-0"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('modals.commandPalette.searchPlaceholder')}
            ref={inputRef}
            value={query}
          />
          <Button
            aria-label={t('modals.commandPalette.close')}
            className="h-8 w-8 bg-surface p-0 text-text-secondary"
            onClick={handleClose}
            type="button"
          >
            <X size={16} />
          </Button>
        </div>
        <div className="max-h-[420px] overflow-y-auto p-2">
          <UiText
            id="command-palette-title"
            variant={TextVariants.small}
            color={TextColors.secondary}
            className="px-2 py-1"
          >
            {t('modals.commandPalette.title')}
          </UiText>
          <div className="mb-2 flex flex-wrap items-center gap-1.5 px-2" data-testid="command-palette-coverage-summary">
            <UiText
              as="span"
              className="rounded bg-surface px-2 py-1"
              color={TextColors.secondary}
              data-command-palette-result-count={visibleCommands.length}
              variant={TextVariants.small}
            >
              {t('modals.commandPalette.coverage.resultCount', { count: visibleCommands.length })}
            </UiText>
            {selectedCommandPaths.length > 0 && (
              <UiText
                as="span"
                className="rounded bg-surface px-2 py-1"
                color={TextColors.secondary}
                data-command-palette-selected-source-count={selectedCommandPaths.length}
                variant={TextVariants.small}
              >
                {t('modals.commandPalette.coverage.selectedSourceCount', { count: selectedCommandPaths.length })}
              </UiText>
            )}
            {coverageCategories.map((category) => (
              <UiText
                as="span"
                className="rounded bg-surface px-2 py-1"
                color={TextColors.secondary}
                data-command-palette-category={category}
                key={category}
                variant={TextVariants.small}
              >
                {category}
              </UiText>
            ))}
          </div>
          {visibleCommands.length === 0 ? (
            <UiText className="px-2 py-8 text-center" color={TextColors.secondary}>
              {t('modals.commandPalette.noResults')}
            </UiText>
          ) : (
            <div className="mt-1 space-y-1">
              {visibleCommands.map((command, index) => {
                const Icon = getCommandIcon(command);
                const disabledReasonKey = getDisabledReasonKey(command);
                return (
                  <button
                    aria-current={index === resolvedActiveIndex ? 'true' : undefined}
                    aria-disabled={disabledReasonKey !== null}
                    className={cx(
                      'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                      disabledReasonKey && 'cursor-not-allowed opacity-55',
                      index === resolvedActiveIndex
                        ? 'bg-surface text-text-primary'
                        : 'text-text-secondary hover:bg-surface/70',
                    )}
                    data-command-palette-disabled-reason={disabledReasonKey ?? undefined}
                    disabled={disabledReasonKey !== null}
                    key={command.id}
                    onClick={() => {
                      executeCommand(command);
                    }}
                    onMouseEnter={() => {
                      setActiveIndex(index);
                    }}
                    type="button"
                  >
                    <Icon size={17} className="shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{t(commandLabelKeys[command.id])}</span>
                      {disabledReasonKey && (
                        <span className="block truncate text-xs text-text-tertiary">{t(disabledReasonKey)}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-text-secondary">
                      {t(commandCategoryKeys[command.category])}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
