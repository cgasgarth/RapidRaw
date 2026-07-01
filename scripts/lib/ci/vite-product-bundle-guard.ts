import { relative, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

type ForbiddenProductBundlePath = {
  path: string;
  reason: string;
};

type ProductBundleGuardViolation = ForbiddenProductBundlePath & {
  importer?: string | undefined;
  source: string;
};

const forbiddenPathPolicies = [
  { pattern: /(?:^|\/)src\/validation\//u, reason: 'validation-only frontend module' },
  { pattern: /(?:^|\/)tests\//u, reason: 'test-only module' },
  { pattern: /(?:^|\/)__tests__\//u, reason: 'test-only module' },
  { pattern: /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/u, reason: 'test-only module' },
  { pattern: /(?:^|\/)scripts\/proofs\//u, reason: 'proof-only script module' },
  { pattern: /(?:^|\/)scripts\/private-raw\//u, reason: 'private raw proof module' },
  { pattern: /(?:^|\/)scripts\/lib\/private-raw\//u, reason: 'private raw proof helper' },
  { pattern: /(?:^|\/)scripts\/lib\/proofs\//u, reason: 'proof-only helper' },
  { pattern: /(?:^|\/)docs\/validation\//u, reason: 'validation evidence artifact' },
  { pattern: /(?:^|\/)fixtures\/validation\//u, reason: 'validation fixture artifact' },
] satisfies { pattern: RegExp; reason: string }[];

export const PRODUCT_BUNDLE_GUARD_POLICY =
  'Product frontend bundles must not import validation, proof, private-proof, or test-only modules.';

export function createViteProductBundleGuardPlugin(root = process.cwd()): Plugin {
  const rootPath = normalizePath(resolve(root));

  return {
    name: 'rapidraw-product-bundle-guard',
    apply: 'build',
    async resolveId(source, importer, options) {
      if (source.startsWith('\0')) return null;

      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (resolved === null) return null;

      const violation = findProductBundleGuardViolation({
        id: resolved.id,
        importer,
        root: rootPath,
        source,
      });
      if (violation !== undefined) this.error(formatProductBundleGuardFailure(violation));

      return null;
    },
  };
}

export function findProductBundleGuardViolation({
  id,
  importer,
  root = process.cwd(),
  source,
}: {
  id: string;
  importer?: string | undefined;
  root?: string;
  source: string;
}): ProductBundleGuardViolation | undefined {
  const forbiddenPath = findForbiddenProductBundlePath(id, root);
  if (forbiddenPath === undefined) return undefined;

  return {
    ...forbiddenPath,
    importer: importer === undefined ? undefined : formatPathForReport(importer, root),
    source,
  };
}

export function findForbiddenProductBundlePath(
  id: string,
  root = process.cwd(),
): ForbiddenProductBundlePath | undefined {
  const reportPath = formatPathForReport(id, root);
  const policy = forbiddenPathPolicies.find(({ pattern }) => pattern.test(reportPath));
  if (policy === undefined) return undefined;

  return {
    path: reportPath,
    reason: policy.reason,
  };
}

export function formatProductBundleGuardFailure(violation: ProductBundleGuardViolation): string {
  const parts = [
    'product bundle guard failed',
    `${violation.path}: ${violation.reason}`,
    violation.importer === undefined ? undefined : `imported by ${violation.importer}`,
    `import source ${JSON.stringify(violation.source)}`,
    PRODUCT_BUNDLE_GUARD_POLICY,
  ].filter((part) => part !== undefined);

  return parts.join(' | ');
}

function formatPathForReport(id: string, root: string): string {
  const withoutQuery = id.split('?')[0] ?? id;
  const normalized = normalizePath(withoutQuery);
  const normalizedRoot = normalizePath(root);
  const relativePath = normalized.startsWith(`${normalizedRoot}/`)
    ? relative(normalizedRoot, normalized).split(sep).join('/')
    : normalized;

  return relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/');
}
