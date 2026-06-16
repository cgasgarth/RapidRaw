import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import cx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import throttle from 'lodash.throttle';
import { RotateCcw, ZoomIn, ZoomOut, Maximize, Save, Loader2, Eye, EyeOff, Info, WandSparkles } from 'lucide-react';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation, Trans } from 'react-i18next';

import { useModalTransition } from '../../hooks/useModalTransition';
import {
  negativeBaseFogEstimateSchema,
  negativeConversionSavedPathsSchema,
  type NegativeLabBaseFogSampleRect,
  type NegativeLabBuiltInUiPreset,
  type NegativeLabPresetParams,
} from '../../schemas/negativeLabPresetCatalogSchemas';
import { parsePathProgressPayload } from '../../schemas/tauriEventSchemas';
import { TextColors, TextVariants } from '../../types/typography';
import {
  DEFAULT_NEGATIVE_LAB_UI_PRESET,
  NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG,
} from '../../utils/negativeLabPresetCatalog';
import { invokeWithSchema } from '../../utils/tauriSchemaInvoke';
import Button from '../ui/Button';
import Slider from '../ui/Slider';
import UiText from '../ui/Text';

type NegativeParams = NegativeLabPresetParams;
type NegativeOutputFormat = 'jpeg_proof' | 'tiff16';
type NegativeConversionScope = 'active' | 'all';
type BaseFogSampleLabelKey = 'modals.negativeConversion.sampleCenterPatch' | 'modals.negativeConversion.sampleLeftEdge';

const DEFAULT_PARAMS: NegativeParams = DEFAULT_NEGATIVE_LAB_UI_PRESET.params;
const DEFAULT_SAVE_OPTIONS = {
  outputFormat: 'tiff16' as NegativeOutputFormat,
  suffix: 'Positive',
};
const getInitialIncludedPaths = (paths: string[]) => new Set(paths);
const getNegativeLabScanLabel = (path: string, index: number) => {
  const pathParts = path.split(/[\\/]/u).filter(Boolean);
  return pathParts.at(-1) ?? String(index + 1);
};
const BASE_FOG_SAMPLE_PRESETS = [
  {
    labelKey: 'modals.negativeConversion.sampleLeftEdge',
    rect: { height: 0.6, width: 0.12, x: 0.02, y: 0.2 },
  },
  {
    labelKey: 'modals.negativeConversion.sampleCenterPatch',
    rect: { height: 0.22, width: 0.22, x: 0.39, y: 0.39 },
  },
] satisfies Array<{ labelKey: BaseFogSampleLabelKey; rect: NegativeLabBaseFogSampleRect }>;

type NegativeLabWorkflowStageId = 'setup' | 'preset' | 'colorTiming' | 'printGrade' | 'export';

interface NegativeLabWorkflowStage {
  detail: string;
  id: NegativeLabWorkflowStageId;
  isComplete: boolean;
  label: string;
}

interface NegativeConversionModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetPaths: string[];
  onSave: (savedPaths: string[]) => void;
}

