# Release Notes Automation

- Date: 2026-06-13
- Issue: #252 `release(notes): add release notes automation`
- Workflow: `.github/workflows/release.yml`
- Script: `scripts/release/generate-release-notes.ts`

## Purpose

RawEngine releases need reviewable notes before updater manifests, public
downloads, or notarized artifacts become user-facing. Release notes also give
the final local review page and release checklist a machine-generated summary
of visible changes, validation work, dependencies, and packaging changes.

This automation adds a conservative first release-notes path without changing
release bodies automatically.

## Inputs

The generator consumes JSON shaped like GitHub CLI pull request output:

```bash
gh pr list \
  --state merged \
  --base main \
  --limit 100 \
  --json number,title,mergedAt,url,author,labels
```

The script validates the JSON with Zod before rendering notes. Invalid pull
request metadata fails the command instead of producing partial release notes.

## Output

The generated Markdown includes:

- the release title and generation timestamp;
- total merged pull request count after filtering;
- summary counts by section;
- grouped pull request entries with PR links and authors.

The current sections are:

- Breaking Changes
- Features
- Fixes
- Validation And CI
- Security
- Release And Packaging
- Docs
- Other

## Workflow Behavior

The release workflow has a separate `release-notes` job that starts at the same
time as the packaging matrix. It does not make the platform builds wait for
notes generation.

For `workflow_dispatch` dry runs, the job uploads `release-notes.md` as a
workflow artifact. For GitHub `release` events, the job attaches
`release-notes.md` to the release as a release asset with `gh release upload
--clobber`.

The workflow intentionally does not rewrite the release body yet. Body updates
should wait until channel policy, versioning, and manual approval rules are
settled.

## Local Commands

Run the self-test:

```bash
bun run check:release-notes
```

Generate notes from a local pull request JSON file:

```bash
bun run release:notes -- \
  --input /path/to/merged-pull-requests.json \
  --output /path/to/release-notes.md \
  --title "RapidRaw v0.1.0 release notes"
```

Filter to a date range:

```bash
bun run release:notes -- \
  --input /path/to/merged-pull-requests.json \
  --output /path/to/release-notes.md \
  --since 2026-06-01T00:00:00Z
```

## Current Limits

- The first workflow uses the last 100 merged PRs into `main` because previous
  release tags are not established yet.
- Release body updates are intentionally deferred.
- Human curation is still required before public release notes are treated as
  final user-facing copy.
- Category assignment uses PR labels and conventional title prefixes. It should
  be revised if the repo changes labeling conventions.

## Validation

- `bun run check:release-notes` runs a synthetic fixture through the Zod parser,
  date filter, grouping logic, Markdown writer, and output assertions.
- `bun run check:quick` includes the release-notes self-test.
- `bun run check:actions` validates the release workflow syntax and action pin
  policy.
