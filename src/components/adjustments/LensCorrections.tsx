import { Aperture, Info } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../store/useEditorStore';
import { TextVariants } from '../../types/typography';
import {
  buildLensCorrectionEditTransaction,
  type LensCorrectionCommitIdentity,
  type ManualLensCorrectionAdjustment,
} from '../../utils/lensCorrectionEditTransaction';
import type { SelectedImage } from '../ui/AppProperties';
import UiText from '../ui/primitives/Text';
import AdjustmentSlider from './AdjustmentSlider';
import TransformLens, { type TransformLensAdjustmentUpdate, type TransformLensAdjustmentView } from './TransformLens';

interface LensCorrectionsProps {
  adjustments: TransformLensAdjustmentView;
  onDragStateChange?: ((isDragging: boolean) => void) | undefined;
  selectedImage: SelectedImage | null;
  setAdjustments: (adjustments: TransformLensAdjustmentUpdate) => void;
}

const MANUAL_CHROMATIC_ABERRATION_KEYS = [
  'chromaticAberrationRedCyan',
  'chromaticAberrationBlueYellow',
] as const satisfies ReadonlyArray<ManualLensCorrectionAdjustment>;

const lensCorrectionCopy = {
  cameraLens: 'Camera / lens match',
  defringe: 'Defringe',
  defringeUnavailable: 'Manual defringe is unavailable until a typed renderer profile is selected.',
  license: 'CC BY-SA 3.0',
  manualFallback: 'Manual fallback: no compatible profile is applied. Chromatic controls remain available.',
  manualProfile: 'Manual lens profile correction',
  missingProfile: 'RAW profile not found: no profile correction is applied. Manual controls remain available.',
  noImage: 'Select an image to use lens corrections.',
  nonRaw: 'Non-RAW image: profile corrections are unavailable. Manual chromatic controls remain available.',
  profileSource: 'Lensfun lens database',
  provenance: 'Profile provenance',
  raw: 'RAW profile correction',
};

const captureCommitIdentity = (): LensCorrectionCommitIdentity | null => {
  const state = useEditorStore.getState();
  return state.selectedImage === null
    ? null
    : {
        adjustmentRevision: state.adjustmentRevision,
        imageSessionId: state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
        sourceIdentity: state.selectedImage.path,
      };
};

/**
 * The Develop Lens Corrections surface. TransformLens still owns the profile
 * resolver and profile-backed distortion/TCA/vignetting controls; this wrapper
 * owns the panel-only manual CA/advanced diagnostics that must not leak into
 * Details.
 */