export default function NegativeConversionModal({
  isOpen,
  onClose,
  targetPaths,
  onSave,
}: NegativeConversionModalProps) {
  const { t } = useTranslation();
  const [params, setParams] = useState<NegativeParams>(DEFAULT_PARAMS);
  const [selectedPresetId, setSelectedPresetId] = useState<string>(DEFAULT_NEGATIVE_LAB_UI_PRESET.presetId);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isEstimatingBaseFog, setIsEstimatingBaseFog] = useState(false);
  const [baseFogConfidence, setBaseFogConfidence] = useState<number | null>(null);
  const [activeBaseFogSampleLabel, setActiveBaseFogSampleLabel] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [saveOptions, setSaveOptions] = useState(DEFAULT_SAVE_OPTIONS);
  const [conversionScope, setConversionScope] = useState<NegativeConversionScope>('all');
  const [includedPathSet, setIncludedPathSet] = useState<Set<string>>(() => getInitialIncludedPaths(targetPaths));
  const [activePathIndex, setActivePathIndex] = useState(0);

  const { isMounted, show } = useModalTransition(isOpen);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isCompareActive, setIsCompareActive] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const lastMousePos = useRef({ x: 0, y: 0 });
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const effectiveActivePathIndex = targetPaths[activePathIndex] === undefined ? 0 : activePathIndex;
  const selectedImagePath = targetPaths[effectiveActivePathIndex] ?? null;
  const hasMultipleScans = targetPaths.length > 1;
  const pathsToConvert = useMemo(() => {
    if (conversionScope === 'active' && selectedImagePath !== null) return [selectedImagePath];
    return targetPaths.filter((path) => includedPathSet.has(path));
  }, [conversionScope, includedPathSet, selectedImagePath, targetPaths]);

  const selectedPreset = useMemo(
    () =>
      NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG.presets.find((preset) => preset.presetId === selectedPresetId) ?? null,
    [selectedPresetId],
  );

  const workflowStages = useMemo<NegativeLabWorkflowStage[]>(
    () => [
      {
        detail:
          targetPaths.length === 1
            ? t('modals.negativeConversion.workflowSetupDetailSingle')
            : t('modals.negativeConversion.workflowSetupDetailMultiple', { scanCount: targetPaths.length }),
        id: 'setup',
        isComplete: targetPaths.length > 0,
        label: t('modals.negativeConversion.workflowSetup'),
      },
      {
        detail: selectedPreset?.displayName ?? t('modals.negativeConversion.workflowCustomPresetDetail'),
        id: 'preset',
        isComplete: true,
        label: t('modals.negativeConversion.workflowPreset'),
      },
      {
        detail: t('modals.negativeConversion.workflowColorDetail', {
          base: Math.round(params.base_fog_strength * 100),
          blue: params.blue_weight.toFixed(2),
          green: params.green_weight.toFixed(2),
          red: params.red_weight.toFixed(2),
        }),
        id: 'colorTiming',
        isComplete: true,
        label: t('modals.negativeConversion.workflowColorTiming'),
      },
      {
        detail: t('modals.negativeConversion.workflowPrintDetail', {
          contrast: params.contrast.toFixed(2),
          exposure: params.exposure.toFixed(2),
        }),
        id: 'printGrade',
        isComplete: true,
        label: t('modals.negativeConversion.workflowPrintGrade'),
      },
      {
        detail: isSaving
          ? t('modals.negativeConversion.workflowExportConverting')
          : t('modals.negativeConversion.workflowExportReadyCount', {
              format: t(
                saveOptions.outputFormat === 'tiff16'
                  ? 'modals.negativeConversion.outputFormats.tiff16'
                  : 'modals.negativeConversion.outputFormats.jpeg_proof',
              ),
              queuedCount: pathsToConvert.length,
            }),
        id: 'export',
        isComplete: !isLoading && previewUrl !== null && pathsToConvert.length > 0,
        label: t('modals.negativeConversion.workflowExport'),
      },
    ],
    [
      isLoading,
      isSaving,
      params,
      pathsToConvert.length,
      previewUrl,
      saveOptions.outputFormat,
      selectedPreset,
      t,
      targetPaths.length,
    ],
  );

  useEffect(() => {
    const unlisten = listen<unknown>('negative-batch-progress', (event) => {
      const payload = parsePathProgressPayload(event.payload);
      setProgress({ current: payload.current, total: payload.total });
    });
    return () => {
      void unlisten
        .then((f) => {
          f();
        })
        .catch((err: unknown) => {
          console.error('Failed to remove negative batch progress listener:', err);
        });
    };
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const handleWindowMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    };
    const handleWindowMouseUp = () => {
      setIsDragging(false);
    };
    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [isDragging]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setIsDragging(true);
    lastMousePos.current = { x: e.clientX, y: e.clientY };
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left - rect.width / 2;
    const mouseY = e.clientY - rect.top - rect.height / 2;
    const delta = -e.deltaY * 0.001;
    const newZoom = Math.min(Math.max(0.1, zoom + delta), 8);
    const scaleRatio = newZoom / zoom;
    const mouseFromCenterX = mouseX - pan.x;
    const mouseFromCenterY = mouseY - pan.y;
    const newPanX = mouseX - mouseFromCenterX * scaleRatio;
    const newPanY = mouseY - mouseFromCenterY * scaleRatio;

    setZoom(newZoom);
    setPan({ x: newPanX, y: newPanY });
  };

  const updatePreview = useMemo(
    () =>
      throttle(async (currentParams: NegativeParams, isInitialLoad: boolean = false) => {
        if (!selectedImagePath) return;
        try {
          const result: string = await invoke('preview_negative_conversion', {
            path: selectedImagePath,
            params: currentParams,
          });
          setPreviewUrl(result);
          if (isInitialLoad) {
            setIsLoading(false);
          }
        } catch (e) {
          console.error('Negative preview failed', e);
          if (isInitialLoad) {
            setIsLoading(false);
          }
        }
      }, 100),
    [selectedImagePath],
  );

  useEffect(() => {
    if (isOpen) {
      const timer = window.setTimeout(() => {
        setIsLoading(true);
        void updatePreview(DEFAULT_PARAMS, true);
      }, 0);

      if (selectedImagePath) {
        invoke<number[]>('generate_preview_for_path', {
          path: selectedImagePath,
          jsAdjustments: {},
        })
          .then((res) => {
            const blob = new Blob([new Uint8Array(res)], { type: 'image/jpeg' });
            setOriginalUrl(URL.createObjectURL(blob));
          })
          .catch(console.error);
      }
      return () => {
        window.clearTimeout(timer);
      };
    }

    const timer = window.setTimeout(() => {
      setPreviewUrl(null);
      setOriginalUrl(null);
      setParams(DEFAULT_PARAMS);
      setSelectedPresetId(DEFAULT_NEGATIVE_LAB_UI_PRESET.presetId);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setBaseFogConfidence(null);
      setActiveBaseFogSampleLabel(null);
      setActivePathIndex(0);
      setIsLoading(true);
      setProgress(null);
      setSaveOptions(DEFAULT_SAVE_OPTIONS);
      setConversionScope('all');
      setIncludedPathSet(getInitialIncludedPaths(targetPaths));
    }, 300);
    return () => {
      window.clearTimeout(timer);
    };
  }, [isOpen, selectedImagePath, targetPaths, updatePreview]);

  const handleParamChange = (key: keyof NegativeParams, value: number) => {
    const newParams = { ...params, [key]: value };
    setSelectedPresetId('');
    if (key !== 'base_fog_strength') {
      setBaseFogConfidence(null);
      setActiveBaseFogSampleLabel(null);
    }
    setParams(newParams);
    void updatePreview(newParams);
  };

  const handlePresetSelect = (preset: NegativeLabBuiltInUiPreset) => {
    setSelectedPresetId(preset.presetId);
    setBaseFogConfidence(null);
    setActiveBaseFogSampleLabel(null);
    setParams(preset.params);
    void updatePreview(preset.params);
  };

  const handleAutoBaseFog = async () => {
    if (!selectedImagePath) return;
    setIsEstimatingBaseFog(true);
    try {
      const estimate = await invokeWithSchema(
        'estimate_negative_base_fog',
        {
          path: selectedImagePath,
          sampleRect: null,
        },
        negativeBaseFogEstimateSchema,
      );
      const nextParams = {
        ...params,
        base_fog_strength: 1,
        base_fog_sample: null,
        blue_weight: estimate.blueWeight,
        green_weight: estimate.greenWeight,
        red_weight: estimate.redWeight,
      };
      setBaseFogConfidence(estimate.confidence);
      setActiveBaseFogSampleLabel(t('modals.negativeConversion.sampleFullFrame'));
      setSelectedPresetId('');
      setParams(nextParams);
      void updatePreview(nextParams);
    } catch (e) {
      console.error('Negative base/fog estimate failed', e);
    } finally {
      setIsEstimatingBaseFog(false);
    }
  };

  const handleSampleBaseFog = async (labelKey: BaseFogSampleLabelKey, sampleRect: NegativeLabBaseFogSampleRect) => {
    if (!selectedImagePath) return;
    setIsEstimatingBaseFog(true);
    try {
      const estimate = await invokeWithSchema(
        'estimate_negative_base_fog',
        {
          path: selectedImagePath,
          sampleRect,
        },
        negativeBaseFogEstimateSchema,
      );
      const nextParams = {
        ...params,
        base_fog_strength: 1,
        base_fog_sample: sampleRect,
        blue_weight: estimate.blueWeight,
        green_weight: estimate.greenWeight,
        red_weight: estimate.redWeight,
      };
      setBaseFogConfidence(estimate.confidence);
      setActiveBaseFogSampleLabel(t(labelKey));
      setSelectedPresetId('');
      setParams(nextParams);
      void updatePreview(nextParams);
    } catch (e) {
      console.error('Negative base/fog sample failed', e);
    } finally {
      setIsEstimatingBaseFog(false);
    }
  };

  const handleSave = async () => {
    if (pathsToConvert.length === 0) return;
    setIsSaving(true);
    setProgress(null);
    try {
      const savedPaths = await invokeWithSchema(
        'convert_negatives',
        {
          paths: pathsToConvert,
          params,
          options: saveOptions,
        },
        negativeConversionSavedPathsSchema,
      );
      onSave(savedPaths);
      onClose();
    } catch (e) {
      console.error('Failed to batch save negatives', e);
    } finally {
      setIsSaving(false);
      setProgress(null);
    }
  };

  const handleToggleIncludedPath = (path: string) => {
    setIncludedPathSet((currentIncludedPaths) => {
      const nextIncludedPaths = new Set(currentIncludedPaths);
      if (nextIncludedPaths.has(path)) {
        nextIncludedPaths.delete(path);
      } else {
        nextIncludedPaths.add(path);
      }
      return nextIncludedPaths;
    });
  };

  const imageTransformStyle = {
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
    transition: isDragging ? 'none' : 'transform 0.1s ease-out',
    transformOrigin: 'center center',
  };

  const renderBatchReadiness = () => (
    <div
      className="space-y-2 rounded-md border border-surface bg-bg-primary p-2"
      data-testid="negative-lab-batch-readiness"
    >
      <div className="flex items-center justify-between gap-2">
        <UiText variant={TextVariants.small} className="font-medium text-text-primary">
          {t('modals.negativeConversion.batchReadiness')}
        </UiText>
        <UiText data-testid="negative-lab-queued-count" variant={TextVariants.small} className="text-text-tertiary">
          {t('modals.negativeConversion.queuedScans', { queuedCount: pathsToConvert.length })}
        </UiText>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <span
          className="rounded-sm bg-bg-secondary px-2 py-1 text-text-secondary"
          data-testid="negative-lab-preview-status"
        >
          {previewUrl === null
            ? t('modals.negativeConversion.previewPending')
            : t('modals.negativeConversion.previewReady')}
        </span>
        <span
          className="rounded-sm bg-bg-secondary px-2 py-1 text-text-secondary"
          data-testid="negative-lab-base-status"
        >
          {baseFogConfidence === null
            ? t('modals.negativeConversion.basePending')
            : t('modals.negativeConversion.baseReady', { confidence: Math.round(baseFogConfidence * 100) })}
        </span>
        <span
          className="rounded-sm bg-bg-secondary px-2 py-1 text-text-secondary"
          data-testid="negative-lab-included-status"
        >
          {t('modals.negativeConversion.includedScans', { includedCount: includedPathSet.size })}
        </span>
      </div>
    </div>
  );

  const renderControls = () => (
    <div className="modal-adjustments-pane w-80 shrink-0 bg-bg-secondary flex flex-col border-l border-surface h-full z-10">
      <div className="p-4 flex justify-between items-center shrink-0 border-b border-surface">
        <UiText variant={TextVariants.title}>{t('modals.negativeConversion.title')}</UiText>
        <button
          onClick={() => {
            setParams(DEFAULT_PARAMS);
            setSelectedPresetId(DEFAULT_NEGATIVE_LAB_UI_PRESET.presetId);
            setBaseFogConfidence(null);
            setActiveBaseFogSampleLabel(null);
            void updatePreview(DEFAULT_PARAMS);
          }}
          disabled={isSaving || isEstimatingBaseFog}
          data-tooltip={t('modals.negativeConversion.resetTooltip')}
          className="p-2 rounded-full hover:bg-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RotateCcw size={18} />
        </button>
      </div>

      <div className="grow overflow-y-auto p-4 flex flex-col gap-8">
        <div className={cx('transition-opacity duration-200', isSaving && 'opacity-50 pointer-events-none grayscale')}>
          <UiText variant={TextVariants.heading} className="mb-2">
            {t('modals.negativeConversion.workflowSetup')}
          </UiText>
          <div className="space-y-2 rounded-md border border-surface bg-bg-primary p-2">
            <UiText variant={TextVariants.small} className="text-text-secondary">
              {targetPaths.length === 1
                ? t('modals.negativeConversion.workflowSetupDetailSingle')
                : t('modals.negativeConversion.workflowSetupDetailMultiple', { scanCount: targetPaths.length })}
            </UiText>
            <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
              {targetPaths.map((path, index) => {
                const isActiveScan = index === effectiveActivePathIndex;
                const isIncludedScan = includedPathSet.has(path);
                const scanLabel = getNegativeLabScanLabel(path, index);

                return (
                  <div
                    className={cx(
                      'grid grid-cols-[1fr_auto] gap-2 rounded-md border p-1 text-xs transition-colors',
                      isActiveScan
                        ? 'border-accent bg-accent/10 text-text-primary'
                        : 'border-surface bg-bg-secondary text-text-secondary hover:bg-surface',
                    )}
                    key={`${path}-${index}`}
                  >
                    <button
                      aria-current={isActiveScan ? 'true' : undefined}
                      className="flex min-w-0 items-center justify-between gap-2 rounded px-1.5 py-1 text-left disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isSaving || isEstimatingBaseFog}
                      onClick={() => {
                        setActivePathIndex(index);
                        setZoom(1);
                        setPan({ x: 0, y: 0 });
                      }}
                      title={path}
                      type="button"
                    >
                      <span className={cx('truncate', !isIncludedScan && 'line-through opacity-60')}>{scanLabel}</span>
                      {isActiveScan && <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" />}
                    </button>
                    <button
                      aria-pressed={isIncludedScan}
                      className={cx(
                        'rounded px-2 py-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                        isIncludedScan
                          ? 'bg-accent/15 text-text-primary'
                          : 'bg-bg-primary text-text-secondary hover:bg-surface',
                      )}
                      data-testid={`negative-lab-include-toggle-${index}`}
                      disabled={isSaving || isEstimatingBaseFog}
                      onClick={() => {
                        handleToggleIncludedPath(path);
                      }}
                      type="button"
                    >
                      {t(
                        isIncludedScan
                          ? 'modals.negativeConversion.excludeScan'
                          : 'modals.negativeConversion.includeScan',
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
            {hasMultipleScans && (
              <div className="grid grid-cols-2 gap-2" data-testid="negative-lab-conversion-scope">
                {(['all', 'active'] satisfies Array<NegativeConversionScope>).map((scope) => (
                  <button
                    aria-pressed={conversionScope === scope}
                    className={cx(
                      'rounded-md border px-2 py-1.5 text-xs transition-colors',
                      conversionScope === scope
                        ? 'border-accent bg-accent/10 text-text-primary'
                        : 'border-surface bg-bg-secondary text-text-secondary hover:bg-surface',
                    )}
                    data-testid={scope === 'all' ? 'negative-lab-scope-all' : 'negative-lab-scope-active'}
                    key={scope}
                    onClick={() => {
                      setConversionScope(scope);
                    }}
                    type="button"
                  >
                    {t(
                      scope === 'all' ? 'modals.negativeConversion.scopeAll' : 'modals.negativeConversion.scopeActive',
                    )}
                  </button>
                ))}
              </div>
            )}
            {renderBatchReadiness()}
          </div>
        </div>

        <div className={cx('transition-opacity duration-200', isSaving && 'opacity-50 pointer-events-none grayscale')}>
          <UiText variant={TextVariants.heading} className="mb-2">
            {t('modals.negativeConversion.genericPresets')}
          </UiText>
          <div className="grid grid-cols-1 gap-2">
            {NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG.presets.map((preset) => {
              const isSelected = selectedPresetId === preset.presetId;

              return (
                <button
                  key={preset.presetId}
                  type="button"
                  onClick={() => {
                    handlePresetSelect(preset);
                  }}
                  className={cx(
                    'text-left rounded-md border p-3 transition-colors',
                    isSelected
                      ? 'border-accent bg-accent/10 text-text-primary'
                      : 'border-surface bg-bg-primary hover:bg-surface text-text-secondary',
                  )}
                >
                  <span className="block text-sm font-medium">{preset.displayName}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className={cx('transition-opacity duration-200', isSaving && 'opacity-50 pointer-events-none grayscale')}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <UiText variant={TextVariants.heading}>{t('modals.negativeConversion.colorTiming')}</UiText>
            <button
              type="button"
              onClick={() => {
                void handleAutoBaseFog();
              }}
              disabled={!selectedImagePath || isEstimatingBaseFog || isSaving}
              data-testid="negative-lab-auto-base-fog"
              data-tooltip={t('modals.negativeConversion.autoBaseFogTooltip')}
              className="inline-flex items-center gap-1 rounded-md border border-surface bg-bg-primary px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isEstimatingBaseFog ? <Loader2 size={13} className="animate-spin" /> : <WandSparkles size={13} />}
              {t('modals.negativeConversion.autoBaseFog')}
            </button>
          </div>
          <div className="space-y-3">
            <Slider
              label={t('modals.negativeConversion.baseFogStrength')}
              value={params.base_fog_strength}
              min={0}
              max={1.25}
              step={0.01}
              defaultValue={1}
              onChange={(e) => {
                handleParamChange('base_fog_strength', Number(e.target.value));
              }}
              fillOrigin="min"
            />
            <div className="space-y-2 rounded-md border border-surface bg-bg-primary p-2">
              <div className="flex items-center justify-between gap-2">
                <UiText variant={TextVariants.small} className="text-text-secondary">
                  {t('modals.negativeConversion.baseFogSample')}
                </UiText>
                {activeBaseFogSampleLabel !== null && (
                  <UiText variant={TextVariants.small} className="truncate text-text-tertiary">
                    {activeBaseFogSampleLabel}
                  </UiText>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {BASE_FOG_SAMPLE_PRESETS.map((samplePreset) => (
                  <button
                    key={samplePreset.labelKey}
                    type="button"
                    data-testid={
                      samplePreset.labelKey === 'modals.negativeConversion.sampleLeftEdge'
                        ? 'negative-lab-sample-left-edge'
                        : 'negative-lab-sample-center-patch'
                    }
                    onClick={() => {
                      void handleSampleBaseFog(samplePreset.labelKey, samplePreset.rect);
                    }}
                    disabled={!selectedImagePath || isEstimatingBaseFog || isSaving}
                    className="rounded-md border border-surface bg-bg-secondary px-2 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t(samplePreset.labelKey)}
                  </button>
                ))}
              </div>
            </div>
            {baseFogConfidence !== null && (
              <UiText data-testid="negative-lab-confidence" variant={TextVariants.small} className="text-text-tertiary">
                {t('modals.negativeConversion.baseFogConfidence', {
                  confidence: Math.round(baseFogConfidence * 100),
                })}
              </UiText>
            )}
            <Slider
              label={t('modals.negativeConversion.redWeight')}
              value={params.red_weight}
              min={0.5}
              max={2.0}
              step={0.01}
              defaultValue={1}
              onChange={(e) => {
                handleParamChange('red_weight', Number(e.target.value));
              }}
              fillOrigin="min"
            />
            <Slider
              label={t('modals.negativeConversion.greenWeight')}
              value={params.green_weight}
              min={0.5}
              max={2.0}
              step={0.01}
              defaultValue={1}
              onChange={(e) => {
                handleParamChange('green_weight', Number(e.target.value));
              }}
              fillOrigin="min"
            />
            <Slider
              label={t('modals.negativeConversion.blueWeight')}
              value={params.blue_weight}
              min={0.5}
              max={2.0}
              step={0.01}
              defaultValue={1}
              onChange={(e) => {
                handleParamChange('blue_weight', Number(e.target.value));
              }}
              fillOrigin="min"
            />
          </div>
        </div>

        <div className={cx('transition-opacity duration-200', isSaving && 'opacity-50 pointer-events-none grayscale')}>
          <UiText variant={TextVariants.heading} className="mb-2">
            {t('modals.negativeConversion.printGrade')}
          </UiText>
          <div className="space-y-3">
            <Slider
              label={t('modals.negativeConversion.exposure')}
              value={params.exposure}
              min={-2.0}
              max={2.0}
              step={0.05}
              defaultValue={0}
              onChange={(e) => {
                handleParamChange('exposure', Number(e.target.value));
              }}
            />
            <Slider
              label={t('modals.negativeConversion.contrast')}
              value={params.contrast}
              min={0.5}
              max={2.5}
              step={0.05}
              defaultValue={1}
              onChange={(e) => {
                handleParamChange('contrast', Number(e.target.value));
              }}
              fillOrigin="min"
            />
          </div>
        </div>

        <div className={cx('transition-opacity duration-200', isSaving && 'opacity-50 pointer-events-none grayscale')}>
          <UiText variant={TextVariants.heading} className="mb-2">
            {t('modals.negativeConversion.exportOptions')}
          </UiText>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {(['tiff16', 'jpeg_proof'] satisfies Array<NegativeOutputFormat>).map((format) => (
                <button
                  key={format}
                  type="button"
                  data-testid={format === 'tiff16' ? 'negative-lab-export-tiff16' : 'negative-lab-export-jpeg-proof'}
                  aria-pressed={saveOptions.outputFormat === format}
                  onClick={() => {
                    setSaveOptions((current) => ({ ...current, outputFormat: format }));
                  }}
                  className={cx(
                    'rounded-md border px-3 py-2 text-sm transition-colors',
                    saveOptions.outputFormat === format
                      ? 'border-accent bg-accent/10 text-text-primary'
                      : 'border-surface bg-bg-primary text-text-secondary hover:bg-surface',
                  )}
                >
                  {t(`modals.negativeConversion.outputFormats.${format}`)}
                </button>
              ))}
            </div>
            <label className="block">
              <UiText as="span" variant={TextVariants.small} className="mb-1 block text-text-secondary">
                {t('modals.negativeConversion.outputSuffix')}
              </UiText>
              <input
                className="w-full rounded-md border border-surface bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
                maxLength={40}
                onChange={(event) => {
                  setSaveOptions((current) => ({ ...current, suffix: event.target.value }));
                }}
                value={saveOptions.suffix}
              />
            </label>
          </div>
        </div>

        <div className="mt-auto pt-4 space-y-2">
          <UiText
            as="div"
            variant={TextVariants.small}
            className="p-3 bg-surface rounded-md border border-surface flex items-center gap-3"
          >
            <Info size={16} className="shrink-0" />
            <div className="text-xs text-text-tertiary leading-tight space-y-1">
              <Trans i18nKey="modals.negativeConversion.noticeText">
                Inversion logic inspired by{' '}
                <a
                  href="https://github.com/marcinz606/NegPy"
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-primary transition-colors"
                >
                  NegPy
                </a>{' '}
                created by marcinz606 (
                <a
                  href="https://github.com/marcinz606/NegPy/blob/main/LICENSE"
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-primary transition-colors"
                >
                  GPL-3.0
                </a>
                ).
              </Trans>
            </div>
          </UiText>
        </div>
      </div>
    </div>
  );

  const renderWorkflowRail = () => (
    <div className="absolute top-4 left-4 right-4 z-20 pointer-events-none">
      <div
        className="pointer-events-auto grid grid-cols-5 gap-2 rounded-md border border-white/10 bg-black/65 p-2 shadow-xl backdrop-blur-md"
        data-testid="negative-lab-workflow-rail"
      >
        {workflowStages.map((stage) => {
          return (
            <div key={stage.id} className="min-w-0 rounded-sm bg-white/5 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2 text-white">
                <span className={cx('shrink-0', stage.isComplete ? 'text-accent' : 'text-white/35')} aria-hidden="true">
                  <span
                    className={cx(
                      'block size-3 rounded-full border',
                      stage.isComplete ? 'border-accent bg-accent' : 'border-white/35',
                    )}
                  />
                </span>
                <span className="truncate text-xs font-semibold">{stage.label}</span>
              </div>
              <div className="mt-1 truncate text-[11px] leading-tight text-white/60">{stage.detail}</div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderBaseFogSampleOverlay = () => {
    if (params.base_fog_sample === null) return null;

    const sampleRect = params.base_fog_sample;

    return (
      <div
        aria-label={t('modals.negativeConversion.sampleOverlayLabel')}
        className="absolute border-2 border-accent bg-accent/15 shadow-[0_0_0_1px_rgba(0,0,0,0.8)]"
        data-testid="negative-lab-base-sample-overlay"
        style={{
          height: `${sampleRect.height * 100}%`,
          left: `${sampleRect.x * 100}%`,
          top: `${sampleRect.y * 100}%`,
          width: `${sampleRect.width * 100}%`,
        }}
      >
        <span className="absolute left-0 top-0 -translate-y-full rounded-sm bg-accent px-1.5 py-0.5 text-[10px] font-medium text-button-text shadow">
          {activeBaseFogSampleLabel ?? t('modals.negativeConversion.baseFogSample')}
        </span>
      </div>
    );
  };

  const renderContent = () => (
    <div className="modal-preview-adjustments flex flex-row h-full w-full overflow-hidden">
      <div className="modal-preview-pane grow flex flex-col relative min-h-0 bg-[#0f0f0f] overflow-hidden">
        {renderWorkflowRail()}
        <div
          ref={containerRef}
          className="flex-1 relative overflow-hidden cursor-grab active:cursor-grabbing select-none"
          role="presentation"
          onMouseDown={handleMouseDown}
          onWheel={handleWheel}
        >
          <div
            className="absolute inset-0 opacity-20 pointer-events-none"
            style={{ backgroundImage: 'radial-gradient(#444 1px, transparent 1px)', backgroundSize: '24px 24px' }}
          ></div>

          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-30">
              <Loader2 className="w-12 h-12 text-accent animate-spin" />
            </div>
          )}

          {(previewUrl || originalUrl) && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="origin-center" style={imageTransformStyle}>
                <div className="relative inline-block shadow-2xl">
                  <img
                    src={isCompareActive && originalUrl ? originalUrl : previewUrl || ''}
                    className="block object-contain"
                    style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto' }}
                    alt={t('modals.negativeConversion.previewAlt')}
                    draggable={false}
                  />
                  {renderBaseFogSampleOverlay()}
                  {isCompareActive && (
                    <UiText
                      as="div"
                      variant={TextVariants.small}
                      color={TextColors.button}
                      className="absolute top-4 left-4 bg-accent px-2 py-1 rounded-sm shadow-lg z-20"
                    >
                      {t('modals.negativeConversion.originalLabel')}
                    </UiText>
                  )}
                </div>
              </div>
            </div>
          )}

          <div
            className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-black/70 backdrop-blur-md p-1.5 rounded-full border border-white/10 shadow-xl z-20 pointer-events-auto"
            role="presentation"
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
          >
            <button
              onClick={() => {
                setZoom((z) => Math.max(0.1, z - 0.25));
              }}
              className="p-2 text-white/60 hover:bg-white/10 hover:text-white rounded-full transition-colors"
              data-tooltip={t('modals.negativeConversion.zoomOutTooltip')}
            >
              <ZoomOut size={18} />
            </button>
            <span className="text-xs font-mono text-white/90 w-12 text-center select-none pointer-events-none">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => {
                setZoom((z) => Math.min(8, z + 0.25));
              }}
              className="p-2 text-white/60 hover:bg-white/10 hover:text-white rounded-full transition-colors"
              data-tooltip={t('modals.negativeConversion.zoomInTooltip')}
            >
              <ZoomIn size={18} />
            </button>
            <button
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
              className="p-2 text-white/60 hover:bg-white/10 hover:text-white rounded-full transition-colors"
              data-tooltip={t('modals.negativeConversion.resetViewTooltip')}
            >
              <Maximize size={16} />
            </button>
            <div className="w-px h-5 bg-white/20 mx-1"></div>
            <button
              onMouseDown={() => {
                setIsCompareActive(true);
              }}
              onMouseUp={() => {
                setIsCompareActive(false);
              }}
              onMouseLeave={() => {
                setIsCompareActive(false);
              }}
              className={cx(
                'p-2 rounded-full transition-colors select-none',
                isCompareActive ? 'bg-accent text-button-text' : 'text-white/60 hover:bg-white/10 hover:text-white',
              )}
              data-tooltip={t('modals.negativeConversion.compareTooltip')}
            >
              {isCompareActive ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>
          </div>
        </div>
      </div>
      {renderControls()}
    </div>
  );

  if (!isMounted) return null;

  return (
    <div
      className={cx(
        'fixed inset-0 z-100 flex items-center justify-center bg-black/50 backdrop-blur-xs transition-opacity duration-300',
        show ? 'opacity-100' : 'opacity-0',
      )}
      role="presentation"
      onMouseDown={onClose}
    >
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="bg-surface rounded-lg shadow-xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden"
            data-testid="negative-lab-workspace"
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
          >
            <div className="grow min-h-0 overflow-hidden">{renderContent()}</div>

            <div className="shrink-0 p-4 flex justify-end gap-3 border-t border-surface bg-bg-secondary z-20">
              <button
                disabled={isSaving}
                onClick={onClose}
                className="px-4 py-2 rounded-md text-text-secondary hover:bg-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('modals.negativeConversion.cancel')}
              </button>
              <Button
                onClick={() => {
                  void handleSave();
                }}
                disabled={isSaving || isLoading || !previewUrl || pathsToConvert.length === 0}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="animate-spin mr-2" size={16} />
                    {progress && progress.total > 1
                      ? t('modals.negativeConversion.convertingProgress', {
                          current: progress.current,
                          total: progress.total,
                        })
                      : t('modals.negativeConversion.converting')}
                  </>
                ) : (
                  <>
                    <Save className="mr-2" size={16} />
                    {hasMultipleScans && conversionScope === 'all'
                      ? t('modals.negativeConversion.convertAndSaveAll', { count: targetPaths.length })
                      : hasMultipleScans
                        ? t('modals.negativeConversion.convertAndSaveActive')
                        : t('modals.negativeConversion.convertAndSave')}
                  </>
                )}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
