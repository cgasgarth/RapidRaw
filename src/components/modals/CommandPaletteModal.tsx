import cx from 'clsx';
import {
  Aperture,
  ArrowLeft,
  Command,
  Images,
  LayoutTemplate,
  PanelRight,
  Scan,
  Search,
  Sparkles,
  ScanSearch,
  Wand2,
  Waves,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import {
  commandPaletteCommandSchema,
  type CommandPaletteCommand,
  type CommandPaletteCommandCategory,
  type CommandPaletteCommandId,
} from '../../schemas/commandPaletteSchemas';
import { useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useUIStore } from '../../store/useUIStore';
import { TextColors, TextVariants } from '../../types/typography';
import { Panel } from '../ui/AppProperties';
import Button from '../ui/Button';
import Input from '../ui/Input';
import UiText from '../ui/Text';

const commandPaletteCommands = commandPaletteCommandSchema.array().parse([
  {
    category: 'navigation',
    id: 'backToLibrary',
    requiresEditorImage: true,
    searchTokens: ['library', 'back', 'grid'],
  },
  {
    category: 'panels',
    id: 'panelAdjustments',
    requiresEditorImage: true,
    searchTokens: ['adjustments', 'basic', 'color'],
  },
  {
    category: 'panels',
    id: 'panelCrop',
    requiresEditorImage: true,
    searchTokens: ['crop', 'straighten', 'transform'],
  },
  {
    category: 'panels',
    id: 'panelMasks',
    requiresEditorImage: true,
    searchTokens: ['mask', 'layers', 'local'],
  },
  {
    category: 'panels',
    id: 'panelAi',
    requiresEditorImage: true,
    searchTokens: ['ai', 'agent', 'assistant'],
  },
  {
    category: 'panels',
    id: 'panelPresets',
    requiresEditorImage: true,
    searchTokens: ['preset', 'look'],
  },
  {
    category: 'panels',
    id: 'panelMetadata',
    requiresEditorImage: true,
    searchTokens: ['metadata', 'exif', 'iptc'],
  },
  {
    category: 'panels',
    id: 'panelExport',
    requiresEditorImage: true,
    searchTokens: ['export', 'output'],
  },
  {
    category: 'workflow',
    id: 'collage',
    searchTokens: ['collage', 'frame', 'layout', 'contact', 'sheet'],
  },
  {
    category: 'workflow',
    id: 'copyPasteSettings',
    searchTokens: ['copy', 'paste', 'settings'],
  },
  {
    category: 'workflow',
    id: 'culling',
    searchTokens: ['cull', 'culling', 'reject', 'duplicates', 'sharpness', 'select'],
  },
  {
    category: 'workflow',
    id: 'denoise',
    requiresEditorImage: true,
    searchTokens: ['denoise', 'noise', 'detail', 'raw', 'bm3d', 'ai'],
  },
  {
    category: 'workflow',
    id: 'importFiles',
    searchTokens: ['import', 'ingest', 'files'],
  },
  {
    category: 'workflow',
    id: 'lensCorrection',
    requiresEditorImage: true,
    searchTokens: ['lens', 'correction', 'profile', 'vignette', 'distortion', 'chromatic'],
  },
  {
    category: 'workflow',
    id: 'transformTools',
    requiresEditorImage: true,
    searchTokens: ['transform', 'geometry', 'rotate', 'perspective', 'keystone', 'distortion'],
  },
  {
    category: 'merge',
    id: 'panorama',
    searchTokens: ['panorama', 'stitch', 'merge'],
  },
  {
    category: 'merge',
    id: 'hdrMerge',
    searchTokens: ['hdr', 'stack', 'bracket'],
  },
  {
    category: 'merge',
    id: 'focusStack',
    searchTokens: ['focus', 'stack', 'sharpness'],
  },
  {
    category: 'merge',
    id: 'superResolution',
    searchTokens: ['super', 'resolution', 'upscale'],
  },
  {
    category: 'workflow',
    id: 'negativeLab',
    searchTokens: ['negative', 'film', 'scan'],
  },
]);

const commandLabelKeys = {
  backToLibrary: 'modals.commandPalette.commands.backToLibrary',
  collage: 'modals.commandPalette.commands.collage',
  copyPasteSettings: 'modals.commandPalette.commands.copyPasteSettings',
  culling: 'modals.commandPalette.commands.culling',
  denoise: 'modals.commandPalette.commands.denoise',
  focusStack: 'modals.commandPalette.commands.focusStack',
  hdrMerge: 'modals.commandPalette.commands.hdrMerge',
  importFiles: 'modals.commandPalette.commands.importFiles',
  lensCorrection: 'modals.commandPalette.commands.lensCorrection',
  negativeLab: 'modals.commandPalette.commands.negativeLab',
  panorama: 'modals.commandPalette.commands.panorama',
  panelAdjustments: 'modals.commandPalette.commands.panelAdjustments',
  panelAi: 'modals.commandPalette.commands.panelAi',
  panelCrop: 'modals.commandPalette.commands.panelCrop',
  panelExport: 'modals.commandPalette.commands.panelExport',
  panelMasks: 'modals.commandPalette.commands.panelMasks',
  panelMetadata: 'modals.commandPalette.commands.panelMetadata',
  panelPresets: 'modals.commandPalette.commands.panelPresets',
  superResolution: 'modals.commandPalette.commands.superResolution',
  transformTools: 'modals.commandPalette.commands.transformTools',
} as const satisfies Record<CommandPaletteCommandId, string>;

const commandCategoryKeys = {
  merge: 'modals.commandPalette.categories.merge',
  navigation: 'modals.commandPalette.categories.navigation',
  panels: 'modals.commandPalette.categories.panels',
  workflow: 'modals.commandPalette.categories.workflow',
} as const satisfies Record<CommandPaletteCommandCategory, string>;

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

const commandPanelMap = {
  panelAdjustments: Panel.Adjustments,
  panelAi: Panel.Ai,
  panelCrop: Panel.Crop,
  panelExport: Panel.Export,
  panelMasks: Panel.Masks,
  panelMetadata: Panel.Metadata,
  panelPresets: Panel.Presets,
} as const;

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
    () => (multiSelectedPaths.length > 0 ? multiSelectedPaths : selectedImage ? [selectedImage.path] : []),
    [multiSelectedPaths, selectedImage],
  );
  const selectedCommandImages = useMemo(() => {
    const selectedPathSet = new Set(selectedCommandPaths);
    return imageList.filter((image) => selectedPathSet.has(image.path)).slice(0, 9);
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
    const availableCommands = commandPaletteCommands.filter((command) => {
      if (command.id === 'culling') return selectedCommandPaths.length > 0;
      if (command.id === 'negativeLab') return selectedCommandPaths.length > 0;
      if (command.id === 'collage') return selectedCommandImages.length > 0;
      if (command.id === 'denoise') return selectedCommandPaths.length > 0;
      return !command.requiresEditorImage || selectedImage;
    });

    if (!normalizedQuery) return availableCommands;

    return availableCommands.filter((command) => {
      const haystack = [
        t(commandLabelKeys[command.id]),
        t(commandCategoryKeys[command.category]),
        ...command.searchTokens,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [query, selectedCommandImages.length, selectedCommandPaths.length, selectedImage, t]);

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
    if (command.id === 'backToLibrary') {
      closeAndRun(onBackToLibrary);
      return;
    }

    if (command.id in commandPanelMap) {
      const panel = commandPanelMap[command.id as keyof typeof commandPanelMap];
      closeAndRun(() => {
        setRightPanel(panel);
      });
      return;
    }

    if (command.id === 'copyPasteSettings') {
      closeAndRun(() => {
        setUI({ isCopyPasteSettingsModalOpen: true });
      });
      return;
    }

    if (command.id === 'importFiles') {
      closeAndRun(() => {
        setUI({ isImportModalOpen: true });
      });
      return;
    }

    if (command.id === 'collage' && selectedCommandImages.length > 0) {
      closeAndRun(() => {
        setUI({ collageModalState: { isOpen: true, sourceImages: selectedCommandImages } });
      });
      return;
    }

    if (command.id === 'denoise' && selectedCommandPaths.length > 0) {
      closeAndRun(() => {
        setUI((state) => ({
          denoiseModalState: {
            ...state.denoiseModalState,
            error: null,
            isOpen: true,
            isRaw: selectedImage?.isRaw ?? false,
            previewBase64: null,
            progressMessage: null,
            targetPaths: selectedCommandPaths,
          },
        }));
      });
      return;
    }

    if (command.id === 'culling' && selectedCommandPaths.length > 0) {
      closeAndRun(() => {
        setUI((state) => ({
          cullingModalState: {
            ...state.cullingModalState,
            error: null,
            isOpen: true,
            pathsToCull: selectedCommandPaths,
            progress: null,
            suggestions: null,
          },
        }));
      });
      return;
    }

    if (command.id === 'lensCorrection' && selectedImage) {
      closeAndRun(() => {
        setRightPanel(Panel.Crop);
        setUI({ isLensCorrectionModalOpen: true });
      });
      return;
    }

    if (command.id === 'transformTools' && selectedImage) {
      closeAndRun(() => {
        setRightPanel(Panel.Crop);
        setUI({ isTransformModalOpen: true });
      });
      return;
    }

    if (command.id === 'panorama') {
      closeAndRun(() => {
        setUI((state) => ({ panoramaModalState: { ...state.panoramaModalState, isOpen: true } }));
      });
      return;
    }

    if (command.id === 'hdrMerge') {
      closeAndRun(() => {
        setUI((state) => ({ hdrModalState: { ...state.hdrModalState, isOpen: true } }));
      });
      return;
    }

    if (command.id === 'focusStack') {
      closeAndRun(() => {
        setUI((state) => ({ focusStackModalState: { ...state.focusStackModalState, isOpen: true } }));
      });
      return;
    }

    if (command.id === 'superResolution') {
      closeAndRun(() => {
        setUI((state) => ({ superResolutionModalState: { ...state.superResolutionModalState, isOpen: true } }));
      });
      return;
    }

    if (command.id === 'negativeLab' && selectedCommandPaths.length > 0) {
      closeAndRun(() => {
        setUI((state) => ({
          negativeModalState: { ...state.negativeModalState, isOpen: true, targetPaths: selectedCommandPaths },
        }));
      });
    }
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
      if (command) executeCommand(command);
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
                return (
                  <button
                    aria-current={index === resolvedActiveIndex ? 'true' : undefined}
                    className={cx(
                      'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                      index === resolvedActiveIndex
                        ? 'bg-surface text-text-primary'
                        : 'text-text-secondary hover:bg-surface/70',
                    )}
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
                    <span className="min-w-0 flex-1 truncate">{t(commandLabelKeys[command.id])}</span>
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
