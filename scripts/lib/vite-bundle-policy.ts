export type ViteBundleBudgetAssetClass = {
  extension: `.${string}`;
  label: string;
  maxBytes: number;
  maxGzipBytes: number;
};

export type ViteBundleBudgetPolicy = {
  assetsDir: string;
  budgetMode: string;
  budgets: ViteBundleBudgetAssetClass[];
  chunkWarningAssetExtension: ViteBundleBudgetAssetClass['extension'];
  headroomPolicy: string;
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
    },
    {
      extension: '.css',
      label: 'Largest CSS asset',
      maxBytes: 153_600,
      maxGzipBytes: 24_576,
    },
  ],
  chunkWarningAssetExtension: '.js',
  headroomPolicy: 'Temporary monolithic UI headroom; lower after measured chunk splitting.',
  units: 'bytes',
} satisfies ViteBundleBudgetPolicy;

export const getViteChunkSizeWarningLimitKb = (): number => {
  const budget = VITE_BUNDLE_BUDGET_POLICY.budgets.find(
    (candidate) => candidate.extension === VITE_BUNDLE_BUDGET_POLICY.chunkWarningAssetExtension,
  );
  if (budget === undefined) throw new Error('Vite bundle policy is missing the chunk warning asset budget.');
  return Math.ceil(budget.maxBytes / 1024);
};

export const formatBundlePolicyBytes = (bytes: number): string => `${bytes.toLocaleString('en-US')} bytes`;
