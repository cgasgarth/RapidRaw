# Frontend Bundle Dependency Audit

Issue: #2402

This audit uses the source-map attribution flow from
[Vite bundle budget](vite-bundle-budget-2026-06-11.md) to identify large
third-party contributors before new UI work expands the monolithic frontend
chunk further.

## Measurement

Measured with:

```sh
TAURI_ENV_DEBUG=1 bun run build:frontend
bun run bundle:report
```

Report artifact:

```text
artifacts/bundle-report/vite-bundle-report.json
```

Top package contributors from the diagnostic source-map report:

| Package            | Source bytes | Source count | Classification      | Action                                                                        |
| ------------------ | ------------ | ------------ | ------------------- | ----------------------------------------------------------------------------- |
| `simple-icons`     | 5,230,303    | 1            | Replace/remove      | Replace the single GitHub icon import, then remove the dependency.            |
| `react-dom`        | 545,403      | 4            | Keep                | Core React renderer; not a size-reduction target.                             |
| `konva`            | 427,439      | 58           | Keep, monitor split | Required by the editor canvas through `react-konva`; split only with proof.   |
| `react-reconciler` | 408,709      | 4            | Keep                | Pulled by canvas/render stack; removing is not a near-term dependency action. |
| `motion-dom`       | 346,044      | 180          | Investigate         | Wide animation surface; reduce or lazy-load by UI boundary when measured.     |
| `zod`              | 271,439      | 17           | Keep                | Runtime schema validation is project policy; avoid weakening validation.      |
| `@clerk/shared`    | 221,085      | 27           | Investigate         | Auth/AI gating surface; evaluate lazy-loading or replacement separately.      |
| `@tauri-apps/api`  | 126,621      | 8            | Keep                | Desktop bridge dependency.                                                    |
| `@clerk/react`     | 125,393      | 4            | Investigate         | Used by app/provider and AI/settings panels; audit with auth product scope.   |
| `framer-motion`    | 124,885      | 65           | Investigate         | See `motion-dom`; optimize by feature boundary rather than blanket removal.   |
| `@dnd-kit/core`    | 104,325      | 1            | Investigate         | Audit drag/drop surfaces for lazy-loading if not needed on initial entry.     |
| `lucide-react`     | 91,459       | 139          | Keep, monitor       | Icon usage is broad; source-map bytes may overstate minified retained cost.   |

## Findings

`simple-icons` is the clearest immediate cleanup. The app imports only
`siGithub` in `src/components/panel/CommunityPage.tsx`, but the source-map
report attributes 5,230,303 source bytes to `node_modules/simple-icons/index.mjs`.
This should be replaced with a local GitHub mark or another already-present icon
source, then `simple-icons` should be removed from `package.json`. This is
tracked by #2441.

The React renderer stack, Tauri API, and Zod are not removal targets. They map to
core runtime behavior or current validation policy, so shrinking them by removal
would trade away product or quality foundations.

Konva is used by `src/components/panel/editor/ImageCanvas.tsx` through
`react-konva`. Future optimization should be tied to the first oversized UI
boundary split rather than handled as a direct dependency removal.

Clerk, Framer Motion, and DnD Kit deserve separate, measured follow-up issues.
Each is user-visible or product-scope-sensitive enough that removal should be
driven by runtime behavior, not package size alone. Animation boundaries are
tracked by #2442, DnD Kit by #2443, and Clerk by #2444.

## Follow-Up Policy

- Create one-PR issues only for changes with clear size benefit and bounded
  behavior risk.
- Prove dependency removals with `bun install --frozen-lockfile`,
  focused type/lint checks for touched files, and `bun run check:bundle`.
- For size-focused changes, include `bun run bundle:report` output or a
  `bun run bundle:diff` artifact when a baseline report is available.
- Do not count a source-map-only audit as runtime feature completion.
