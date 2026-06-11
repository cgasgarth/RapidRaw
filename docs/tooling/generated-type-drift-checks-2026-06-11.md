# Generated Type Drift Checks

Issue: #28

RawEngine now has a drift guard for committed generated type/schema artifacts:

```sh
bun run check:generated-types
```

The current generated surface is the Tauri capability schema snapshot under
`src-tauri/gen/schemas/*.json`. The TypeScript declarations under `src/@types`
are hand-authored compatibility shims, so they are intentionally outside this
manifest until a real generator owns them.

The manifest is stored at `docs/tooling/generated-type-drift-manifest.json` and
records each generated artifact path, artifact kind, generator note, and SHA-256
hash. The check validates the manifest shape with Zod, verifies the inventory is
complete and sorted, and fails if any generated artifact hash changes without an
explicit manifest refresh.

When a Tauri CLI or plugin update intentionally changes these generated schemas,
refresh the manifest with:

```sh
bun run check:generated-types -- --update
```

Then review the generated schema diff and the manifest hash diff together in the
same PR. Future RawEngine command, tool, and edit-graph schema generators should
extend this check instead of adding separate drift policies.
