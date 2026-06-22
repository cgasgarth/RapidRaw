export const NegativeLabAppServerCommandName = {
  AcceptBatchPlan: 'negative.lab.accept_batch_dry_run_plan',
  AcceptedBatchApply: 'negative.lab.build_accepted_batch_apply',
  BatchSummary: 'negative.lab.build_batch_dry_run_summary',
  ConversionPlan: 'negative.lab.build_conversion_plan',
  Densitometer: 'negative.lab.build_densitometer_readout',
  FrameHealth: 'negative.lab.build_frame_health_report',
  PlanRollNormalization: 'negative.lab.build_roll_normalization_plan',
  QcProof: 'negative.lab.build_qc_proof_report',
  StockFamilyConversion: 'negative.lab.build_stock_family_conversion_plan',
  StockMetadata: 'negative.lab.list_stock_metadata',
  StockRegistry: 'negative.lab.list_stock_registry',
} as const;

export type NegativeLabAppServerCommandName =
  (typeof NegativeLabAppServerCommandName)[keyof typeof NegativeLabAppServerCommandName];