export default function LensCorrections({
  adjustments,
  onDragStateChange,
  selectedImage,
  setAdjustments,
}: LensCorrectionsProps) {
  const { t } = useTranslation();
  const applyEditTransaction = useEditorStore((state) => state.applyEditTransaction);
  const commitIdentityRef = useRef<LensCorrectionCommitIdentity | null>(captureCommitIdentity());
  const identity = captureCommitIdentity();
  commitIdentityRef.current = identity;

  const profileState = useMemo(() => {
    if (selectedImage === null) return 'unavailable';
    if (adjustments.lensCorrectionMode === 'auto') {
      return adjustments.lensDistortionParams === null ? 'missing' : 'detected';
    }
    return adjustments.lensDistortionParams === null ? 'manual-fallback' : 'manual';
  }, [adjustments.lensCorrectionMode, adjustments.lensDistortionParams, selectedImage]);

  const commitManualLensAdjustment = <Key extends (typeof MANUAL_CHROMATIC_ABERRATION_KEYS)[number]>(
    key: Key,
    value: TransformLensAdjustmentView[Key],
  ) => {
    const currentIdentity = commitIdentityRef.current;
    if (currentIdentity === null) return;
    const result = applyEditTransaction(
      buildLensCorrectionEditTransaction(useEditorStore.getState(), currentIdentity, key, value, crypto.randomUUID()),
    );
    commitIdentityRef.current = { ...currentIdentity, adjustmentRevision: result.nextAdjustmentRevision };
  };

  const provenanceMessage =
    selectedImage === null
      ? lensCorrectionCopy.noImage
      : !selectedImage.isRaw
        ? lensCorrectionCopy.nonRaw
        : profileState === 'missing'
          ? lensCorrectionCopy.missingProfile
          : profileState === 'manual-fallback'
            ? lensCorrectionCopy.manualFallback
            : profileState === 'manual'
              ? `${lensCorrectionCopy.manualProfile} · ${lensCorrectionCopy.profileSource} · ${lensCorrectionCopy.license}`
              : `${lensCorrectionCopy.raw} · ${lensCorrectionCopy.profileSource} · ${lensCorrectionCopy.license}`;
  const cameraLensMatch = selectedImage?.exif
    ? `${selectedImage.exif.Make ?? 'Unknown camera'} · ${selectedImage.exif.LensModel ?? 'Unknown lens'}`
    : 'Camera and lens metadata unavailable';

  return (
    <div
      className="space-y-2"
      data-lens-input-kind={selectedImage?.isRaw ? 'raw' : selectedImage === null ? 'none' : 'non-raw'}
      data-lens-profile-state={profileState}
      data-testid="lens-corrections-panel"
    >
      <TransformLens
        adjustments={adjustments}
        mode="lens"
        onDragStateChange={onDragStateChange}
        selectedImage={selectedImage}
        setAdjustments={setAdjustments}
      />

      <section className="space-y-1.5" data-testid="lens-profile-provenance">
        <div className="flex items-center gap-1 text-[10px] font-semibold uppercase text-text-secondary">
          <Info size={11} />
          {lensCorrectionCopy.provenance}
        </div>
        <div className="rounded border border-editor-border bg-editor-panel-well px-1.5 py-1 text-[10px] text-text-secondary">
          {provenanceMessage}
        </div>
        <div
          className="rounded border border-editor-border bg-editor-panel-well px-1.5 py-1 text-[10px] text-text-secondary"
          data-testid="lens-camera-lens-match"
        >
          <span className="font-semibold text-text-primary">{lensCorrectionCopy.cameraLens}:</span> {cameraLensMatch}
        </div>
      </section>

      <section className="space-y-1.5" data-testid="manual-chromatic-aberration-controls">
        <div className="flex items-center gap-1">
          <Aperture size={12} />
          <UiText variant={TextVariants.label} className="text-[11px] font-semibold uppercase text-text-secondary">
            {t('adjustments.details.chromaticAberration', { defaultValue: 'Manual chromatic aberration' })}
          </UiText>
        </div>
        <div className="space-y-px rounded border border-editor-border bg-editor-panel-well p-1.5">
          <AdjustmentSlider
            density="compact"
            label={t('adjustments.details.redCyan', { defaultValue: 'Red/Cyan' })}
            max={100}
            min={-100}
            onDragStateChange={onDragStateChange}
            onValueChange={(value) => {
              commitManualLensAdjustment('chromaticAberrationRedCyan', Math.trunc(value));
            }}
            step={1}
            testId="lens-control-ca-red-cyan"
            value={adjustments.chromaticAberrationRedCyan}
          />
          <AdjustmentSlider
            density="compact"
            label={t('adjustments.details.blueYellow', { defaultValue: 'Blue/Yellow' })}
            max={100}
            min={-100}
            onDragStateChange={onDragStateChange}
            onValueChange={(value) => {
              commitManualLensAdjustment('chromaticAberrationBlueYellow', Math.trunc(value));
            }}
            step={1}
            testId="lens-control-ca-blue-yellow"
            value={adjustments.chromaticAberrationBlueYellow}
          />
        </div>
      </section>

      <section className="space-y-1.5" data-testid="lens-defringe-advanced">
        <UiText variant={TextVariants.label} className="text-[11px] font-semibold uppercase text-text-secondary">
          {lensCorrectionCopy.defringe}
        </UiText>
        <div className="rounded border border-editor-border bg-editor-panel-well px-1.5 py-1 text-[10px] text-text-secondary">
          {lensCorrectionCopy.defringeUnavailable}
        </div>
      </section>
    </div>
  );
}

export type { LensCorrectionsProps };
