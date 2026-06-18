# Visual Smoke Harness

Issue: #292 `validation(render): add macOS screenshot harness for Tauri UI`

## Harness Architecture

This first visual smoke slice uses the component-story path from the render
baseline follow-up requirements. It uses a separate Vite HTML entry so it does
not import the production `App` tree, because the production shell still requires
Tauri window metadata and backend invokes during startup.

The harness entry is:

```text
http://127.0.0.1:1420/visual-smoke.html?scenario=empty-library
```

`visual-smoke.html` loads `src/validation/visual/main.tsx`, which renders
`src/validation/visual/VisualSmokeApp.tsx`. The normal `index.html` entry and
`src/main.tsx` remain production-only.

## Local Command

```sh
bun run check:visual-smoke
```

Focused PR lane:

```sh
bun run check:visual-smoke:pr
```

The PR lane runs only the deterministic `empty-library` browser smoke path.
Local measurement on 2026-06-18 was 9.4s wall time after dependencies were
present.

The command:

1. starts Vite through Bun on `127.0.0.1:1420`;
2. opens the visual-smoke URL with Playwright Chromium;
3. waits for `data-visual-smoke-ready="true"`;
4. verifies that the library, viewer, adjustment, and filmstrip sections exist;
5. captures `artifacts/visual-smoke/empty-library-1x.png`;
6. captures `artifacts/visual-smoke/empty-library-2x.png` at
   `deviceScaleFactor: 2`;
7. verifies PNG dimensions match the requested viewport and device scale;
8. shuts down the local dev server.

If Chromium has not been installed locally, run:

```sh
bunx playwright install chromium
```

## CI Behavior

The required PR baseline includes `frontend: PR visual smoke`. It runs in
parallel with the other PR jobs, installs Playwright Chromium, executes
`bun run check:visual-smoke:pr`, and uploads screenshots only on failure to keep
successful logs compact.

The manual `Image Quality Regression` workflow now includes a macOS
`visual-smoke` job. It installs Playwright Chromium, runs
`bun run check:visual-smoke`, and uploads `artifacts/visual-smoke/*.png` as a
short-retention artifact.

This is intentionally non-required while the harness is component-story based.
It should become required only after the project has a stable policy for real
Tauri-window screenshots, browser-safe mocks, or a combined visual validation
matrix.

## Captured State

Current state covered:

- empty-library startup shell;
- library navigation surface;
- editor preview placeholder;
- adjustment panel surface;
- filmstrip row.
- standard 1x screenshot dimensions;
- high-DPI 2x screenshot dimensions.

## Known Limitations

- This is not yet a native Tauri window capture.
- It does not load a real image fixture.
- It does not prove backend invoke behavior.
- It does not compare against golden images.

Follow-up work should add fixture-backed editor screenshots, settings/export
screens, modal screenshots, and eventually a Tauri-window capture path for macOS.
