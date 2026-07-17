import cx from 'clsx';
import { Aperture, CircleDashed, Grid3X3, Loader, Plus, SquareDashed, Trash2, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import type {
  EditDocumentGeometryV2,
  EditDocumentNodeParamsV2,
} from '../../../packages/rawengine-schema/src/editDocumentV2';
import {
  type PerspectiveCorrectionMode,
  type PerspectiveCropPolicy,
  perspectiveAnalysisResultSchema,
} from '../../schemas/geometry/perspectiveSchemas';
import { useEditorStore } from '../../store/useEditorStore';
import { Invokes } from '../../tauri/commands';
import { TextVariants } from '../../types/typography';
import { selectEditDocumentGeometry } from '../../utils/editDocumentSelectors';
import {
  buildLensCorrectionEditTransaction,
  buildLensProfileEditTransaction,
  isCurrentLensCorrectionIdentity,
  isCurrentLensProfileRequest,
  type LensCorrectionCommitIdentity,
  type LensProfilePatch,
  type ManualLensCorrectionAdjustment,
} from '../../utils/lensCorrectionEditTransaction';
import { parseExifMetadataNumber } from '../../utils/metadataPanelContracts';
import {
  buildPerspectiveCorrectionEditTransaction,
  capturePerspectiveCorrectionCommitIdentity,
  isCurrentPerspectiveAnalysisRequest,
  type PerspectiveCorrectionCommitIdentity,
} from '../../utils/perspectiveCorrectionEditTransaction';
import { invokeWithSchema } from '../../utils/tauriSchemaInvoke';
import {
  getLensCorrectionAvailability,
  hasSupportedLensCorrections,
  type LensDistortionParams,
} from '../../utils/transformLensControls';
import type { SelectedImage } from '../ui/AppProperties';
import Dropdown, { type OptionItem } from '../ui/primitives/Dropdown';
import Switch from '../ui/primitives/Switch';
import UiText from '../ui/primitives/Text';
import AdjustmentSlider from './AdjustmentSlider';

export type TransformLensAdjustmentView = EditDocumentGeometryV2 & EditDocumentNodeParamsV2<'lens_correction'>;
export type TransformLensAdjustmentUpdate =
  | Partial<TransformLensAdjustmentView>
  | ((prev: TransformLensAdjustmentView) => TransformLensAdjustmentView);
type AdjustmentUpdate = TransformLensAdjustmentUpdate;
type LensCorrectionMode = TransformLensAdjustmentView['lensCorrectionMode'];
type ExifData = Record<string, string | number | null | undefined>;
type AutodetectLensResult = [string, string] | { maker: string; model: string };
type DetectionStatus = 'idle' | 'detecting' | 'success' | 'not_found' | 'error';
type PerspectiveStatus = 'idle' | 'analyzing' | 'ready' | 'abstained' | 'error';

interface TransformLensProps {
  adjustments: TransformLensAdjustmentView;
  mode?: 'all' | 'lens' | 'transform';
  onDragStateChange?: ((isDragging: boolean) => void) | undefined;
  selectedImage: SelectedImage | null;
  setAdjustments: (adjustments: AdjustmentUpdate) => void;
}

const DEFAULT_FOCAL_LENGTH_MM = 50;
const lensfunNameListSchema = z.array(z.string().min(1));
const finiteNumberSchema = z.number().finite();
const lensDistortionParamsSchema = z
  .object({
    k1: finiteNumberSchema,
    k2: finiteNumberSchema,
    k3: finiteNumberSchema,
    model: finiteNumberSchema,
    tca_vb: finiteNumberSchema,
    tca_vr: finiteNumberSchema,
    vig_k1: finiteNumberSchema,
    vig_k2: finiteNumberSchema,
    vig_k3: finiteNumberSchema,
  })
  .strict();
const autodetectLensResultSchema = z
  .union([
    z.tuple([z.string().min(1), z.string().min(1)]),
    z.object({ maker: z.string().min(1), model: z.string().min(1) }).strict(),
  ])
  .nullable();
const statusChipClassName =
  'inline-flex items-center gap-1 rounded border border-editor-border px-1.5 py-0.5 text-[10px]';
const copy = {
  auto: 'Auto',
  autoDetect: 'Auto-detect lens',
  correctionAmount: 'Correction amount',
  detecting: 'Detecting',
  distortionAmount: 'Distortion amount',
  horizontal: 'Horizontal perspective',
  lensHeading: 'Lens correction',
  manual: 'Manual',
  opticalDistortion: 'Optical distortion',
  profileDistortion: 'Profile distortion',
  profileError: 'Profile error',
  profileIdle: 'Profile idle',
  profileNotFound: 'No profile',
  profileReady: 'Profile ready',
  profileTca: 'Chromatic aberration',
  profileVignette: 'Lens vignette',
  rotation: 'Rotation',
  scale: 'Scale',
  selectLens: 'Select lens',
  selectMaker: 'Select maker',
  transformHeading: 'Transform',
  unsupportedProfileField: 'Current lens profile does not provide this correction.',
  vertical: 'Vertical perspective',
  vignetteAmount: 'Vignette amount',
  xOffset: 'X offset',
  yOffset: 'Y offset',
};

const parseExifNumber = (value: string | number | null | undefined): number | null => {
  const parsed = parseExifMetadataNumber(value);
  return parsed.status === 'valid' ? parsed.value : null;
};

const getExifValue = (exif: ExifData | null | undefined, key: string): string | number | null | undefined =>
  exif?.[key];

const normalizeAutodetectLensResult = (value: AutodetectLensResult | null): { maker: string; model: string } | null => {
  if (value === null) return null;
  if (Array.isArray(value)) {
    const [maker, model] = value;
    return maker.length > 0 && model.length > 0 ? { maker, model } : null;
  }
  return value.maker.length > 0 && value.model.length > 0 ? value : null;
};

const toOptions = (values: unknown): Array<OptionItem<string>> =>
  Array.isArray(values)
    ? values.filter((value): value is string => typeof value === 'string').map((value) => ({ label: value, value }))
    : [];

export default function TransformLens({
  adjustments,
  mode = 'all',
  onDragStateChange,
  selectedImage,
  setAdjustments,
}: TransformLensProps) {
  const { t } = useTranslation();
  const [makers, setMakers] = useState<string[]>([]);
  const [lenses, setLenses] = useState<string[]>([]);
  const [detectionStatus, setDetectionStatus] = useState<DetectionStatus>('idle');
  const [perspectiveStatus, setPerspectiveStatus] = useState<PerspectiveStatus>('idle');
  const [perspectiveMessage, setPerspectiveMessage] = useState<string | null>(null);
  const adjustmentRevision = useEditorStore((state) => state.adjustmentRevision);
  const applyEditTransaction = useEditorStore((state) => state.applyEditTransaction);
  const imageSessionId = useEditorStore(
    (state) => state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
  );
  const selectedImagePath = useEditorStore((state) => state.selectedImage?.path ?? null);
  const lensCorrectionCommitIdentity = useMemo<LensCorrectionCommitIdentity | null>(
    () =>
      selectedImagePath !== null ? { adjustmentRevision, imageSessionId, sourceIdentity: selectedImagePath } : null,
    [adjustmentRevision, imageSessionId, selectedImagePath],
  );
  const lensCorrectionCommitIdentityRef = useRef(lensCorrectionCommitIdentity);
  lensCorrectionCommitIdentityRef.current = lensCorrectionCommitIdentity;
  const lensProfileRequestGenerationRef = useRef(0);
  const perspectiveCommitIdentity = useMemo<PerspectiveCorrectionCommitIdentity | null>(
    () =>
      selectedImagePath !== null ? { adjustmentRevision, imageSessionId, sourceIdentity: selectedImagePath } : null,
    [adjustmentRevision, imageSessionId, selectedImagePath],
  );
  const perspectiveCommitIdentityRef = useRef(perspectiveCommitIdentity);
  perspectiveCommitIdentityRef.current = perspectiveCommitIdentity;
  const perspectiveRequestGenerationRef = useRef(0);

  const selectedExif = selectedImage?.exif as ExifData | null | undefined;
  const focalLength = useMemo(
    () =>
      parseExifNumber(getExifValue(selectedExif, 'FocalLength') ?? getExifValue(selectedExif, 'FocalLengthIn35mmFilm')),
    [selectedExif],
  );
  const aperture = useMemo(
    () => parseExifNumber(getExifValue(selectedExif, 'FNumber') ?? getExifValue(selectedExif, 'ApertureValue')),
    [selectedExif],
  );
  const distance = useMemo(() => parseExifNumber(getExifValue(selectedExif, 'SubjectDistance')), [selectedExif]);
  const availability = useMemo(
    () => getLensCorrectionAvailability(adjustments.lensDistortionParams),
    [adjustments.lensDistortionParams],
  );
  const hasSupportedLensProfile = hasSupportedLensCorrections(availability);
  const showTransform = mode === 'all' || mode === 'transform';
  const showLens = mode === 'all' || mode === 'lens';

  useEffect(() => {
    if (!showLens) return;
    let isMounted = true;
    void invokeWithSchema(Invokes.GetLensfunMakers, {}, lensfunNameListSchema)
      .then((nextMakers) => {
        if (isMounted) setMakers(nextMakers);
      })
      .catch(() => {
        if (isMounted) setDetectionStatus('error');
      });
    return () => {
      isMounted = false;
    };
  }, [showLens]);

  useEffect(() => {
    if (!showLens) return;
    if (!adjustments.lensMaker) {
      setLenses([]);
      return;
    }

    let isMounted = true;
    void invokeWithSchema(Invokes.GetLensfunLensesForMaker, { maker: adjustments.lensMaker }, lensfunNameListSchema)
      .then((nextLenses) => {
        if (isMounted) setLenses(nextLenses);
      })
      .catch(() => {
        if (isMounted) setLenses([]);
      });
    return () => {
      isMounted = false;
    };
  }, [adjustments.lensMaker, showLens]);

  const updateAdjustment = <Key extends keyof TransformLensAdjustmentView>(
    key: Key,
    value: TransformLensAdjustmentView[Key],
  ) => {
    setAdjustments((prev: TransformLensAdjustmentView) => ({ ...prev, [key]: value }));
  };

  const commitLensCorrectionAdjustment = <Key extends ManualLensCorrectionAdjustment>(
    key: Key,
    value: TransformLensAdjustmentView[Key],
  ) => {
    const identity = lensCorrectionCommitIdentityRef.current;
    if (identity === null) return;
    const result = applyEditTransaction(
      buildLensCorrectionEditTransaction(useEditorStore.getState(), identity, key, value, crypto.randomUUID()),
    );
    lensCorrectionCommitIdentityRef.current = {
      ...identity,
      adjustmentRevision: result.nextAdjustmentRevision,
    };
  };

  const lensProfileRequestIsCurrent = (identity: LensCorrectionCommitIdentity, requestGeneration: number) =>
    isCurrentLensProfileRequest(
      useEditorStore.getState(),
      identity,
      requestGeneration,
      lensProfileRequestGenerationRef.current,
    );

  const commitLensProfilePatch = (
    patch: LensProfilePatch,
    identity = lensCorrectionCommitIdentityRef.current,
  ): boolean => {
    if (identity === null || !isCurrentLensCorrectionIdentity(useEditorStore.getState(), identity)) return false;
    const result = applyEditTransaction(
      buildLensProfileEditTransaction(useEditorStore.getState(), identity, patch, crypto.randomUUID()),
    );
    lensCorrectionCommitIdentityRef.current = {
      ...identity,
      adjustmentRevision: result.nextAdjustmentRevision,
    };
    return true;
  };

  const fetchDistortionParams = async (maker: string, model: string): Promise<LensDistortionParams | null> =>
    invokeWithSchema(
      Invokes.GetLensDistortionParams,
      {
        aperture,
        distance,
        focalLength: focalLength ?? DEFAULT_FOCAL_LENGTH_MM,
        maker,
        model,
      },
      lensDistortionParamsSchema.nullable(),
    );

  const applyLensProfile = async (
    maker: string,
    model: string,
    mode: LensCorrectionMode,
    identity: LensCorrectionCommitIdentity,
    requestGeneration: number,
  ) => {
    try {
      const lensDistortionParams = await fetchDistortionParams(maker, model);
      if (!lensProfileRequestIsCurrent(identity, requestGeneration)) return;
      if (
        !commitLensProfilePatch(
          { lensCorrectionMode: mode, lensDistortionParams, lensMaker: maker, lensModel: model },
          identity,
        )
      )
        return;
      setDetectionStatus(lensDistortionParams === null ? 'not_found' : 'success');
    } catch (error) {
      if (!lensProfileRequestIsCurrent(identity, requestGeneration)) return;
      setDetectionStatus('error');
      console.error('Failed to apply lens profile', error);
    }
  };

  const handleModeChange = (mode: LensCorrectionMode) => {
    const requestGeneration = ++lensProfileRequestGenerationRef.current;
    if (mode === 'auto') {
      const identity = lensCorrectionCommitIdentityRef.current;
      if (identity !== null) void handleAutoDetect(identity, requestGeneration);
      return;
    }
    commitLensProfilePatch({ lensCorrectionMode: mode });
  };

  const handleAutoDetect = async (
    identity = lensCorrectionCommitIdentityRef.current,
    requestGeneration = ++lensProfileRequestGenerationRef.current,
  ) => {
    if (identity === null) return;
    const exifMaker = String(getExifValue(selectedExif, 'Make') ?? '');
    const exifModel = String(getExifValue(selectedExif, 'LensModel') ?? '');
    if (!exifModel) {
      commitLensProfilePatch(
        { lensCorrectionMode: 'auto', lensDistortionParams: null, lensMaker: null, lensModel: null },
        identity,
      );
      setDetectionStatus('not_found');
      return;
    }

    setDetectionStatus('detecting');
    try {
      const detected = normalizeAutodetectLensResult(
        await invokeWithSchema(
          Invokes.AutodetectLens,
          { maker: exifMaker, model: exifModel },
          autodetectLensResultSchema,
        ),
      );
      if (!lensProfileRequestIsCurrent(identity, requestGeneration)) return;
      if (detected === null) {
        commitLensProfilePatch(
          { lensCorrectionMode: 'auto', lensDistortionParams: null, lensMaker: null, lensModel: null },
          identity,
        );
        setDetectionStatus('not_found');
        return;
      }
      await applyLensProfile(detected.maker, detected.model, 'auto', identity, requestGeneration);
    } catch (error) {
      if (!lensProfileRequestIsCurrent(identity, requestGeneration)) return;
      setDetectionStatus('error');
      console.error('Failed to detect lens profile', error);
    }
  };

  const handleMakerChange = (maker: string) => {
    lensProfileRequestGenerationRef.current += 1;
    commitLensProfilePatch({
      lensCorrectionMode: 'manual',
      lensDistortionParams: null,
      lensMaker: maker,
      lensModel: null,
    });
    setDetectionStatus('idle');
  };

  const handleModelChange = (model: string) => {
    if (!adjustments.lensMaker) return;
    const identity = lensCorrectionCommitIdentityRef.current;
    const requestGeneration = ++lensProfileRequestGenerationRef.current;
    if (identity !== null) void applyLensProfile(adjustments.lensMaker, model, 'manual', identity, requestGeneration);
  };

  const makerOptions = useMemo(() => toOptions(makers), [makers]);
  const lensOptions = useMemo(() => toOptions(lenses), [lenses]);
  const unsupportedProfileFieldTooltip = copy.unsupportedProfileField;
  const lensModeOptions = useMemo<Array<OptionItem<LensCorrectionMode>>>(
    () => [
      { label: copy.auto, value: 'auto' },
      { label: copy.manual, value: 'manual' },
    ],
    [],
  );
  const perspectiveModeOptions = useMemo<Array<OptionItem<PerspectiveCorrectionMode>>>(
    () => [
      { label: t('adjustments.perspective.modes.off'), value: 'off' },
      { label: t('adjustments.perspective.modes.autoLevel'), value: 'auto_level' },
      { label: t('adjustments.perspective.modes.autoVertical'), value: 'auto_vertical' },
      { label: t('adjustments.perspective.modes.autoHorizontal'), value: 'auto_horizontal' },
      { label: t('adjustments.perspective.modes.autoFull'), value: 'auto_full' },
      { label: t('adjustments.perspective.modes.guided'), value: 'guided' },
      { label: t('adjustments.perspective.modes.manualLegacy'), value: 'manual_legacy' },
    ],
    [t],
  );
  const perspectiveCropOptions = useMemo<Array<OptionItem<PerspectiveCropPolicy>>>(
    () => [
      { label: t('adjustments.perspective.crop.autoCrop'), value: 'auto_crop' },
      { label: t('adjustments.perspective.crop.constrain'), value: 'constrain' },
      { label: t('adjustments.perspective.crop.showAll'), value: 'show_all' },
      { label: t('adjustments.perspective.crop.preserveCurrent'), value: 'preserve_current_crop' },
      { label: t('adjustments.perspective.crop.manualAfter'), value: 'manual_after_correction' },
    ],
    [t],
  );

  const updatePerspective = (next: Partial<TransformLensAdjustmentView['perspectiveCorrection']>) => {
    const identity = perspectiveCommitIdentityRef.current;
    if (identity === null) return;
    perspectiveRequestGenerationRef.current += 1;
    const result = applyEditTransaction(
      buildPerspectiveCorrectionEditTransaction(useEditorStore.getState(), identity, next, crypto.randomUUID()),
    );
    perspectiveCommitIdentityRef.current = { ...identity, adjustmentRevision: result.nextAdjustmentRevision };
    if (perspectiveStatus === 'analyzing') {
      setPerspectiveStatus('idle');
      setPerspectiveMessage(null);
    }
  };

  const analyzePerspective = async () => {
    const state = useEditorStore.getState();
    const identity = capturePerspectiveCorrectionCommitIdentity(state);
    if (identity === null) return;
    const requestGeneration = ++perspectiveRequestGenerationRef.current;
    const analysisAdjustments = structuredClone(state.editDocumentV2);
    const analysisGeometry = selectEditDocumentGeometry(analysisAdjustments);
    setPerspectiveStatus('analyzing');
    try {
      const result = await invokeWithSchema(
        Invokes.AnalyzePerspectiveCorrection,
        {
          adjustments: analysisAdjustments,
          settings: { ...analysisGeometry.perspectiveCorrection, amount: 100, resolvedPlan: null },
        },
        perspectiveAnalysisResultSchema,
      );
      const current = useEditorStore.getState();
      if (
        !isCurrentPerspectiveAnalysisRequest(
          current,
          identity,
          requestGeneration,
          perspectiveRequestGenerationRef.current,
        )
      )
        return;
      const committed = applyEditTransaction(
        buildPerspectiveCorrectionEditTransaction(
          current,
          identity,
          { resolvedPlan: result.receipt.plan },
          crypto.randomUUID(),
        ),
      );
      perspectiveCommitIdentityRef.current = {
        ...identity,
        adjustmentRevision: committed.nextAdjustmentRevision,
      };
      setPerspectiveStatus(result.receipt.abstentionReason === null ? 'ready' : 'abstained');
      setPerspectiveMessage(result.receipt.abstentionReason ?? result.receipt.plan.warningCodes[0] ?? null);
    } catch (error) {
      if (
        !isCurrentPerspectiveAnalysisRequest(
          useEditorStore.getState(),
          identity,
          requestGeneration,
          perspectiveRequestGenerationRef.current,
        )
      )
        return;
      setPerspectiveStatus('error');
      setPerspectiveMessage('perspective.analysis_failed');
      console.error('Failed to analyze perspective', error);
    }
  };

  const addGuide = (className: 'horizontal' | 'vertical') => {
    const current = selectEditDocumentGeometry(useEditorStore.getState().editDocumentV2).perspectiveCorrection;
    const familyCount = current.guides.filter((guide) => guide.class === className).length;
    if (familyCount >= 2) return;
    const position = familyCount === 0 ? 0.25 : 0.75;
    const endpointsSourceNormalized: [[number, number], [number, number]] =
      className === 'horizontal'
        ? [
            [0.15, position],
            [0.85, position],
          ]
        : [
            [position, 0.15],
            [position, 0.85],
          ];
    updatePerspective({
      guides: [
        ...current.guides,
        {
          class: className,
          endpointsSourceNormalized,
          id: crypto.randomUUID(),
          weight: 1,
        },
      ],
      resolvedPlan: null,
    });
  };

  const updateGuideCoordinate = (id: string, endpoint: 0 | 1, axis: 0 | 1, value: number) => {
    if (!Number.isFinite(value)) return;
    const current = selectEditDocumentGeometry(useEditorStore.getState().editDocumentV2).perspectiveCorrection;
    updatePerspective({
      guides: current.guides.map((guide) => {
        if (guide.id !== id) return guide;
        const endpoints = guide.endpointsSourceNormalized.map((point) => [...point]) as [
          [number, number],
          [number, number],
        ];
        endpoints[endpoint][axis] = Math.min(1, Math.max(0, value));
        return { ...guide, endpointsSourceNormalized: endpoints };
      }),
      resolvedPlan: null,
    });
  };
  const detectionLabel =
    detectionStatus === 'detecting'
      ? copy.detecting
      : detectionStatus === 'success'
        ? copy.profileReady
        : detectionStatus === 'not_found'
          ? copy.profileNotFound
          : detectionStatus === 'error'
            ? copy.profileError
            : copy.profileIdle;
  return (
    <div
      className="space-y-2"
      data-commit-adjustment-revision={lensCorrectionCommitIdentity?.adjustmentRevision}
      data-commit-image-session={lensCorrectionCommitIdentity?.imageSessionId}
      data-commit-source-identity={lensCorrectionCommitIdentity?.sourceIdentity}
      data-testid="transform-lens-inspector"
    >
      {showTransform && (
        <section className="space-y-1.5" data-testid="perspective-correction-controls">
          <div className="flex items-center justify-between gap-2">
            <UiText variant={TextVariants.label} className="text-[11px] font-semibold uppercase text-text-secondary">
              {t('adjustments.perspective.heading')}
            </UiText>
            <span className={cx(statusChipClassName, 'bg-editor-panel text-text-secondary')}>
              {perspectiveStatus === 'analyzing' ? (
                <Loader className="animate-spin" size={11} />
              ) : (
                <Grid3X3 size={11} />
              )}
              {perspectiveStatus}
            </span>
          </div>
          <div className="space-y-1.5 rounded border border-editor-border bg-editor-panel-well p-1.5">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <Dropdown
                chrome="editor"
                onChange={(mode) => {
                  updatePerspective({ mode, resolvedPlan: null });
                  setPerspectiveStatus('idle');
                  setPerspectiveMessage(null);
                }}
                options={perspectiveModeOptions}
                value={adjustments.perspectiveCorrection.mode}
              />
              <button
                aria-label={t('adjustments.perspective.analyze')}
                className="inline-flex h-7 w-8 items-center justify-center rounded border border-editor-border text-text-secondary hover:bg-editor-selected-quiet disabled:opacity-45"
                disabled={
                  perspectiveStatus === 'analyzing' || !adjustments.perspectiveCorrection.mode.startsWith('auto_')
                }
                onClick={() => void analyzePerspective()}
                data-testid="perspective-analyze-button"
                type="button"
              >
                {perspectiveStatus === 'analyzing' ? (
                  <Loader className="animate-spin" size={14} />
                ) : (
                  <Wand2 size={14} />
                )}
              </button>
            </div>
            {adjustments.perspectiveCorrection.mode !== 'off' &&
              adjustments.perspectiveCorrection.mode !== 'manual_legacy' && (
                <>
                  <AdjustmentSlider
                    density="compact"
                    fillOrigin="min"
                    label={t('adjustments.perspective.amount')}
                    max={100}
                    min={0}
                    onDragStateChange={onDragStateChange}
                    onValueChange={(amount) => updatePerspective({ amount })}
                    step={1}
                    suffix="%"
                    value={adjustments.perspectiveCorrection.amount}
                  />
                  <Dropdown
                    chrome="editor"
                    onChange={(cropPolicy) => updatePerspective({ cropPolicy })}
                    options={perspectiveCropOptions}
                    value={adjustments.perspectiveCorrection.cropPolicy}
                  />
                </>
              )}
            {adjustments.perspectiveCorrection.resolvedPlan && (
              <div
                className="grid grid-cols-2 gap-1 text-[10px] text-text-secondary"
                data-testid="perspective-evidence-summary"
              >
                <span>
                  {t('adjustments.perspective.confidence')}:{' '}
                  {Math.round(adjustments.perspectiveCorrection.resolvedPlan.confidence * 100)}%
                </span>
                <span>
                  {t('adjustments.perspective.retainedArea')}:{' '}
                  {Math.round(adjustments.perspectiveCorrection.resolvedPlan.retainedArea * 100)}%
                </span>
              </div>
            )}
            {perspectiveMessage && (
              <div
                className="rounded border border-editor-warning bg-editor-warning-surface px-1.5 py-1 text-[10px] text-text-secondary"
                role="status"
              >
                {perspectiveMessage}
              </div>
            )}
            {adjustments.perspectiveCorrection.resolvedPlan && (
              <button
                className="w-full rounded border border-editor-border px-1.5 py-1 text-[10px] text-text-secondary hover:bg-editor-selected-quiet"
                onClick={() => {
                  updatePerspective({ resolvedPlan: null });
                  setPerspectiveStatus('idle');
                  setPerspectiveMessage(null);
                }}
                type="button"
              >
                {t('adjustments.perspective.resetSolved')}
              </button>
            )}
            {adjustments.perspectiveCorrection.mode === 'guided' && (
              <div className="space-y-1" data-testid="perspective-guide-list">
                <div className="grid grid-cols-2 gap-1">
                  <button
                    className="inline-flex items-center justify-center gap-1 rounded border border-editor-border p-1 text-[10px]"
                    onClick={() => addGuide('horizontal')}
                    type="button"
                  >
                    <Plus size={10} />
                    {t('adjustments.perspective.addHorizontalGuide')}
                  </button>
                  <button
                    className="inline-flex items-center justify-center gap-1 rounded border border-editor-border p-1 text-[10px]"
                    onClick={() => addGuide('vertical')}
                    type="button"
                  >
                    <Plus size={10} />
                    {t('adjustments.perspective.addVerticalGuide')}
                  </button>
                </div>
                {adjustments.perspectiveCorrection.guides.map((guide, index) => (
                  <div className="space-y-1 rounded border border-editor-border px-1.5 py-1 text-[10px]" key={guide.id}>
                    <div className="flex items-center justify-between">
                      <span>
                        {guide.class} {index + 1}
                      </span>
                      <button
                        aria-label={`Delete ${guide.class} guide`}
                        onClick={() =>
                          updatePerspective({
                            guides: adjustments.perspectiveCorrection.guides.filter(
                              (candidate) => candidate.id !== guide.id,
                            ),
                            resolvedPlan: null,
                          })
                        }
                        type="button"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      {guide.endpointsSourceNormalized.flatMap((point, endpoint) =>
                        point.map((coordinate, axis) => (
                          <input
                            aria-label={`${guide.class} guide ${index + 1} endpoint ${endpoint + 1} ${axis === 0 ? 'x' : 'y'}`}
                            className="min-w-0 rounded border border-editor-border bg-editor-panel px-1 py-0.5"
                            key={`${endpoint}-${axis}`}
                            max={1}
                            min={0}
                            onChange={(event) =>
                              updateGuideCoordinate(
                                guide.id,
                                endpoint as 0 | 1,
                                axis as 0 | 1,
                                event.currentTarget.valueAsNumber,
                              )
                            }
                            step={0.001}
                            type="number"
                            value={coordinate}
                          />
                        )),
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}
      {showTransform && (
        <section className="space-y-1.5" data-testid="transform-controls">
          <UiText variant={TextVariants.label} className="text-[11px] font-semibold uppercase text-text-secondary">
            {copy.transformHeading}
          </UiText>
          <div className="space-y-px">
            <AdjustmentSlider
              density="compact"
              label={copy.vertical}
              max={100}
              min={-100}
              onDragStateChange={onDragStateChange}
              onValueChange={(value) => {
                updateAdjustment('transformVertical', Math.trunc(value));
              }}
              step={1}
              value={adjustments.transformVertical}
            />
            <AdjustmentSlider
              density="compact"
              label={copy.horizontal}
              max={100}
              min={-100}
              onDragStateChange={onDragStateChange}
              onValueChange={(value) => {
                updateAdjustment('transformHorizontal', Math.trunc(value));
              }}
              step={1}
              value={adjustments.transformHorizontal}
            />
            <AdjustmentSlider
              density="compact"
              label={copy.rotation}
              max={45}
              min={-45}
              onDragStateChange={onDragStateChange}
              onValueChange={(value) => {
                updateAdjustment('transformRotate', value);
              }}
              step={0.1}
              suffix="°"
              value={adjustments.transformRotate}
            />
            <AdjustmentSlider
              density="compact"
              fillOrigin="min"
              label={copy.scale}
              max={150}
              min={50}
              onDragStateChange={onDragStateChange}
              onValueChange={(value) => {
                updateAdjustment('transformScale', Math.trunc(value));
              }}
              step={1}
              suffix="%"
              value={adjustments.transformScale}
            />
            <AdjustmentSlider
              density="compact"
              label={copy.xOffset}
              max={100}
              min={-100}
              onDragStateChange={onDragStateChange}
              onValueChange={(value) => {
                updateAdjustment('transformXOffset', Math.trunc(value));
              }}
              step={1}
              value={adjustments.transformXOffset}
            />
            <AdjustmentSlider
              density="compact"
              label={copy.yOffset}
              max={100}
              min={-100}
              onDragStateChange={onDragStateChange}
              onValueChange={(value) => {
                updateAdjustment('transformYOffset', Math.trunc(value));
              }}
              step={1}
              value={adjustments.transformYOffset}
            />
            <AdjustmentSlider
              density="compact"
              label={copy.opticalDistortion}
              max={100}
              min={-100}
              onDragStateChange={onDragStateChange}
              onValueChange={(value) => {
                updateAdjustment('transformDistortion', Math.trunc(value));
              }}
              step={1}
              value={adjustments.transformDistortion}
            />
          </div>
        </section>
      )}

      {showLens && (
        <section className="space-y-2" data-testid="lens-correction-controls">
          <div className="flex items-center justify-between gap-2">
            <UiText variant={TextVariants.label} className="text-[11px] font-semibold uppercase text-text-secondary">
              {copy.lensHeading}
            </UiText>
            <span
              className={cx(
                statusChipClassName,
                hasSupportedLensProfile
                  ? 'bg-editor-selected-quiet text-text-primary'
                  : 'bg-editor-panel text-text-secondary',
              )}
            >
              {detectionStatus === 'detecting' ? <Loader className="animate-spin" size={11} /> : <Aperture size={11} />}
              {detectionLabel}
            </span>
          </div>

          <div className="space-y-1.5 rounded border border-editor-border bg-editor-panel-well p-1.5">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <Dropdown
                chrome="editor"
                onChange={handleModeChange}
                options={lensModeOptions}
                value={adjustments.lensCorrectionMode}
              />
              <button
                aria-label={copy.autoDetect}
                className="inline-flex h-7 w-8 items-center justify-center rounded border border-editor-border text-text-secondary transition-colors hover:bg-editor-selected-quiet hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring disabled:cursor-not-allowed disabled:opacity-45"
                data-tooltip={copy.autoDetect}
                disabled={detectionStatus === 'detecting' || !getExifValue(selectedExif, 'LensModel')}
                onClick={() => {
                  void handleAutoDetect();
                }}
                type="button"
              >
                {detectionStatus === 'detecting' ? <Loader className="animate-spin" size={14} /> : <Wand2 size={14} />}
              </button>
            </div>

            {adjustments.lensCorrectionMode === 'manual' && (
              <div className="grid grid-cols-1 gap-1.5">
                <Dropdown
                  chrome="editor"
                  onChange={handleMakerChange}
                  options={makerOptions}
                  placeholder={copy.selectMaker}
                  value={adjustments.lensMaker}
                />
                <Dropdown
                  chrome="editor"
                  disabled={!adjustments.lensMaker}
                  onChange={handleModelChange}
                  options={lensOptions}
                  placeholder={copy.selectLens}
                  value={adjustments.lensModel}
                />
              </div>
            )}

            {adjustments.lensCorrectionMode === 'auto' && adjustments.lensMaker && adjustments.lensModel && (
              <UiText as="div" variant={TextVariants.small} className="truncate text-[11px] text-text-secondary">
                {adjustments.lensMaker} - {adjustments.lensModel}
              </UiText>
            )}

            <div className="space-y-2">
              <Switch
                checked={adjustments.lensDistortionEnabled && availability.distortion}
                chrome="editor"
                disabled={!availability.distortion}
                label={copy.profileDistortion}
                onChange={(checked) => {
                  commitLensCorrectionAdjustment('lensDistortionEnabled', checked);
                }}
                {...(availability.distortion ? {} : { tooltip: unsupportedProfileFieldTooltip })}
              />
              <AdjustmentSlider
                density="compact"
                disabled={!availability.distortion || !adjustments.lensDistortionEnabled}
                fillOrigin="min"
                label={
                  <span className="inline-flex items-center gap-1">
                    <SquareDashed size={12} />
                    {copy.distortionAmount}
                  </span>
                }
                max={200}
                min={0}
                onDragStateChange={onDragStateChange}
                onValueChange={(value) => {
                  commitLensCorrectionAdjustment('lensDistortionAmount', Math.trunc(value));
                }}
                step={1}
                suffix="%"
                testId="lens-control-distortion-amount"
                value={adjustments.lensDistortionAmount}
              />

              <Switch
                checked={adjustments.lensTcaEnabled && availability.tca}
                chrome="editor"
                disabled={!availability.tca}
                label={copy.profileTca}
                onChange={(checked) => {
                  commitLensCorrectionAdjustment('lensTcaEnabled', checked);
                }}
                {...(availability.tca ? {} : { tooltip: unsupportedProfileFieldTooltip })}
              />
              <AdjustmentSlider
                density="compact"
                disabled={!availability.tca || !adjustments.lensTcaEnabled}
                fillOrigin="min"
                label={copy.correctionAmount}
                max={200}
                min={0}
                onDragStateChange={onDragStateChange}
                onValueChange={(value) => {
                  commitLensCorrectionAdjustment('lensTcaAmount', Math.trunc(value));
                }}
                step={1}
                suffix="%"
                testId="lens-control-tca-amount"
                value={adjustments.lensTcaAmount}
              />

              <Switch
                checked={adjustments.lensVignetteEnabled && availability.vignetting}
                chrome="editor"
                disabled={!availability.vignetting}
                label={copy.profileVignette}
                onChange={(checked) => {
                  commitLensCorrectionAdjustment('lensVignetteEnabled', checked);
                }}
                {...(availability.vignetting ? {} : { tooltip: unsupportedProfileFieldTooltip })}
              />
              <AdjustmentSlider
                density="compact"
                disabled={!availability.vignetting || !adjustments.lensVignetteEnabled}
                fillOrigin="min"
                label={
                  <span className="inline-flex items-center gap-1">
                    <CircleDashed size={12} />
                    {copy.vignetteAmount}
                  </span>
                }
                max={200}
                min={0}
                onDragStateChange={onDragStateChange}
                onValueChange={(value) => {
                  commitLensCorrectionAdjustment('lensVignetteAmount', Math.trunc(value));
                }}
                step={1}
                suffix="%"
                testId="lens-control-vignette-amount"
                value={adjustments.lensVignetteAmount}
              />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
