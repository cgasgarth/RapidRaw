# RapidRAW Render Baseline

- Snapshot date: 2026-06-10
- Issue: #18 `baseline(render): capture representative baseline screenshots and render outputs`
- Repository: `cgasgarth/RapidRaw`
- Local checkout: `/Users/cgas/Documents/RawEngine/RapidRaw`
- Baseline branch at capture: `codex/baseline-render-evidence`

## Purpose

This document records the current render-testability state before RawEngine starts
changing the frontend runtime, Tauri integration, screenshot harness, or editor
surfaces. It intentionally separates command/build success from actual UI render
evidence.

The current baseline is not a successful browser UI screenshot. It is a captured
failure mode: the Vite dev surface loads HTML but React does not mount outside
the Tauri runtime because app startup calls Tauri window APIs immediately.

## Local Vite Probe

Command:

```sh
npm run dev -- --host 127.0.0.1
```

Observed dev server output:

- Vite started successfully.
- Dev URL: `http://127.0.0.1:1420/`
- The server responded to `curl -I --max-time 5 http://127.0.0.1:1420/`
  with `HTTP/1.1 200 OK`.

Browser probe:

- Tool: Codex in-app Browser, read-only inspection.
- URL opened: `http://127.0.0.1:1420/`
- Page title: `RapidRAW`
- `#root` child count: `0`
- `document.body.innerText`: empty
- DOM snapshot: empty

Artifact:

- [docs/baseline/render/rapidraw-vite-empty-root-2026-06-10.jpg](render/rapidraw-vite-empty-root-2026-06-10.jpg)

The screenshot is intentionally blank because it captures the current browser-only
render failure.

## Console Evidence

The browser console reported this representative error:

```text
TypeError: Cannot read properties of undefined (reading 'metadata')
    at getCurrentWindow (.../@tauri-apps_api_window.js...)
    at TitleBar (.../src/window/TitleBar.tsx:27:20)
```

React then reported that the error occurred in the `<TitleBar>` component. The
root cause is that `TitleBar` calls `getCurrentWindow()` while running in a plain
browser context where Tauri window metadata is unavailable.

## Current Assessment

The existing frontend can be built with Vite, but it cannot currently be used as
a browser-only render baseline. Screenshots taken from `npm run dev` do not
represent the real app UI because the React tree crashes before mounting.

This is acceptable only as a baseline snapshot. It should not become the final
RawEngine validation strategy.

## Follow-Up Requirements

Follow-up #292 defines the real screenshot harness work. That issue should
decide whether RawEngine uses:

- a Tauri-aware smoke harness that launches the desktop app and captures windows;
- a browser-safe app shell with explicit mocks for Tauri APIs and backend invokes;
- component-level visual stories for key panels and modals;
- or a combination of these, with macOS desktop screenshots as the primary gate.

The harness should eventually capture at least these representative states:

- empty library startup;
- folder loaded with supported image thumbnails;
- editor view with one image selected;
- editor view with right-panel adjustment controls visible;
- export panel;
- settings panel;
- existing RapidRAW negative conversion modal;
- future RawEngine Negative Processing Lab UI;
- future layer stack UI;
- future stitching/HDR/super-resolution workflows.

## Validation Policy Implication

Until the screenshot harness exists, CI should not claim a passing visual render
gate. The correct near-term validation is:

- keep command/build gates explicit;
- document the current browser-only render blocker;
- add the screenshot harness as its own small-to-medium PR;
- make visual smoke captures blocking only after they produce meaningful app UI
  artifacts on macOS.
