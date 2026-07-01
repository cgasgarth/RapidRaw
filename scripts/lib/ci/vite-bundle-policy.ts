export type ViteBundleBudgetAssetClass = {
  extension: `.${string}`;
  label: string;
  maxBytes: number;
  maxGzipBytes: number;
  warnBytes: number;
  warnGzipBytes: number;
};

export type ViteBundleBudgetPolicy = {
  assetsDir: string;
  budgetMode: string;
  budgets: ViteBundleBudgetAssetClass[];
  chunkWarningAssetExtension: ViteBundleBudgetAssetClass['extension'];
  headroomPolicy: string;
  initialEntryAggregate: Omit<ViteBundleBudgetAssetClass, 'extension'>;
  warningTierPolicy: string;
  units: 'bytes';
};

export const VITE_BUNDLE_BUDGET_POLICY = {
  assetsDir: 'dist/assets',
  budgetMode: 'minified production Vite build',
  budgets: [
    {
      extension: '.js',
      label: 'Largest JavaScript asset',
      maxBytes: 3_072_000,
      maxGzipBytes: 900_000,
      warnBytes: 2_764_800,
      warnGzipBytes: 810_000,
    },
    {
      extension: '.css',
      label: 'Largest CSS asset',
      maxBytes: 163_840,
      maxGzipBytes: 26_624,
      warnBytes: 147_456,
      warnGzipBytes: 23_962,
    },
  ],
  chunkWarningAssetExtension: '.js',
  headroomPolicy: 'Fail budgets keep about 10% emergency headroom above warning thresholds.',
  initialEntryAggregate: {
    label: 'Initial entry aggregate',
    maxBytes: 3_235_840,
    maxGzipBytes: 926_624,
    warnBytes: 2_912_256,
    warnGzipBytes: 833_962,
  },
  units: 'bytes',
  warningTierPolicy:
    'Warnings are non-failing early signals; failures block PRs until code is split, removed, or a temporary exception is documented.',
} satisfies ViteBundleBudgetPolicy;

export const getViteChunkSizeWarningLimitKb = (): number => {
  const budget = VITE_BUNDLE_BUDGET_POLICY.budgets.find(
    (candidate) => candidate.extension === VITE_BUNDLE_BUDGET_POLICY.chunkWarningAssetExtension,
  );
  if (budget === undefined) throw new Error('Vite bundle policy is missing the chunk warning asset budget.');
  return Math.ceil(budget.maxBytes / 1024);
};

export const formatBundlePolicyBytes = (bytes: number): string => `${bytes.toLocaleString('en-US')} bytes`;
