import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const policyPath = resolve(repoRoot, 'docs/ci/dependency-license-policy.json');

const packageReviewSchema = z.object({
  licenses: z.string().min(1),
  reason: z.string().min(1),
});

const policySchema = z.object({
  allowedLicenseExpressions: z.array(z.string().min(1)).min(1),
  reviewedPackages: z.record(z.string(), packageReviewSchema),
  missingLicenseFileAllowed: z.record(z.string(), z.string().min(1)),
});

const policy = policySchema.parse(JSON.parse(readFileSync(policyPath, 'utf8')));
const allowedLicenses = new Set(policy.allowedLicenseExpressions);

const scanOutput = execFileSync(
  resolve(repoRoot, 'node_modules/.bin/license-checker-rseidelsohn'),
  ['--json', '--excludePrivatePackages'],
  { cwd: repoRoot, encoding: 'utf8' },
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

for (const packageKey of Object.keys(policy.missingLicenseFileAllowed)) {
  if (!dependencyLicenses[packageKey]) {
    failures.push(`${packageKey}: missing-license-file exception is no longer present`);
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
