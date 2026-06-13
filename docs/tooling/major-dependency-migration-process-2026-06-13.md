# Major Dependency Migration Process

Issue: #974

## Contract

RawEngine should target latest stable major and minor versions, but major
dependency and toolchain updates must stay visible, reviewable, and reversible.
A broad lockfile refresh must not hide breaking migrations.

This process applies to:

- JavaScript and Bun packages.
- Rust crates, including Cargo `0.x` semver-incompatible minor or patch jumps.
- GitHub Actions pins.
- Node, Bun, Tauri, Rust toolchain, and validation CLIs.

## Discovery

Major-version discovery is owned by #973. The dependency freshness report should
identify:

- current installed version;
- latest compatible patch or minor target;
- latest stable major target;
- upstream release notes or migration guide when practical;
- whether a matching major migration issue already exists.

The report must not mutate lockfiles in check mode. It can fail, warn, or emit a
machine-readable finding when a major target does not have an issue.

## Issue Rule

Every discovered major update needs a dedicated issue before implementation
starts.

Use this title format:

```text
deps(major): migrate <ecosystem>/<package> to <major>
```

Examples:

- `deps(major): migrate npm/eslint to 10`
- `deps(major): migrate npm/@eslint/js to 10`
- `deps(major): migrate cargo/glam to 0.33`

Known major-tracking issues at the time this policy was added:

- #945 `deps(major): migrate npm/eslint to 10`
- #946 `deps(major): migrate npm/@eslint/js to 10`
- #959 `deps(major): migrate cargo/glam to 0.33`
- #960 `deps(major): migrate cargo/imageproc to 0.27`
- #962 `deps(major): migrate cargo/ndarray to 0.17`
- #963 `deps(major): migrate cargo/nalgebra to 0.35`

## Required Issue Fields

Each major migration issue should include:

- current version and target version;
- ecosystem and package owner;
- upstream changelog, release notes, or migration guide links when available;
- expected API, config, build, lockfile, or runtime changes;
- impacted source paths and CI jobs;
- local validation commands;
- expected GitHub Actions gates;
- rollback notes;
- known blockers;
- whether the package can move alone or must move with a compatibility group.

If upstream does not publish useful migration notes, the issue should say so and
link the best available source, such as a release tag, changelog diff, or
repository compare view.

## Compatibility Groups

One issue per package is the default. A compatibility-group issue is allowed
only when packages must move together to keep peer dependencies, generated
types, toolchain contracts, or runtime APIs coherent.

Compatibility-group issues must list:

- every package in the group;
- why separate PRs would be unsafe or misleading;
- the smallest practical migration boundary;
- per-package validation risks;
- follow-up issues for any package-specific cleanup that should not be bundled.

## PR Requirements

Major dependency PRs should:

- reference the matching major migration issue;
- avoid unrelated formatting or feature work;
- update docs when contributor commands or validation behavior changes;
- include local validation evidence in the PR body;
- keep rollback simple, preferably by reverting the dependency/config changes in
  one PR;
- rerun the dependency audit after the bump and record whether new major targets
  appeared.

Patch and minor refresh PRs may proceed separately, but they must link any
remaining major issues instead of bundling those migrations into a broad update.

## Validation

Before merging changes to this process, run:

```sh
bun install --frozen-lockfile
bun run docs:check
git diff --check
```

When #973 lands, major migration PRs should also run the dependency freshness
audit command it defines.
