import { invoke } from '@tauri-apps/api/core';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle, XCircle, Loader2, Users, Trash2, Star, Tag, Move, Link2, Unlink } from 'lucide-react';
import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useModalTransition } from '../../hooks/useModalTransition';
import { TextColors, TextVariants } from '../../types/typography';
import {
  type CullingSettings,
  type CullingSuggestions,
  type ImageAnalysisResult,
  Invokes,
  type Progress,
} from '../ui/AppProperties';
import Button from '../ui/Button';
import Dropdown from '../ui/Dropdown';
import Slider from '../ui/Slider';
import Switch from '../ui/Switch';
import UiText from '../ui/Text';

interface CullingModalProps {
  isOpen: boolean;
  onClose: () => void;
  progress: Progress | null;
  suggestions: CullingSuggestions | null;
  error: string | null;
  imagePaths: string[];
  thumbnails: Record<string, string>;
  onApply: (action: 'reject' | 'rate_zero' | 'delete', paths: string[]) => void;
  onError: (error: string) => void;
}

type CullAction = 'reject' | 'rate_zero' | 'delete';
type CullingStage = 'settings' | 'progress' | 'results';
type CullingResultsTab = 'similar' | 'blurry' | 'focus';
type FocusConfidenceBand = 'high' | 'medium' | 'low';

const RAW_SOURCE_EXTENSIONS = new Set(['arw', 'cr2', 'cr3', 'dng', 'nef', 'orf', 'pef', 'raf', 'rw2', 'srw']);
const SETUP_PREVIEW_LIMIT = 6;
const COMPARE_PAN_STEP = 10;
const COMPARE_ZOOM_STEPS = [50, 100, 200] as const;

interface CompareViewport {
  linked: boolean;
  panX: number;
  panY: number;
  zoomPercent: number;
}

function getFocusConfidenceBand(confidence: number): FocusConfidenceBand {
  if (confidence >= 0.7) return 'high';
  if (confidence >= 0.4) return 'medium';
  return 'low';
}

function getFocusConfidenceBandClass(band: FocusConfidenceBand): string {
  switch (band) {
    case 'high':
      return 'border-green-500/40 bg-green-500/15 text-green-300';
    case 'medium':
      return 'border-yellow-500/40 bg-yellow-500/15 text-yellow-200';
    case 'low':
      return 'border-red-500/40 bg-red-500/15 text-red-300';
  }
}

function getEyeFaceBalancePercent(analysis: ImageAnalysisResult): number {
  if (analysis.faceSharpnessMetric <= 0) return 100;
  return Math.round((analysis.eyeSharpnessMetric / analysis.faceSharpnessMetric) * 100);
}

function needsEyeSharpnessReview(analysis: ImageAnalysisResult): boolean {
  return analysis.focusConfidence >= 0.4 && getEyeFaceBalancePercent(analysis) < 75;
}

interface ImageThumbnailProps {
  children?: ReactNode;
  isSelected: boolean;
  onToggle?: () => void;
  path: string;
  thumbnails: Record<string, string>;
}

function ImageThumbnail({ path, thumbnails, isSelected, onToggle, children }: ImageThumbnailProps) {
  const thumbnailUrl = thumbnails[path];
  const interactiveClasses = onToggle ? 'cursor-pointer hover:border-surface' : 'cursor-default';
  const content = (
    <div
      className={`relative group rounded-md overflow-hidden border-2 transition-colors text-left ${
        isSelected ? 'border-accent' : `border-transparent ${interactiveClasses}`
      }`}
    >
      <img
        src={thumbnailUrl}
        alt={path}
        className={`w-full h-full object-cover transition-opacity ${
          isSelected || !onToggle ? 'opacity-100' : 'opacity-75 group-hover:opacity-100'
        }`}
      />
      {onToggle && (
        <div
          className={`absolute inset-0 bg-black/50 transition-opacity ${
            isSelected ? 'opacity-0' : 'opacity-100 group-hover:opacity-0'
          }`}
        />
      )}
      <div className="absolute top-2 right-2">{isSelected && <CheckCircle size={16} className="text-accent" />}</div>
      {children && (
        <UiText
          as="div"
          variant={TextVariants.small}
          color={TextColors.white}
          className="absolute bottom-0 left-0 right-0 p-1 bg-black/60"
        >
          {children}
        </UiText>
      )}
    </div>
  );

  if (!onToggle) {
    return <div className="block w-full">{content}</div>;
  }

  return (
    <button type="button" className="block w-full text-left" onClick={onToggle}>
      {content}
    </button>
  );
}

