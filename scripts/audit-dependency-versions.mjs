#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const npmRegistryUrl = 'https://registry.npmjs.org';
const cratesRegistryUrl = 'https://crates.io/api/v1/crates';
const defaultEcosystem = 'all';

const args = new Set(process.argv.slice(2));
const ecosystemArg = process.argv.find((arg) => arg.startsWith('--ecosystem='));
const ecosystem = ecosystemArg?.split('=')[1] ?? defaultEcosystem;
const formatArg = process.argv.find((arg) => arg.startsWith('--format='));
const format = formatArg?.split('=')[1] ?? 'markdown';
const failOnMajor = args.has('--fail-on-major');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const readText = (path) => readFileSync(path, 'utf8');

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const parseVersionParts = (version) => {
  const match = version.trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/u);
  if (!match) return undefined;

  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? '0'),
    patch: Number(match[3] ?? '0'),
    raw: `${match[1]}.${match[2] ?? '0'}.${match[3] ?? '0'}`,
  };
};

const coerceVersion = (range) => {
  const match = range.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/u);
  if (!match) return undefined;

  return parseVersionParts(`${match[1]}.${match[2] ?? '0'}.${match[3] ?? '0'}`);
};

const compareVersions = (left, right) =>
  left.major - right.major || left.minor - right.minor || left.patch - right.patch;

const isStableVersion = (version) => /^\d+(?:\.\d+){1,2}$/u.test(version);

const latestVersion = (versions) => versions.toSorted(compareVersions).at(-1);

const versionToString = (version) => version?.raw ?? 'unavailable';

const latestVersionString = (versions) => {
  const parsedVersions = versions.map((version) => ({ parsed: parseVersionParts(version), raw: version }));
  return parsedVersions
    .toSorted((left, right) => {
      if (left.parsed && right.parsed) return compareVersions(left.parsed, right.parsed);
      return left.raw.localeCompare(right.raw);
    })
    .at(-1)?.raw;
};

const fetchJson = async (url) => {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'RawEngine-dependency-version-audit/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status} ${response.statusText}`);
  }

  return response.json();
};

const mapWithConcurrency = async (items, limit, mapper) => {
  const results = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
};

const getBunLockedVersion = (lockText, packageName) => {
  const packagePattern = escapeRegExp(packageName);
  const packageEntryPattern = new RegExp(String.raw`^\s+"${packagePattern}": \["${packagePattern}@([^"]+)"`, 'mu');
  return lockText.match(packageEntryPattern)?.[1];
};

const getNpmCompatibleVersion = (declaredRange, versions, currentVersion) => {
  const minimum = coerceVersion(declaredRange) ?? currentVersion;
  if (!minimum) return undefined;

  if (declaredRange.trim().startsWith('=')) {
    return versions.find((version) => compareVersions(version, minimum) === 0);
  }

  if (declaredRange.trim().startsWith('~')) {
    return latestVersion(
      versions.filter(
        (version) =>
          version.major === minimum.major && version.minor === minimum.minor && compareVersions(version, minimum) >= 0,
      ),
    );
  }

  if (declaredRange.trim().startsWith('^') || /^\d/u.test(declaredRange.trim())) {
    return latestVersion(
      versions.filter((version) => version.major === minimum.major && compareVersions(version, minimum) >= 0),
    );
  }

  return latestVersion(versions);
};

const auditNpmDependencies = async () => {
  const packageJson = readJson(join(repoRoot, 'package.json'));
  const bunLockText = readText(join(repoRoot, 'bun.lock'));
  const dependencyGroups = [
    ['dependencies', packageJson.dependencies ?? {}],
    ['devDependencies', packageJson.devDependencies ?? {}],
  ];
  const dependencies = dependencyGroups.flatMap(([scope, group]) =>
    Object.entries(group).map(([name, declaredRange]) => ({ declaredRange, name, scope })),
  );

  const rows = await mapWithConcurrency(dependencies, 8, async (dependency) => {
    const metadata = await fetchJson(`${npmRegistryUrl}/${encodeURIComponent(dependency.name)}`);
    const stableVersions = Object.keys(metadata.versions ?? {})
      .filter(isStableVersion)
      .map(parseVersionParts)
      .filter(Boolean);
    const currentRaw = getBunLockedVersion(bunLockText, dependency.name);
    const currentVersion = currentRaw ? parseVersionParts(currentRaw) : coerceVersion(dependency.declaredRange);
    const latestStableMajor = latestVersion(stableVersions);
    const latestStableMinor = latestVersion(
      stableVersions.filter((version) => currentVersion && version.major === currentVersion.major),
    );
    const latestCompatible = getNpmCompatibleVersion(dependency.declaredRange, stableVersions, currentVersion);

    return {
      current: currentRaw ?? versionToString(currentVersion),
      declared: dependency.declaredRange,
      ecosystem: 'npm',
      latestCompatible: versionToString(latestCompatible),
      latestStableMajor: versionToString(latestStableMajor),
      latestStableMinor: versionToString(latestStableMinor),
      majorIssueTitle:
        currentVersion && latestStableMajor && latestStableMajor.major > currentVersion.major
          ? `deps(major): migrate npm/${dependency.name} to ${latestStableMajor.major}`
          : '',
      name: dependency.name,
      releaseNotes: `https://www.npmjs.com/package/${dependency.name}?activeTab=versions`,
      scope: dependency.scope,
    };
  });

  return rows.toSorted((left, right) => left.name.localeCompare(right.name));
};

