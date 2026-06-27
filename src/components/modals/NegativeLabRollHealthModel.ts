import type {
  NegativeLabAcquisitionSourceFamily,
  NegativeLabAcquisitionWarningCode,
  NegativeLabFrameHealthEntry,
  NegativeLabFrameWarningSeverity,
} from '../../schemas/negativeLabFrameHealthSchemas';

export type NegativeLabFrameHealthFilter = 'all' | NegativeLabFrameWarningSeverity;
export type NegativeLabFrameHealthSort = 'roll_order' | 'warning_severity';
export type NegativeLabQcDecision = 'approved' | 'pending' | 'rejected';

export const NEGATIVE_LAB_FRAME_HEALTH_FILTERS = [
  'all',
  'review',
  'info',
  'ok',
] satisfies Array<NegativeLabFrameHealthFilter>;
export const NEGATIVE_LAB_FRAME_HEALTH_SORTS = [
  'roll_order',
  'warning_severity',
] satisfies Array<NegativeLabFrameHealthSort>;
export const FRAME_WARNING_SEVERITY_SCORE = {
  info: 1,
  ok: 0,
  review: 2,
} satisfies Record<NegativeLabFrameWarningSeverity, number>;

type AcquisitionSourceFamilyLabelKey = `modals.negativeConversion.acquisitionSource${string}`;
type AcquisitionWarningLabelKey = `modals.negativeConversion.acquisitionWarning${string}`;
type BatchDispositionLabelKey = `modals.negativeConversion.batchDisposition${string}`;
type BatchDispositionReasonLabelKey = `modals.negativeConversion.batchDispositionReason${string}`;
type QcDecisionLabelKey = `modals.negativeConversion.qcDecision${string}`;

export const getNegativeLabFrameWarningCount = (frame: NegativeLabFrameHealthEntry) =>
  frame.warningCodes.length + frame.acquisitionWarningCodes.length;

export const ACQUISITION_SOURCE_FAMILY_LABEL_KEYS = {
  jpeg_lossy: 'modals.negativeConversion.acquisitionSourceJpeg',
  raw_like: 'modals.negativeConversion.acquisitionSourceRaw',
  tiff_scan: 'modals.negativeConversion.acquisitionSourceTiff',
  unknown: 'modals.negativeConversion.acquisitionSourceUnknown',
} satisfies Record<NegativeLabAcquisitionSourceFamily, AcquisitionSourceFamilyLabelKey>;

export const ACQUISITION_WARNING_LABEL_KEYS = {
  lab_processed_input_for_negative_lab: 'modals.negativeConversion.acquisitionWarningLabProcessed',
  lossy_source_for_negative_lab: 'modals.negativeConversion.acquisitionWarningLossy',
  mixed_source_families: 'modals.negativeConversion.acquisitionWarningMixed',
  unknown_acquisition_state: 'modals.negativeConversion.acquisitionWarningUnknown',
} satisfies Record<NegativeLabAcquisitionWarningCode, AcquisitionWarningLabelKey>;

export const BATCH_DISPOSITION_LABEL_KEYS = {
  apply: 'modals.negativeConversion.batchDispositionApply',
  review: 'modals.negativeConversion.batchDispositionReview',
  skip: 'modals.negativeConversion.batchDispositionSkip',
} satisfies Record<NegativeLabFrameHealthEntry['batchDisposition'], BatchDispositionLabelKey>;

export const BATCH_DISPOSITION_REASON_LABEL_KEYS = {
  acquisition_review_required: 'modals.negativeConversion.batchDispositionReasonAcquisition',
  base_not_estimated: 'modals.negativeConversion.batchDispositionReasonBase',
  excluded_from_batch: 'modals.negativeConversion.batchDispositionReasonExcluded',
  preview_required: 'modals.negativeConversion.batchDispositionReasonPreview',
  ready_to_apply: 'modals.negativeConversion.batchDispositionReasonReady',
} satisfies Record<NegativeLabFrameHealthEntry['batchDispositionReason'], BatchDispositionReasonLabelKey>;

export const QC_DECISION_LABEL_KEYS = {
  approved: 'modals.negativeConversion.qcDecisionApproved',
  pending: 'modals.negativeConversion.qcDecisionPending',
  rejected: 'modals.negativeConversion.qcDecisionRejected',
} satisfies Record<NegativeLabQcDecision, QcDecisionLabelKey>;

export const isNegativeLabFrameHealthFilter = (value: string): value is NegativeLabFrameHealthFilter =>
  NEGATIVE_LAB_FRAME_HEALTH_FILTERS.some((filter) => filter === value);

export const isNegativeLabFrameHealthSort = (value: string): value is NegativeLabFrameHealthSort =>
  NEGATIVE_LAB_FRAME_HEALTH_SORTS.some((sort) => sort === value);
