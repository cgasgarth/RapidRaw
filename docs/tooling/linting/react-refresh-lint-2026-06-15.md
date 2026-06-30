# React Refresh Lint

Status: lint gate evaluation.

`eslint-plugin-react-refresh` is enabled for TSX/JSX files with Vite-compatible
constant exports. It catches component modules that also export non-component
values that can break fast refresh behavior during UI iteration.

Documented exceptions:

- `useContextMenu` is allowed from `ContextMenuContext.tsx` because the hook is
  intentionally paired with its provider.
- `src/utils/CollageVariants.tsx` is ignored because it is JSX-backed layout
  data, not a component module.

Validation:

- `bun run check:lint`
- `bun run check:types`
- `bun run build:frontend`