function getFileExtension(path: string): string {
  const fileName = path.split(/[\\/]/).pop() ?? '';
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex > -1 ? fileName.slice(dotIndex + 1).toLowerCase() : '';
}

function clampPan(value: number): number {
  return Math.max(-100, Math.min(100, value));
}

function getCompareViewportStyle(viewport: CompareViewport): CSSProperties {
  return {
    transform: `translate(${viewport.panX}%, ${viewport.panY}%) scale(${viewport.zoomPercent / 100})`,
    transformOrigin: 'center',
  };
}

interface CompareFrameProps {
  analysis: ImageAnalysisResult;
  isReference?: boolean;
  isSelected?: boolean;
  metadataLabels: {
    dimensions: (width: number, height: number) => string;
    focus: string;
    focusConfidence: string;
    focusScore: string;
    score: string;
    sharpness: string;
  };
  onToggle?: () => void;
  thumbnails: Record<string, string>;
  viewport: CompareViewport;
}

function CompareFrame({
  analysis,
  isReference = false,
  isSelected = false,
  metadataLabels,
  onToggle,
  thumbnails,
  viewport,
}: CompareFrameProps) {
  const thumbnailUrl = thumbnails[analysis.path];
  const frame = (
    <div
      className={`relative aspect-[4/3] overflow-hidden rounded-md border-2 bg-bg-secondary ${
        isReference ? 'border-green-500' : isSelected ? 'border-accent' : 'border-transparent hover:border-surface'
      }`}
      data-center-focus={analysis.centerFocusMetric.toFixed(2)}
      data-height={analysis.height}
      data-path={analysis.path}
      data-quality-score={analysis.qualityScore.toFixed(2)}
      data-sharpness={analysis.sharpnessMetric.toFixed(2)}
      data-viewport-linked={String(viewport.linked)}
      data-viewport-pan-x={viewport.panX}
      data-viewport-pan-y={viewport.panY}
      data-viewport-zoom={viewport.zoomPercent}
      data-width={analysis.width}
    >
      <img
        src={thumbnailUrl}
        alt={analysis.path}
        className="h-full w-full object-cover transition-transform duration-150"
        style={getCompareViewportStyle(viewport)}
      />
      {!isReference && (
        <div className="absolute top-2 right-2">{isSelected && <CheckCircle size={16} className="text-accent" />}</div>
      )}
      <UiText
        as="div"
        variant={TextVariants.small}
        color={TextColors.white}
        className="absolute bottom-0 left-0 right-0 grid grid-cols-2 gap-x-2 bg-black/65 p-1"
      >
        <span>{metadataLabels.dimensions(analysis.width, analysis.height)}</span>
        <span>
          {metadataLabels.focus}: {analysis.centerFocusMetric.toFixed(0)}
        </span>
        <span>
          {metadataLabels.focusScore}: {(analysis.focusScore * 100).toFixed(0)}
        </span>
        <span>
          {metadataLabels.focusConfidence}: {(analysis.focusConfidence * 100).toFixed(0)}%
        </span>
        <span>
          {metadataLabels.sharpness}: {analysis.sharpnessMetric.toFixed(0)}
        </span>
        <span>
          {metadataLabels.score}: {analysis.qualityScore.toFixed(2)}
        </span>
      </UiText>
    </div>
  );

  if (onToggle === undefined) {
    return frame;
  }

  return (
    <button type="button" className="block w-full text-left" onClick={onToggle}>
      {frame}
    </button>
  );
}

