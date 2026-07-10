# Editor UI Parity Contract

## Purpose

This contract defines the shared visual and interaction foundation for the RapidRaw editor. It is an original, clean-room implementation: contributors may learn from broad professional-photo-editor workflows, but must not copy proprietary source code, screenshots, exact extracted measurements, icons, labels, presets, assets, or brand treatment.

The contract prevents individual editor changes from creating competing layout, density, and state conventions. It is not a marketing comparison or a screenshot specification.

## Responsibility Split

| Concern                                               | Reference responsibility                                  | RapidRaw rule                                                                                                                                   |
| ----------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Outer editor geometry and image workspace             | Lightroom Classic Develop-style composition               | Keep a dedicated left workflow column, a dominant central viewer, a right editing region, restrained top/bottom chrome, and a bottom filmstrip. |
| Tool navigation, inspector density, layers, and masks | Capture One-style compact tool tabs and dense tool stacks | Use compact desktop rows, stable tool rails, scan-friendly section headers, and explicit active state.                                          |
| RapidRaw-only capabilities                            | RapidRaw                                                  | Keep Agent, Film, Negative Lab, AI/object masks, computational tools, proof diagnostics, and future editor tools in the shared editor chrome.   |

## Region Ownership

- **Workspace shell:** owns the editor scope, workspace matte, panel geometry, and desktop/compact breakpoints.
- **Viewer:** owns the viewer matte, image frame, floating HUDs, drag overlays, Fit/100% context, and render-state messaging. It does not own adjustment-panel styling.
- **Left workflow column:** owns navigation and workflow context only. It must not become a second inspector.
- **Right rail and inspector:** own tool selection, disclosure sections, compact rows, numeric controls, layers, and masks.
- **Top toolbar:** owns file, compare, history, and workspace actions.
- **Filmstrip:** owns image selection and its own expanded/collapsed geometry; it does not set viewer or inspector density.

Library, Community, Settings, and non-editor modal workflows are outside this contract.

## Token Contract

Editor-only values are scoped by `.editor-workspace` in production and `.editor-visual-fixture` in visual smoke. `editorChromeTokens` and `inspectorTokens` are the shared vocabulary for downstream editor work.

- Use named surfaces for workspace matte, viewer matte, panel, raised control, well, divider, hover, selected, focus, disabled, warning, and overlay states.
- Use the desktop geometry tokens for toolbars, filmstrip header, panel headers, right rail, inspector section headers, compact rows, and icon targets.
- Keep panel geometry square or low-radius. Inputs, popovers, and coarse-pointer controls may use the larger editor radius tier.
- Use typography tiers for panel title, section title, control label, numeric value, metadata, status, and tooltip content.
- Use the named image-frame, HUD, popover, and drag-overlay surface rules instead of arbitrary shadow or border fragments.
- Use the named panel reveal, section collapse, preview handoff, and selection-change motion tokens. Reduced motion must suppress nonessential motion.

## State and Input Rules

- Every editor control supports idle, hover, pressed, selected, edited/dirty, disabled, loading, error, and keyboard-focus presentation where applicable.
- Tool tabs, layers, masks, and section headers expose active state with a non-color-only indicator, not color alone.
- Numeric controls distinguish default-origin and minimum-origin fills.
- Disclosure headers reserve actions for reset, enable/disable, copy/paste, and overflow without moving the title or summary.
- Desktop compact controls use the compact-row density. Coarse-pointer controls use the coarse-pointer target token and do not rely on hover to reveal essential actions.
- Keyboard focus remains visible at high contrast. Localization may wrap labels but must preserve numeric slots, icon targets, and panel bounds.

## Review Targets

| Target                          | Required review                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1224x768                        | Desktop workspace geometry, full tool rail, compact inspector rows, viewer frame, and filmstrip state. |
| 1440x900                        | Desktop workspace geometry with full panel headers and viewer HUD space.                               |
| 1728x1117                       | High-density desktop review with no stretched compact controls or orphaned chrome.                     |
| Compact portrait/coarse pointer | Minimum 44px interactive targets, stable stacked panel geometry, and no hover-only essential action.   |

Visual fixtures must cover no image, loading, ready, and render-failure viewer states; Adjust, Color, Crop, Masks, Agent, and Export selection; default and edited sections; light and dark editor themes; Fit and 100% viewer states; filmstrip and both side-panel states; keyboard focus; and disabled controls. Fixture capture also represents high-DPI and reduced-motion conditions.

## Preserved RapidRaw Features

This foundation preserves, rather than hides, Agent, Film, Negative Lab, AI/object masks, local layers, computational merge tools, proof diagnostics, export workflows, and existing preview lifecycle behavior. It does not change adjustment or render math, preview handoff behavior, Filmstrip behavior, or individual panel workflows.