const parseCargoManifestDependencies = () => {
  const cargoToml = readText(join(repoRoot, 'src-tauri', 'Cargo.toml'));
  const dependencies = [];
  let section = '';

  for (const rawLine of cargoToml.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const sectionMatch = line.match(/^\[(.+)\]$/u);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }

    if (!section.endsWith('dependencies')) continue;

    const nameMatch = line.match(/^([A-Za-z0-9_-]+)\s*=/u);
    if (!nameMatch) continue;

    const versionMatch = line.match(/version\s*=\s*"([^"]+)"/u) ?? line.match(/=\s*"([^"]+)"/u);
    if (!versionMatch) {
      dependencies.push({
        declaredRange: 'git/path dependency',
        name: nameMatch[1],
        scope: section,
        skipReason: 'no crates.io version in Cargo.toml',
      });
      continue;
    }

    if (!coerceVersion(versionMatch[1]) || versionMatch[1].includes('://')) {
      dependencies.push({
        declaredRange: versionMatch[1],
        name: nameMatch[1],
        scope: section,
        skipReason: 'no stable crates.io version in Cargo.toml',
      });
      continue;
    }

    dependencies.push({
      declaredRange: versionMatch[1],
      name: nameMatch[1],
      scope: section,
    });
  }

  return dependencies;
};

const parseCargoLockedVersions = () => {
  const lockText = readText(join(repoRoot, 'src-tauri', 'Cargo.lock'));
  const versionsByName = new Map();
  let currentName = '';
  let currentVersion = '';

  for (const rawLine of lockText.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === '[[package]]') {
      if (currentName && currentVersion) {
        const versions = versionsByName.get(currentName) ?? [];
        versions.push(currentVersion);
        versionsByName.set(currentName, versions);
      }
      currentName = '';
      currentVersion = '';
      continue;
    }

    currentName = line.match(/^name = "([^"]+)"/u)?.[1] ?? currentName;
    currentVersion = line.match(/^version = "([^"]+)"/u)?.[1] ?? currentVersion;
  }

  if (currentName && currentVersion) {
    const versions = versionsByName.get(currentName) ?? [];
    versions.push(currentVersion);
    versionsByName.set(currentName, versions);
  }

  return versionsByName;
};

const getCargoCompatibleVersion = (declaredRange, versions, currentVersion) => {
  if (declaredRange.trim().startsWith('=')) {
    return versions.find((version) => currentVersion && compareVersions(version, currentVersion) === 0);
  }

  const minimum = coerceVersion(declaredRange) ?? currentVersion;
  if (!minimum) return undefined;

  if (minimum.major === 0 && minimum.minor === 0) {
    return latestVersion(versions.filter((version) => version.major === 0 && version.minor === 0));
  }

  if (minimum.major === 0) {
    return latestVersion(
      versions.filter(
        (version) => version.major === 0 && version.minor === minimum.minor && compareVersions(version, minimum) >= 0,
      ),
    );
  }

  return latestVersion(
    versions.filter((version) => version.major === minimum.major && compareVersions(version, minimum) >= 0),
  );
};