export default function CullingModal({
  isOpen,
  onClose,
  progress,
  suggestions,
  error,
  imagePaths,
  thumbnails,
  onApply,
  onError,
}: CullingModalProps) {
  const { t } = useTranslation();
  const { isMounted, show } = useModalTransition(isOpen);

  const [settings, setSettings] = useState<CullingSettings>({
    groupSimilar: true,
    similarityThreshold: 28,
    filterBlurry: true,
    blurThreshold: 100.0,
    rankFocus: true,
  });

  const [selectedRejects, setSelectedRejects] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<CullAction>('reject');
  const [activeTab, setActiveTab] = useState<CullingResultsTab>('similar');
  const [compareViewport, setCompareViewport] = useState<CompareViewport>({
    linked: true,
    panX: 0,
    panY: 0,
    zoomPercent: 100,
  });

  const CULL_ACTIONS = useMemo(
    () => [
      {
        value: 'reject' as const,
        label: t('modals.culling.actionReject'),
        icon: <Tag size={16} className="text-red-500" />,
      },
      { value: 'rate_zero' as const, label: t('modals.culling.actionRateZero'), icon: <Star size={16} /> },
      { value: 'delete' as const, label: t('modals.culling.actionDelete'), icon: <Trash2 size={16} /> },
    ],
    [t],
  );
  const stage = useMemo<CullingStage>(() => {
    if (suggestions || error) return 'results';
    if (progress) return 'progress';
    return 'settings';
  }, [error, progress, suggestions]);

  const sourceMix = useMemo(
    () =>
      imagePaths.reduce(
        (counts, path) => {
          if (RAW_SOURCE_EXTENSIONS.has(getFileExtension(path))) {
            return { ...counts, raw: counts.raw + 1 };
          }
          return { ...counts, raster: counts.raster + 1 };
        },
        { raster: 0, raw: 0 },
      ),
    [imagePaths],
  );

  useEffect(() => {
    if (isOpen) return;

    const resetTimer = setTimeout(() => {
      setSelectedRejects(new Set());
    }, 300);

    return () => {
      clearTimeout(resetTimer);
    };
  }, [isOpen]);

  useEffect(() => {
    if (stage === 'results' && suggestions) {
      const syncTimer = setTimeout(() => {
        const initialRejects = new Set<string>();
        suggestions.similarGroups.forEach((group) => {
          group.duplicates.forEach((dup) => initialRejects.add(dup.path));
        });
        suggestions.blurryImages.forEach((img) => initialRejects.add(img.path));
        setSelectedRejects(initialRejects);
      }, 0);

      return () => {
        clearTimeout(syncTimer);
      };
    }
    return undefined;
  }, [stage, suggestions]);

  const handleStartCulling = useCallback(async () => {
    try {
      await invoke(Invokes.CullImages, { paths: imagePaths, settings });
    } catch (err) {
      console.error('Culling failed to start:', err);
      onError(String(err));
    }
  }, [imagePaths, settings, onError]);

  const handleToggleReject = (path: string) => {
    setSelectedRejects((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  };

  const handleApply = () => {
    onApply(action, Array.from(selectedRejects));
  };

  const numSimilar = suggestions?.similarGroups.reduce((acc, group) => acc + group.duplicates.length, 0) || 0;
  const numBlurry = suggestions?.blurryImages.length || 0;
  const numFocusRankings = suggestions?.focusRankings.length || 0;
  const setupPreviewPaths = imagePaths.slice(0, SETUP_PREVIEW_LIMIT);
  const setupPreviewOverflowCount = Math.max(0, imagePaths.length - setupPreviewPaths.length);
  const hasCullingAnalysisMode = settings.groupSimilar || settings.filterBlurry || settings.rankFocus;
  const cullingAnalysisModeCount =
    Number(settings.groupSimilar) + Number(settings.filterBlurry) + Number(settings.rankFocus);
  const canStartCulling = imagePaths.length > 0 && hasCullingAnalysisMode;
  const fallbackResultsTab: CullingResultsTab =
    numSimilar > 0 ? 'similar' : numBlurry > 0 ? 'blurry' : numFocusRankings > 0 ? 'focus' : activeTab;
  const activeResultsTab =
    (activeTab === 'similar' && numSimilar > 0) ||
    (activeTab === 'blurry' && numBlurry > 0) ||
    (activeTab === 'focus' && numFocusRankings > 0)
      ? activeTab
      : fallbackResultsTab;

  const compareMetadataLabels = useMemo(
    () => ({
      dimensions: (width: number, height: number) => t('modals.culling.compareDimensions', { height, width }),
      focus: t('modals.culling.compareFocus'),
      focusConfidence: t('modals.culling.focusConfidence'),
      focusScore: t('modals.culling.focusScore'),
      score: t('modals.culling.compareScore'),
      sharpness: t('modals.culling.compareSharpness'),
    }),
    [t],
  );

  const setCompareZoom = useCallback((zoomPercent: number) => {
    setCompareViewport((viewport) => ({ ...viewport, zoomPercent }));
  }, []);

  const nudgeCompareViewport = useCallback((panXDelta: number, panYDelta: number) => {
    setCompareViewport((viewport) => ({
      ...viewport,
      panX: clampPan(viewport.panX + panXDelta),
      panY: clampPan(viewport.panY + panYDelta),
    }));
  }, []);

  const resetCompareViewport = useCallback(() => {
    setCompareViewport((viewport) => ({ ...viewport, panX: 0, panY: 0, zoomPercent: 100 }));
  }, []);

  const toggleLinkedCompareViewport = useCallback(() => {
    setCompareViewport((viewport) => ({ ...viewport, linked: !viewport.linked }));
  }, []);

  const getFocusRegionLabel = useCallback(
    (region: string) => {
      if (region === 'center_fallback') {
        return t('modals.culling.focusRegion.center_fallback');
      }
      if (region === 'eye_band_heuristic') {
        return t('modals.culling.focusRegion.eye_band_heuristic');
      }
      return t('modals.culling.focusRegion.unknown');
    },
    [t],
  );

  const renderSettings = () => (
    <>
      <div className="flex items-center justify-center mb-4">
        <Users className="w-12 h-12 text-accent" />
      </div>
      <UiText variant={TextVariants.title} className="mb-6 text-center">
        {t('modals.culling.title')}
      </UiText>
      <section
        className="mb-6 grid grid-cols-2 gap-2 rounded-md border border-border-color bg-bg-primary p-3 text-xs"
        data-blur-filter-enabled={String(settings.filterBlurry)}
        data-blur-threshold={settings.blurThreshold}
        data-culling-analysis-mode-count={cullingAnalysisModeCount}
        data-focus-ranking-enabled={String(settings.rankFocus)}
        data-group-similar-enabled={String(settings.groupSimilar)}
        data-image-count={imagePaths.length}
        data-raster-source-count={sourceMix.raster}
        data-raw-source-count={sourceMix.raw}
        data-similarity-threshold={settings.similarityThreshold}
        data-testid="culling-setup-summary"
      >
        {[
          {
            label: t('modals.culling.summarySources'),
            value: t('modals.culling.summarySourceCount', { count: imagePaths.length }),
          },
          {
            label: t('modals.culling.summarySourceMix'),
            value: t('modals.culling.summarySourceMixValue', { raster: sourceMix.raster, raw: sourceMix.raw }),
          },
          {
            label: t('modals.culling.summaryAnalysisModes'),
            value: t('modals.culling.summaryAnalysisModeCount', { count: cullingAnalysisModeCount }),
          },
          {
            label: t('modals.culling.summarySimilar'),
            value: settings.groupSimilar
              ? t('modals.culling.summaryEnabledThreshold', { threshold: settings.similarityThreshold })
              : t('modals.culling.summaryDisabled'),
          },
          {
            label: t('modals.culling.summaryBlur'),
            value: settings.filterBlurry
              ? t('modals.culling.summaryEnabledThreshold', { threshold: settings.blurThreshold })
              : t('modals.culling.summaryDisabled'),
          },
          {
            label: t('modals.culling.summaryFocusRanking'),
            value: settings.rankFocus ? t('modals.culling.summaryEnabled') : t('modals.culling.summaryDisabled'),
          },
          {
            label: t('modals.culling.summaryWorkload'),
            value: t('modals.culling.summaryWorkloadValue', { count: imagePaths.length }),
          },
        ].map((item) => (
          <div className="rounded border border-border-color bg-bg-secondary px-2 py-1.5" key={item.label}>
            <UiText as="span" variant={TextVariants.small} className="block text-text-tertiary">
              {item.label}
            </UiText>
            <UiText as="span" variant={TextVariants.small} className="block truncate text-text-primary">
              {item.value}
            </UiText>
          </div>
        ))}
      </section>
      {setupPreviewPaths.length > 0 && (
        <section
          className="mb-6 rounded-md border border-border-color bg-bg-primary p-3"
          data-preview-count={setupPreviewPaths.length}
          data-preview-overflow-count={setupPreviewOverflowCount}
          data-testid="culling-setup-batch-preview"
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <UiText variant={TextVariants.label}>{t('modals.culling.batchPreview')}</UiText>
            {setupPreviewOverflowCount > 0 && (
              <UiText variant={TextVariants.small} color={TextColors.secondary}>
                {t('modals.culling.batchPreviewMore', { count: setupPreviewOverflowCount })}
              </UiText>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {setupPreviewPaths.map((path) => (
              <div
                className="aspect-square overflow-hidden rounded border border-border-color bg-bg-secondary"
                key={path}
              >
                {thumbnails[path] ? (
                  <img
                    src={thumbnails[path]}
                    alt={t('modals.culling.batchPreviewAlt')}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center px-2 text-center">
                    <UiText variant={TextVariants.small} color={TextColors.secondary} className="truncate">
                      {path.split(/[\\/]/).pop()}
                    </UiText>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      {imagePaths.length === 0 && (
        <div
          className="mb-6 rounded-md border border-border-color bg-bg-primary p-3 text-center"
          data-testid="culling-empty-batch-guard"
        >
          <UiText variant={TextVariants.small} color={TextColors.secondary}>
            {t('modals.culling.emptyBatch')}
          </UiText>
        </div>
      )}
      {imagePaths.length > 0 && !hasCullingAnalysisMode && (
        <div
          className="mb-6 rounded-md border border-border-color bg-bg-primary p-3 text-center"
          data-testid="culling-empty-analysis-mode-guard"
        >
          <UiText variant={TextVariants.small} color={TextColors.secondary}>
            {t('modals.culling.emptyAnalysisModes')}
          </UiText>
        </div>
      )}
      <div className="space-y-6 text-sm">
        <div>
          <Switch
            label={t('modals.culling.groupSimilar')}
            checked={settings.groupSimilar}
            onChange={(v) => {
              setSettings((s) => ({ ...s, groupSimilar: v }));
            }}
          />
          {settings.groupSimilar && (
            <div className="mt-2 pl-4 border-l-2 border-border-color ml-1">
              <Slider
                label={t('modals.culling.similarityThreshold')}
                min={1}
                max={64}
                step={1}
                value={settings.similarityThreshold}
                defaultValue={28}
                onChange={(e) => {
                  setSettings((s) => ({ ...s, similarityThreshold: Number(e.target.value) }));
                }}
                fillOrigin="min"
              />
              <UiText variant={TextVariants.small} className="mt-1">
                {t('modals.culling.similarityThresholdDesc')}
              </UiText>
            </div>
          )}
        </div>
        <div>
          <Switch
            label={t('modals.culling.filterBlurry')}
            checked={settings.filterBlurry}
            onChange={(v) => {
              setSettings((s) => ({ ...s, filterBlurry: v }));
            }}
          />
          {settings.filterBlurry && (
            <div className="mt-2  pl-4 border-l-2 border-border-color ml-1">
              <Slider
                label={t('modals.culling.blurThreshold')}
                min={25}
                max={500}
                step={25}
                value={settings.blurThreshold}
                defaultValue={100.0}
                onChange={(e) => {
                  setSettings((s) => ({ ...s, blurThreshold: Number(e.target.value) }));
                }}
                fillOrigin="min"
              />
              <UiText variant={TextVariants.small} className="mt-1">
                {t('modals.culling.blurThresholdDesc')}
              </UiText>
            </div>
          )}
        </div>
        <div>
          <Switch
            label={t('modals.culling.rankFocus')}
            checked={settings.rankFocus}
            onChange={(v) => {
              setSettings((s) => ({ ...s, rankFocus: v }));
            }}
          />
          {settings.rankFocus && (
            <UiText variant={TextVariants.small} className="mt-1 block pl-4">
              {t('modals.culling.rankFocusDesc')}
            </UiText>
          )}
        </div>
      </div>
      <div className="flex justify-end gap-3 mt-8">
        <button
          className="px-4 py-2 rounded-md text-text-secondary hover:bg-surface transition-colors"
          onClick={onClose}
        >
          {t('modals.culling.cancel')}
        </button>
        <Button
          disabled={!canStartCulling}
          onClick={() => {
            void handleStartCulling();
          }}
        >
          {t('modals.culling.startCulling')}
        </Button>
      </div>
    </>
  );

  const renderProgress = () => (
    <div className="flex flex-col items-center justify-center h-48">
      <Loader2 className="w-16 h-16 text-accent animate-spin" />
      <p className="mt-4 text-text-primary">{progress?.stage || t('modals.culling.starting')}</p>
      {progress && progress.total > 0 && (
        <>
          <UiText
            variant={TextVariants.small}
            color={TextColors.secondary}
            className="mt-2"
            data-testid="culling-progress-count"
          >
            {t('modals.culling.progressCount', { current: progress.current, total: progress.total })}
          </UiText>
          <div className="w-full bg-surface rounded-full h-2.5 mt-2">
            <div
              className="bg-accent h-2.5 rounded-full"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
        </>
      )}
    </div>
  );

  const renderResults = () => {
    if (error) {
      return (
        <div className="flex flex-col items-center justify-center h-48">
          <XCircle className="w-16 h-16 text-red-500" />
          <UiText variant={TextVariants.heading} className="mt-4 text-center">
            {t('modals.culling.cullingFailed')}
          </UiText>
          <UiText>{error}</UiText>
          <div className="mt-6">
            <Button onClick={onClose}>{t('modals.culling.close')}</Button>
          </div>
        </div>
      );
    }

    if (!suggestions) return null;

    const totalSuggestions = numSimilar + numBlurry + numFocusRankings;
    if (totalSuggestions === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-48">
          <CheckCircle className="w-16 h-16 text-green-500" />
          <UiText variant={TextVariants.heading} className="mt-4">
            {t('modals.culling.noIssuesFound')}
          </UiText>
          <UiText>{t('modals.culling.noIssuesDesc')}</UiText>
          <div className="mt-6">
            <Button onClick={onClose}>{t('modals.culling.done')}</Button>
          </div>
        </div>
      );
    }

    return (
      <>
        <UiText variant={TextVariants.title} className="mb-4">
          {t('modals.culling.cullingSuggestions')}
        </UiText>
        <div className="border-b border-surface mb-4">
          <nav className="-mb-px flex space-x-4" aria-label={t('modals.culling.tabs')}>
            {numSimilar > 0 && (
              <button
                onClick={() => {
                  setActiveTab('similar');
                }}
                className={`${
                  activeResultsTab === 'similar'
                    ? 'border-accent text-accent'
                    : 'border-transparent text-text-secondary hover:text-text-primary hover:border-gray-300'
                } whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm`}
              >
                {t('modals.culling.similarGroupsTab')}{' '}
                <span className="bg-surface text-text-secondary rounded-full px-2 py-0.5 text-xs">{numSimilar}</span>
              </button>
            )}
            {numBlurry > 0 && (
              <button
                onClick={() => {
                  setActiveTab('blurry');
                }}
                className={`${
                  activeResultsTab === 'blurry'
                    ? 'border-accent text-accent'
                    : 'border-transparent text-text-secondary hover:text-text-primary hover:border-gray-300'
                } whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm`}
              >
                {t('modals.culling.blurryImagesTab')}{' '}
                <span className="bg-surface text-text-secondary rounded-full px-2 py-0.5 text-xs">{numBlurry}</span>
              </button>
            )}
            {numFocusRankings > 0 && (
              <button
                onClick={() => {
                  setActiveTab('focus');
                }}
                className={`${
                  activeResultsTab === 'focus'
                    ? 'border-accent text-accent'
                    : 'border-transparent text-text-secondary hover:text-text-primary hover:border-gray-300'
                } whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm`}
              >
                {t('modals.culling.focusRankingsTab')}{' '}
                <span className="bg-surface text-text-secondary rounded-full px-2 py-0.5 text-xs">
                  {numFocusRankings}
                </span>
              </button>
            )}
          </nav>
        </div>

        <div className="bg-bg-primary rounded-lg p-2 h-[50vh] overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeResultsTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {activeResultsTab === 'similar' && (
                <div className="space-y-4">
                  <section
                    className="rounded-md border border-border-color bg-bg-secondary p-3"
                    data-pan-x={compareViewport.panX}
                    data-pan-y={compareViewport.panY}
                    data-testid="culling-compare-sync-controls"
                    data-viewport-linked={String(compareViewport.linked)}
                    data-zoom-percent={compareViewport.zoomPercent}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Move size={16} className="text-accent" />
                        <UiText variant={TextVariants.label}>{t('modals.culling.compareViewport')}</UiText>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          aria-pressed={compareViewport.linked}
                          className="inline-flex items-center gap-1 rounded border border-border-color px-2 py-1 text-xs text-text-primary hover:bg-surface"
                          data-testid="culling-compare-link-toggle"
                          onClick={toggleLinkedCompareViewport}
                        >
                          {compareViewport.linked ? <Link2 size={14} /> : <Unlink size={14} />}
                          {compareViewport.linked
                            ? t('modals.culling.compareLinked')
                            : t('modals.culling.compareUnlinked')}
                        </button>
                        {COMPARE_ZOOM_STEPS.map((zoomPercent) => (
                          <button
                            type="button"
                            aria-pressed={compareViewport.zoomPercent === zoomPercent}
                            className={`rounded border px-2 py-1 text-xs ${
                              compareViewport.zoomPercent === zoomPercent
                                ? 'border-accent text-accent'
                                : 'border-border-color text-text-primary hover:bg-surface'
                            }`}
                            data-testid={`culling-compare-zoom-${zoomPercent}`}
                            key={zoomPercent}
                            onClick={() => {
                              setCompareZoom(zoomPercent);
                            }}
                          >
                            {zoomPercent}%
                          </button>
                        ))}
                        <button
                          type="button"
                          className="rounded border border-border-color px-2 py-1 text-xs text-text-primary hover:bg-surface"
                          data-testid="culling-compare-reset"
                          onClick={resetCompareViewport}
                        >
                          {t('modals.culling.compareReset')}
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 sm:inline-grid sm:grid-cols-5">
                      <button
                        type="button"
                        className="rounded border border-border-color px-2 py-1 text-xs text-text-primary hover:bg-surface sm:col-start-2"
                        data-testid="culling-compare-pan-up"
                        onClick={() => {
                          nudgeCompareViewport(0, -COMPARE_PAN_STEP);
                        }}
                      >
                        {t('modals.culling.comparePanUp')}
                      </button>
                      <button
                        type="button"
                        className="rounded border border-border-color px-2 py-1 text-xs text-text-primary hover:bg-surface sm:col-start-1 sm:row-start-2"
                        data-testid="culling-compare-pan-left"
                        onClick={() => {
                          nudgeCompareViewport(-COMPARE_PAN_STEP, 0);
                        }}
                      >
                        {t('modals.culling.comparePanLeft')}
                      </button>
                      <UiText
                        variant={TextVariants.small}
                        color={TextColors.secondary}
                        className="flex items-center justify-center rounded border border-border-color px-2 py-1 text-center sm:col-start-2 sm:row-start-2"
                      >
                        {t('modals.culling.comparePanReadout', {
                          x: compareViewport.panX,
                          y: compareViewport.panY,
                        })}
                      </UiText>
                      <button
                        type="button"
                        className="rounded border border-border-color px-2 py-1 text-xs text-text-primary hover:bg-surface sm:col-start-3 sm:row-start-2"
                        data-testid="culling-compare-pan-right"
                        onClick={() => {
                          nudgeCompareViewport(COMPARE_PAN_STEP, 0);
                        }}
                      >
                        {t('modals.culling.comparePanRight')}
                      </button>
                      <button
                        type="button"
                        className="rounded border border-border-color px-2 py-1 text-xs text-text-primary hover:bg-surface sm:col-start-2 sm:row-start-3"
                        data-testid="culling-compare-pan-down"
                        onClick={() => {
                          nudgeCompareViewport(0, COMPARE_PAN_STEP);
                        }}
                      >
                        {t('modals.culling.comparePanDown')}
                      </button>
                    </div>
                  </section>
                  {suggestions.similarGroups.map((group, index) => (
                    <div key={index} className="bg-surface rounded-lg p-3">
                      <UiText variant={TextVariants.heading} className="mb-2">
                        {t('modals.culling.groupHeader', { index: index + 1 })}
                      </UiText>
                      <div className="grid grid-cols-[1fr_3fr] gap-3">
                        <div>
                          <UiText variant={TextVariants.label} className="mb-1">
                            {t('modals.culling.bestImage')}
                          </UiText>
                          <CompareFrame
                            analysis={group.representative}
                            isReference
                            metadataLabels={compareMetadataLabels}
                            thumbnails={thumbnails}
                            viewport={compareViewport}
                          />
                        </div>
                        <div>
                          <UiText variant={TextVariants.label} className="mb-1">
                            {t('modals.culling.duplicatesHeader', { count: group.duplicates.length })}
                          </UiText>
                          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                            {group.duplicates.map((dup) => (
                              <CompareFrame
                                analysis={dup}
                                isSelected={selectedRejects.has(dup.path)}
                                key={dup.path}
                                metadataLabels={compareMetadataLabels}
                                onToggle={() => {
                                  handleToggleReject(dup.path);
                                }}
                                thumbnails={thumbnails}
                                viewport={
                                  compareViewport.linked
                                    ? compareViewport
                                    : { linked: false, panX: 0, panY: 0, zoomPercent: 100 }
                                }
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {activeResultsTab === 'blurry' && (
                <div className="grid grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
                  {suggestions.blurryImages.map((img) => (
                    <ImageThumbnail
                      key={img.path}
                      path={img.path}
                      thumbnails={thumbnails}
                      isSelected={selectedRejects.has(img.path)}
                      onToggle={() => {
                        handleToggleReject(img.path);
                      }}
                    >
                      {t('modals.culling.sharpness', { sharpness: img.sharpnessMetric.toFixed(0) })}
                    </ImageThumbnail>
                  ))}
                </div>
              )}
              {activeResultsTab === 'focus' && (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                  {suggestions.focusRankings.map((img, index) => {
                    const confidenceBand = getFocusConfidenceBand(img.focusConfidence);
                    const eyeFaceBalancePercent = getEyeFaceBalancePercent(img);
                    const showEyeSharpnessReview = needsEyeSharpnessReview(img);
                    return (
                      <div
                        className="rounded-md border border-border-color bg-bg-secondary p-2"
                        data-focus-confidence={img.focusConfidence.toFixed(2)}
                        data-focus-confidence-band={confidenceBand}
                        data-focus-eye-sharpness={img.eyeSharpnessMetric.toFixed(2)}
                        data-focus-eye-face-balance-percent={eyeFaceBalancePercent}
                        data-focus-eye-review={String(showEyeSharpnessReview)}
                        data-focus-face-sharpness={img.faceSharpnessMetric.toFixed(2)}
                        data-focus-rank={index + 1}
                        data-focus-region={img.focusRegion}
                        data-focus-score={img.focusScore.toFixed(2)}
                        data-testid="culling-focus-ranking-card"
                        key={img.path}
                      >
                        <ImageThumbnail path={img.path} thumbnails={thumbnails} isSelected={false}>
                          {t('modals.culling.focusRankValue', { rank: index + 1 })}
                        </ImageThumbnail>
                        <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
                          <UiText variant={TextVariants.small}>
                            {t('modals.culling.focusScoreValue', { score: Math.round(img.focusScore * 100) })}
                          </UiText>
                          <span
                            className={`rounded border px-1.5 py-0.5 text-[11px] ${getFocusConfidenceBandClass(confidenceBand)}`}
                            data-testid="culling-focus-confidence-band"
                          >
                            {confidenceBand === 'high'
                              ? t('modals.culling.focusConfidenceBand.high')
                              : confidenceBand === 'medium'
                                ? t('modals.culling.focusConfidenceBand.medium')
                                : t('modals.culling.focusConfidenceBand.low')}
                          </span>
                          <UiText variant={TextVariants.small}>
                            {t('modals.culling.focusConfidenceValue', {
                              confidence: Math.round(img.focusConfidence * 100),
                            })}
                          </UiText>
                          <UiText variant={TextVariants.small}>
                            {t('modals.culling.eyeSharpnessValue', { sharpness: img.eyeSharpnessMetric.toFixed(0) })}
                          </UiText>
                          <UiText variant={TextVariants.small}>
                            {t('modals.culling.faceSharpnessValue', { sharpness: img.faceSharpnessMetric.toFixed(0) })}
                          </UiText>
                          <UiText variant={TextVariants.small} className="col-span-2">
                            {t('modals.culling.eyeFaceBalanceValue', { balance: eyeFaceBalancePercent })}
                          </UiText>
                          {showEyeSharpnessReview && (
                            <UiText
                              variant={TextVariants.small}
                              className="col-span-2 rounded border border-yellow-500/40 bg-yellow-500/10 px-2 py-1 text-yellow-200"
                              data-testid="culling-focus-eye-sharpness-review"
                            >
                              {t('modals.culling.eyeSharpnessReviewWarning')}
                            </UiText>
                          )}
                          <UiText variant={TextVariants.small} color={TextColors.secondary} className="col-span-2">
                            {getFocusRegionLabel(img.focusRegion)}
                          </UiText>
                          <UiText variant={TextVariants.small} color={TextColors.secondary} className="col-span-2">
                            {t('modals.culling.focusReviewOnlyHint')}
                          </UiText>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex justify-between items-center gap-3 mt-6">
          <div className="flex-1">
            <Dropdown
              options={CULL_ACTIONS.map(({ value, label }) => ({ value, label }))}
              value={action}
              onChange={(newValue: CullAction) => {
                setAction(newValue);
              }}
              className="w-full"
            />
            <UiText
              variant={TextVariants.small}
              color={TextColors.secondary}
              className="mt-2 block"
              data-testid="culling-selected-result-count"
            >
              {t('modals.culling.selectedResultCount', { count: selectedRejects.size })}
            </UiText>
          </div>
          <div className="flex gap-3">
            <button
              className="px-4 py-2 rounded-md text-text-secondary hover:bg-surface transition-colors"
              onClick={onClose}
            >
              {t('modals.culling.cancel')}
            </button>
            <Button onClick={handleApply} disabled={selectedRejects.size === 0}>
              {t('modals.culling.applyButton', { count: selectedRejects.size })}
            </Button>
          </div>
        </div>
      </>
    );
  };

  const renderContent = () => {
    switch (stage) {
      case 'settings':
        return renderSettings();
      case 'progress':
        return renderProgress();
      case 'results':
        return renderResults();
      default:
        return null;
    }
  };

  if (!isMounted) return null;

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center z-50 bg-black/30 backdrop-blur-xs transition-opacity duration-300 ease-in-out ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      role="presentation"
    >
      <div
        aria-modal="true"
        className={`bg-surface rounded-lg shadow-xl p-6 w-full max-w-5xl transform transition-all duration-300 ease-out ${
          show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4'
        }`}
        role="dialog"
      >
        {renderContent()}
      </div>
    </div>
  );
}
