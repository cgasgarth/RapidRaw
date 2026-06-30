# Frontend Animation Boundary Audit

Issue: #2442

This audit follows the source-map dependency audit in #2402. The current goal is
not to remove animation polish; it is to keep broad animation dependencies from
blocking future bundle work.

## Measurement

Measured with:

```sh
TAURI_ENV_DEBUG=1 bun run build:frontend
bun run bundle:report
```

Current source-map attribution:

| Package         | Source bytes | Source count |
| --------------- | ------------ | ------------ |
| `motion-dom`    | 346,044      | 180          |
| `framer-motion` | 124,885      | 65           |

Repo inventory found 23 imports under `src/components/views`,
`src/components/panel`, `src/components/ui`, and `src/context`. Framer is used
by core editor, library, panel, tooltip, dropdown, and modal surfaces, so no
single lazy boundary can remove it from the initial entry.

## Change In This PR

`src/components/ui/Switch.tsx` no longer imports `framer-motion`. The switch
thumb movement is implemented with a CSS transform transition instead of a
Framer spring.

This is intentionally small:

- it removes one broad shared UI import;
- it preserves the existing checked/unchecked state, disabled behavior, and
  accessible checkbox semantics;
- it avoids starting a larger animation-system rewrite inside a bundle audit PR.

## Follow-Up Policy

- Do not remove `framer-motion` globally until the app has a local animation
  facade or component-level replacement plan.
- Prefer replacing trivial single-property animations with CSS first.
- For larger surfaces, split by route, modal, or right-panel boundary and prove
  the initial-entry impact with `bun run bundle:report`.
- Runtime/UI smoke is required for any changed animated surface.
