import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

import { runText } from '../../../scripts/lib/process.ts';

const repoRoot = process.cwd();
const policyPath = resolve(repoRoot, 'docs/ci/dependency-license-policy.json');

const packageReviewSchema = z.object({
  licenses: z.string().min(1),
  reason: z.string().min(1),
});

const policySchema = z.object({
  allowedLicenseExpressions: z.array(z.string().min(1)).min(1),
  reviewedPackages: z.record(z.string(), packageReviewSchema),
  reviewedPackagePatterns: z.array(
    z.object({
      pattern: z.string().min(1),
      licenses: z.string().min(1),
      reason: z.string().min(1),
    }),
  ),
  missingLicenseFileAllowed: z.record(z.string(), z.string().min(1)),
});

const policy = policySchema.parse(JSON.parse(readFileSync(policyPath, 'utf8')));
const allowedLicenses = new Set(policy.allowedLicenseExpressions);
const reviewedPackagePatterns = policy.reviewedPackagePatterns.map((review) => ({
  ...review,
  regex: new RegExp(review.pattern, 'u'),
}));

const scanOutput = runText(
  resolve(repoRoot, 'node_modules/.bin/license-checker-rseidelsohn'),
  ['--json', '--excludePrivatePackages'],
  { cwd: repoRoot },
);

const dependencyLicenses = z
  .record(
    z.string(),
    z.object({
      licenses: z.union([z.string(), z.array(z.string())]),
      licenseFile: z.string().optional(),
    }),
  )
  .parse(JSON.parse(scanOutput));

const failures = [];
const reviewedHits = [];

for (const [packageKey, metadata] of Object.entries(dependencyLicenses).sort()) {
  const licenseExpression = Array.isArray(metadata.licenses) ? metadata.licenses.join(' OR ') : metadata.licenses;
  const reviewedPackage = policy.reviewedPackages[packageKey];
  const reviewedPackagePattern = reviewedPackagePatterns.find(({ regex }) => regex.test(packageKey));

  if (!licenseExpression || licenseExpression.toLowerCase().includes('unknown')) {
    failures.push(`${packageKey}: unknown license expression "${licenseExpression}"`);
    continue;
  }

  if (reviewedPackage) {
    if (reviewedPackage.licenses !== licenseExpression) {
      failures.push(
        `${packageKey}: reviewed license changed from "${reviewedPackage.licenses}" to "${licenseExpression}"`,
      );
    } else {
      reviewedHits.push(packageKey);
    }
  } else if (reviewedPackagePattern) {
    if (reviewedPackagePattern.licenses !== licenseExpression) {
      failures.push(
        `${packageKey}: reviewed pattern ${reviewedPackagePattern.pattern} expected "${reviewedPackagePattern.licenses}" but found "${licenseExpression}"`,
      );
    } else {
      reviewedHits.push(packageKey);
    }
  } else if (!allowedLicenses.has(licenseExpression)) {
    failures.push(`${packageKey}: unreviewed license expression "${licenseExpression}"`);
  }

  if (!metadata.licenseFile && !policy.missingLicenseFileAllowed[packageKey]) {
    failures.push(`${packageKey}: missing license file`);
  }
}

for (const packageKey of Object.keys(policy.reviewedPackages)) {
  if (!dependencyLicenses[packageKey]) {
    failures.push(`${packageKey}: reviewed package is no longer present`);
  }
}

if (failures.length > 0) {
  console.error('JavaScript dependency license check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Validated ${Object.keys(dependencyLicenses).length} JavaScript package licenses ` +
    `with ${reviewedHits.length} reviewed package exceptions.`,
);
