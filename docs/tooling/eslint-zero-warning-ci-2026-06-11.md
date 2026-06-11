# ESLint Zero-Warning CI

Issue: #36

RawEngine now treats ESLint warnings as CI failures through the dedicated strict
lint command:

```sh
bun run check:lint
```

The PR workflow runs that command in the `frontend: eslint zero warnings` job.
The job is dispatched independently with the other fast validation jobs, and the
`PR CI / required` aggregate waits for it by name.

This policy depends on #286 removing the current RapidRAW ESLint baseline debt.
After that cleanup is merged, new warnings or errors should fail locally through
`bun run check:lint`, fail staged commits through the pre-commit hook for staged
JavaScript and TypeScript files, and fail PR CI through this job.
