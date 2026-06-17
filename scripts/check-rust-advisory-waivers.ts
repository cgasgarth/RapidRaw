#!/usr/bin/env bun
// @ts-check

import { readFileSync } from 'node:fs';

const LEDGER_PATH = 'docs/security/rust-advisory-waivers.json';
const PACKAGE_PATH = 'package.json';
const WORKFLOW_PATH = '.github/workflows/lint.yml';
const UPCOMING_REVIEW_DAYS = 30;
const REQUIRED_FIELDS = [
  'advisoryId',
  'ghsaId',
  'crate',
  'reason',
  'owner',
  'introducedDate',
  'reviewDate',
  'expiryDate',
  'issue',
];

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const isIsoDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

const parseDate = (value, field, advisoryId) => {
  if (!isIsoDate(value)) {
    throw new Error(`${advisoryId} has invalid ${field}: expected YYYY-MM-DD`);
  }
  return new Date(`${value}T00:00:00Z`);
};

const collectIgnores = (text) => [...text.matchAll(/--ignore\s+([A-Z]+SEC-\d{4}-\d{4})/g)].map((match) => match[1]);

const unique = (values) => [...new Set(values)].sort();

const validateLedgerObject = (ledger, now = new Date()) => {
  if (ledger.schemaVersion !== 1 || !Array.isArray(ledger.waivers)) {
    throw new Error('rust advisory waiver ledger must use schemaVersion 1 and a waivers array');
  }

  const seen = new Set();
  const upcoming = [];

  for (const waiver of ledger.waivers) {
    for (const field of REQUIRED_FIELDS) {
      if (waiver[field] === undefined || waiver[field] === '') {
        throw new Error(`${waiver.advisoryId ?? 'unknown advisory'} missing ${field}`);
      }
    }

    if (seen.has(waiver.advisoryId)) {
      throw new Error(`${waiver.advisoryId} appears more than once`);
    }
    seen.add(waiver.advisoryId);

    const reviewDate = parseDate(waiver.reviewDate, 'reviewDate', waiver.advisoryId);
    const expiryDate = parseDate(waiver.expiryDate, 'expiryDate', waiver.advisoryId);
    parseDate(waiver.introducedDate, 'introducedDate', waiver.advisoryId);

    if (expiryDate <= now) {
      throw new Error(`${waiver.advisoryId} waiver expired on ${waiver.expiryDate}`);
    }
    if (reviewDate > expiryDate) {
      throw new Error(`${waiver.advisoryId} reviewDate must be on or before expiryDate`);
    }

    const daysUntilReview = Math.ceil((reviewDate.getTime() - now.getTime()) / 86_400_000);
    if (daysUntilReview >= 0 && daysUntilReview <= UPCOMING_REVIEW_DAYS) {
      upcoming.push(`${waiver.advisoryId} review ${waiver.reviewDate}`);
    }
  }

  return { advisoryIds: unique([...seen]), upcoming };
};

const validateLedger = (now = new Date()) => validateLedgerObject(readJson(LEDGER_PATH), now);

const validateConfiguredIgnores = (advisoryIds) => {
  const expected = advisoryIds.join(',');
  const packageJson = readJson(PACKAGE_PATH);
  const configured = unique([
    ...collectIgnores(packageJson.scripts?.['check:security:rust'] ?? ''),
    ...collectIgnores(readFileSync(WORKFLOW_PATH, 'utf8')),
  ]);

  if (configured.join(',') !== expected) {
    throw new Error(
      `cargo-audit ignores differ from ledger: configured=${configured.join(',') || 'none'} ledger=${expected || 'none'}`,
    );
  }
};

const expectSelfTestError = (name, fn, expectedFragment) => {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(expectedFragment)) return;
    throw new Error(`${name}: expected "${expectedFragment}", got "${message}"`);
  }

  throw new Error(`${name}: expected validation failure`);
};

const runSelfTest = () => {
  const ignores = collectIgnores('cargo audit --ignore RUSTSEC-2024-0429 --ignore RUSTSEC-2026-0001');
  if (ignores.join(',') !== 'RUSTSEC-2024-0429,RUSTSEC-2026-0001') {
    throw new Error('self-test failed: ignore parser missed cargo-audit flags');
  }

  const now = new Date('2026-06-15T00:00:00Z');
  const validLedger = {
    schemaVersion: 1,
    waivers: [
      {
        advisoryId: 'RUSTSEC-2024-0429',
        ghsaId: 'GHSA-wrw7-89jp-8q8g',
        crate: 'glib',
        reason: 'Target-filtered dependency graph remediation is tracked separately.',
        owner: '@cgasgarth',
        introducedDate: '2026-06-11',
        reviewDate: '2026-09-15',
        expiryDate: '2026-12-15',
        issue: 262,
      },
    ],
  };

  const result = validateLedgerObject(validLedger, now);
  if (result.advisoryIds.join(',') !== 'RUSTSEC-2024-0429') {
    throw new Error('self-test failed: valid ledger was not accepted');
  }

  expectSelfTestError(
    'missing field',
    () =>
      validateLedgerObject(
        {
          ...validLedger,
          waivers: validLedger.waivers.map(({ owner: _owner, ...waiver }) => waiver),
        },
        now,
      ),
    'missing owner',
  );

  expectSelfTestError(
    'expired waiver',
    () =>
      validateLedgerObject(
        {
          ...validLedger,
          waivers: validLedger.waivers.map((waiver) => ({ ...waiver, expiryDate: '2026-01-01' })),
        },
        now,
      ),
    'expired',
  );

  console.log('rust advisory waiver self-test ok');
};

if (process.argv.includes('--self-test')) {
  runSelfTest();
  process.exit(0);
}

try {
  const result = validateLedger();
  validateConfiguredIgnores(result.advisoryIds);
  const suffix = result.upcoming.length > 0 ? `; upcoming: ${result.upcoming.join(', ')}` : '';
  console.log(`rust advisory waivers ok (${result.advisoryIds.length})${suffix}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