const auditCargoDependencies = async () => {
  const dependencies = parseCargoManifestDependencies();
  const lockedVersions = parseCargoLockedVersions();

  const rows = await mapWithConcurrency(dependencies, 6, async (dependency) => {
    if (dependency.skipReason) {
      return {
        current: 'unavailable',
        declared: dependency.declaredRange,
        ecosystem: 'cargo',
        latestCompatible: 'skipped',
        latestStableMajor: 'skipped',
        latestStableMinor: 'skipped',
        majorIssueTitle: '',
        name: dependency.name,
        releaseNotes: '',
        scope: dependency.scope,
        skipReason: dependency.skipReason,
      };
    }

    const metadata = await fetchJson(`${cratesRegistryUrl}/${encodeURIComponent(dependency.name)}`);
    const stableVersions = (metadata.versions ?? [])
      .filter((version) => !version.yanked && isStableVersion(version.num))
      .map((version) => parseVersionParts(version.num))
      .filter(Boolean);
    const currentRaw = latestVersionString(lockedVersions.get(dependency.name) ?? []);
    const currentVersion = currentRaw ? parseVersionParts(currentRaw) : coerceVersion(dependency.declaredRange);
    const latestStableMajor = latestVersion(stableVersions);
    const latestStableMinor = latestVersion(
      stableVersions.filter((version) => currentVersion && version.major === currentVersion.major),
    );
    const latestCompatible = getCargoCompatibleVersion(dependency.declaredRange, stableVersions, currentVersion);

    return {
      current: currentRaw ?? versionToString(currentVersion),
      declared: dependency.declaredRange,
      ecosystem: 'cargo',
      latestCompatible: versionToString(latestCompatible),
      latestStableMajor: versionToString(latestStableMajor),
      latestStableMinor: versionToString(latestStableMinor),
      majorIssueTitle:
        currentVersion && latestStableMajor && latestStableMajor.major > currentVersion.major
          ? `deps(major): migrate cargo/${dependency.name} to ${latestStableMajor.major}`
          : '',
      name: dependency.name,
      releaseNotes: `https://crates.io/crates/${dependency.name}/versions`,
      scope: dependency.scope,
    };
  });

  return rows.toSorted((left, right) => left.name.localeCompare(right.name) || left.scope.localeCompare(right.scope));
};

const renderTable = (title, rows) => {
  const majorRows = rows.filter((row) => row.majorIssueTitle);
  const skippedRows = rows.filter((row) => row.skipReason);
  const lines = [
    `## ${title}`,
    '',
    `- Packages checked: ${rows.length}`,
    `- Major migrations found: ${majorRows.length}`,
    `- Skipped non-registry dependencies: ${skippedRows.length}`,
    '',
    '| Package | Scope | Declared | Current | Latest compatible | Latest stable minor | Latest stable major | Major issue |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const row of rows) {
    const packageLabel = row.releaseNotes ? `[${row.name}](${row.releaseNotes})` : row.name;
    lines.push(
      `| ${packageLabel} | ${row.scope} | \`${row.declared}\` | \`${row.current}\` | \`${row.latestCompatible}\` | \`${row.latestStableMinor}\` | \`${row.latestStableMajor}\` | ${row.majorIssueTitle || ''} |`,
    );
  }

  if (majorRows.length > 0) {
    lines.push('', '### Major-version follow-up issues', '');
    for (const row of majorRows) {
      lines.push(
        `- \`${row.majorIssueTitle}\`: include migration notes, breaking-change links, validation commands, CI expectations, rollback notes, and package-family coupling.`,
      );
    }
  }

  if (skippedRows.length > 0) {
    lines.push('', '### Skipped non-registry dependencies', '');
    for (const row of skippedRows) {
      lines.push(`- ${row.name} (${row.scope}): ${row.skipReason}`);
    }
  }

  return lines.join('\n');
};

const run = async () => {
  if (!['all', 'js', 'rust'].includes(ecosystem)) {
    throw new Error(`Unsupported --ecosystem=${ecosystem}; expected all, js, or rust.`);
  }

  if (!['json', 'markdown'].includes(format)) {
    throw new Error(`Unsupported --format=${format}; expected json or markdown.`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    js: ecosystem === 'all' || ecosystem === 'js' ? await auditNpmDependencies() : [],
    rust: ecosystem === 'all' || ecosystem === 'rust' ? await auditCargoDependencies() : [],
  };

  if (format === 'json') {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const sections = ['# RawEngine Dependency Version Audit', '', `Generated at: ${report.generatedAt}`];
    if (report.js.length > 0) sections.push('', renderTable('JavaScript/Bun Package Versions', report.js));
    if (report.rust.length > 0) sections.push('', renderTable('Rust/Cargo Crate Versions', report.rust));
    console.log(sections.join('\n'));
  }

  const majorCount = [...report.js, ...report.rust].filter((row) => row.majorIssueTitle).length;
  if (failOnMajor && majorCount > 0) {
    throw new Error(`Found ${majorCount} major-version migration candidate(s).`);
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
