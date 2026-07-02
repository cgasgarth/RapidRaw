import { type ImageFile, Panel, type SelectedImage, type SupportedTypes } from '../components/ui/AppProperties';
import {
  type CommandPaletteCommand,
  type CommandPaletteCommandCategory,
  type CommandPaletteCommandId,
  commandPaletteCommandSchema,
} from '../schemas/commandPaletteSchemas';
import type { UIState } from '../store/useUIStore';
import { createFocusStackSourcePreflightMetadata } from './focusStackSourcePreflight';
import { buildHdrLaunchSourceMetadata, resolveHdrLaunchSourcePaths } from './hdrAutoStackSelection';
import {
  getNegativeLabCommandPaletteDisabledReasonKey,
  getNegativeLabSourceReadiness,
} from './negative-lab/negativeLabSourceReadiness';
import { createSuperResolutionSourcePreflightMetadata } from './superResolutionSourcePreflight';

export type { CommandPaletteCommand };

export const commandPaletteCommands = commandPaletteCommandSchema.array().parse([
  {
    category: 'navigation',
    id: 'backToLibrary',
    requiresEditorImage: true,
    searchTokens: ['library', 'back', 'grid'],
  },
  {
    category: 'panels',
    id: 'panelMetadata',
    requiresEditorImage: true,
    searchTokens: ['metadata', 'exif', 'iptc'],
  },
  {
    category: 'panels',
    id: 'panelAdjustments',
    requiresEditorImage: true,
    searchTokens: ['adjustments', 'basic', 'tone', 'exposure'],
  },
  {
    category: 'panels',
    id: 'panelColor',
    requiresEditorImage: true,
    searchTokens: ['color', 'grading', 'white', 'balance', 'hsl', 'tone'],
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
    id: 'panelAgent',
    requiresEditorImage: true,
    searchTokens: ['agent', 'assistant', 'chat', 'edit'],
  },
  {
    category: 'panels',
    id: 'panelAi',
    requiresEditorImage: true,
    searchTokens: ['ai', 'inpaint', 'generative', 'erase'],
  },
  {
    category: 'panels',
    id: 'panelPresets',
    requiresEditorImage: true,
    searchTokens: ['preset', 'look'],
  },
  {
    category: 'panels',
    id: 'panelTether',
    requiresEditorImage: true,
    searchTokens: ['tether', 'capture', 'camera', 'session'],
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

export const commandLabelKeys = {
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
  panelAgent: 'modals.commandPalette.commands.panelAgent',
  panelAi: 'modals.commandPalette.commands.panelAi',
  panelColor: 'modals.commandPalette.commands.panelColor',
  panelCrop: 'modals.commandPalette.commands.panelCrop',
  panelExport: 'modals.commandPalette.commands.panelExport',
  panelMasks: 'modals.commandPalette.commands.panelMasks',
  panelMetadata: 'modals.commandPalette.commands.panelMetadata',
  panelPresets: 'modals.commandPalette.commands.panelPresets',
  panelTether: 'modals.commandPalette.commands.panelTether',
  superResolution: 'modals.commandPalette.commands.superResolution',
  transformTools: 'modals.commandPalette.commands.transformTools',
} as const satisfies Record<CommandPaletteCommandId, string>;

export const commandCategoryKeys = {
  merge: 'modals.commandPalette.categories.merge',
  navigation: 'modals.commandPalette.categories.navigation',
  panels: 'modals.commandPalette.categories.panels',
  workflow: 'modals.commandPalette.categories.workflow',
} as const satisfies Record<CommandPaletteCommandCategory, string>;

export const commandPanelMap = {
  panelMetadata: Panel.Metadata,
  panelAdjustments: Panel.Adjustments,
  panelColor: Panel.Color,
  panelCrop: Panel.Crop,
  panelMasks: Panel.Masks,
  panelAgent: Panel.Agent,
  panelAi: Panel.Ai,
  panelPresets: Panel.Presets,
  panelTether: Panel.Tether,
  panelExport: Panel.Export,
} as const;

export type CommandPaletteDisabledReasonKey =
  | 'modals.commandPalette.unavailable.selectImage'
  | 'modals.commandPalette.unavailable.selectEditorImage'
  | 'modals.commandPalette.unavailable.selectSource'
  | 'modals.commandPalette.unavailable.negativeLabLoading'
  | 'modals.commandPalette.unavailable.negativeLabUnsupported';

export interface CommandPaletteUiState {
  collageModalState?: unknown;
  cullingModalState: Record<string, unknown>;
  denoiseModalState: Record<string, unknown>;
  focusStackModalState: {
    sourcePaths: string[];
    sourcePreflightMetadata: unknown[];
    [key: string]: unknown;
  };
  hdrModalState: {
    sourceMetadata: unknown[];
    stitchingSourcePaths: string[];
    [key: string]: unknown;
  };
  isCopyPasteSettingsModalOpen?: boolean;
  isImportModalOpen?: boolean;
  isLensCorrectionModalOpen?: boolean;
  isTransformModalOpen?: boolean;
  negativeModalState: Record<string, unknown>;
  panoramaModalState: {
    stitchingSourcePaths: string[];
    [key: string]: unknown;
  };
  superResolutionModalState: {
    sourcePaths: string[];
    sourcePreflightMetadata: unknown[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export type CommandPaletteSetUI = (updater: Partial<UIState> | ((state: UIState) => Partial<UIState>)) => void;

export interface CommandPaletteActionContext {
  imageList: ImageFile[];
  onBackToLibrary: () => void;
  selectedCommandImages: ImageFile[];
  selectedCommandPaths: string[];
  selectedImage: SelectedImage | null;
  setRightPanel: (panel: Panel | null) => void;
  setUI: CommandPaletteSetUI;
  supportedTypes: SupportedTypes | null;
}

export function getCommandPaletteSelectedPaths(
  multiSelectedPaths: string[],
  libraryActivePath: string | null,
  selectedImage: SelectedImage | null,
): string[] {
  if (multiSelectedPaths.length > 0) return multiSelectedPaths;
  if (selectedImage) return [selectedImage.path];
  if (libraryActivePath) return [libraryActivePath];
  return [];
}

export function getCommandPaletteSelectedImages(imageList: ImageFile[], selectedCommandPaths: string[]): ImageFile[] {
  const selectedPathSet = new Set(selectedCommandPaths);
  return imageList.filter((image) => selectedPathSet.has(image.path)).slice(0, 9);
}

export function getCommandPaletteDisabledReasonKey(
  command: CommandPaletteCommand,
  selectedCommandImages: ImageFile[],
  selectedCommandPaths: string[],
  selectedImage: SelectedImage | null,
  supportedTypes: SupportedTypes | null,
): CommandPaletteDisabledReasonKey | null {
  if (command.id === 'collage' && selectedCommandImages.length === 0) {
    return 'modals.commandPalette.unavailable.selectSource';
  }
  if (['culling', 'denoise', 'negativeLab'].includes(command.id) && selectedCommandPaths.length === 0) {
    return 'modals.commandPalette.unavailable.selectSource';
  }
  if (command.id === 'negativeLab') {
    return getNegativeLabCommandPaletteDisabledReasonKey(
      getNegativeLabSourceReadiness(selectedCommandPaths, supportedTypes),
    ) as CommandPaletteDisabledReasonKey | null;
  }
  if (command.requiresEditorImage && !selectedImage) {
    return selectedCommandPaths.length > 0
      ? 'modals.commandPalette.unavailable.selectEditorImage'
      : 'modals.commandPalette.unavailable.selectImage';
  }
  return null;
}

export function createCommandPaletteAction(
  command: CommandPaletteCommand,
  context: CommandPaletteActionContext,
): (() => void) | null {
  const {
    imageList,
    onBackToLibrary,
    selectedCommandImages,
    selectedCommandPaths,
    selectedImage,
    setRightPanel,
    setUI,
    supportedTypes,
  } = context;

  if (command.id === 'backToLibrary') {
    return onBackToLibrary;
  }

  if (command.id in commandPanelMap) {
    const panel = commandPanelMap[command.id as keyof typeof commandPanelMap];
    return () => {
      setRightPanel(panel);
    };
  }

  if (command.id === 'copyPasteSettings') {
    return () => {
      setUI({ isCopyPasteSettingsModalOpen: true });
    };
  }

  if (command.id === 'importFiles') {
    return () => {
      setUI({ isImportModalOpen: true });
    };
  }

  if (command.id === 'collage' && selectedCommandImages.length > 0) {
    return () => {
      setUI({ collageModalState: { isOpen: true, sourceImages: selectedCommandImages } });
    };
  }

  if (command.id === 'denoise' && selectedCommandPaths.length > 0) {
    return () => {
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
    };
  }

  if (command.id === 'culling' && selectedCommandPaths.length > 0) {
    return () => {
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
    };
  }

  if (command.id === 'lensCorrection' && selectedImage) {
    return () => {
      setRightPanel(Panel.Crop);
      setUI({ isLensCorrectionModalOpen: true });
    };
  }

  if (command.id === 'transformTools' && selectedImage) {
    return () => {
      setRightPanel(Panel.Crop);
      setUI({ isTransformModalOpen: true });
    };
  }

  if (command.id === 'panorama') {
    return () => {
      setUI((state) => ({
        panoramaModalState: {
          ...state.panoramaModalState,
          error: null,
          finalImageBase64: null,
          isOpen: true,
          lastApplyCommand: null,
          lastDryRunCommand: null,
          progressMessage: null,
          renderedReview: null,
          runtimePlan: null,
          stitchingSourcePaths:
            selectedCommandPaths.length > 0 ? selectedCommandPaths : state.panoramaModalState.stitchingSourcePaths,
        },
      }));
    };
  }

  if (command.id === 'hdrMerge') {
    return () => {
      setUI((state) => {
        const { lastDryRunCommand: _lastDryRunCommand, ...hdrModalState } = state.hdrModalState;
        const hdrLaunchSourcePaths = resolveHdrLaunchSourcePaths(imageList, selectedCommandPaths);
        return {
          hdrModalState: {
            ...hdrModalState,
            error: null,
            finalImageBase64: null,
            isOpen: true,
            progressMessage: null,
            sourceMetadata:
              selectedCommandPaths.length > 0
                ? buildHdrLaunchSourceMetadata(imageList, selectedCommandPaths)
                : state.hdrModalState.sourceMetadata,
            stitchingSourcePaths:
              selectedCommandPaths.length > 0 ? hdrLaunchSourcePaths : state.hdrModalState.stitchingSourcePaths,
          },
        };
      });
    };
  }

  if (command.id === 'focusStack') {
    return () => {
      setUI((state) => {
        const { lastDryRunCommand: _lastDryRunCommand, ...focusStackModalState } = state.focusStackModalState;
        return {
          focusStackModalState: {
            ...focusStackModalState,
            isOpen: true,
            outputReview: null,
            sourcePreflightMetadata:
              selectedCommandPaths.length > 0
                ? createFocusStackSourcePreflightMetadata(selectedCommandPaths, imageList)
                : state.focusStackModalState.sourcePreflightMetadata,
            sourcePaths:
              selectedCommandPaths.length > 0 ? selectedCommandPaths : state.focusStackModalState.sourcePaths,
          },
        };
      });
    };
  }

  if (command.id === 'superResolution') {
    return () => {
      setUI((state) => {
        const { lastDryRunCommand: _lastDryRunCommand, ...superResolutionModalState } = state.superResolutionModalState;
        return {
          superResolutionModalState: {
            ...superResolutionModalState,
            isOpen: true,
            outputReview: null,
            sourcePreflightMetadata:
              selectedCommandPaths.length > 0
                ? createSuperResolutionSourcePreflightMetadata(selectedCommandPaths, imageList)
                : state.superResolutionModalState.sourcePreflightMetadata,
            sourcePaths:
              selectedCommandPaths.length > 0 ? selectedCommandPaths : state.superResolutionModalState.sourcePaths,
          },
        };
      });
    };
  }

  if (command.id === 'negativeLab') {
    const negativeLabReadiness = getNegativeLabSourceReadiness(selectedCommandPaths, supportedTypes);
    if (!negativeLabReadiness.isReady) return null;
    return () => {
      setUI((state) => ({
        negativeModalState: {
          ...state.negativeModalState,
          isOpen: true,
          targetPaths: negativeLabReadiness.targetPaths,
        },
      }));
    };
  }

  return null;
}
