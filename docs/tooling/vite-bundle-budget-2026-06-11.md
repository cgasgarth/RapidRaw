# Vite Bundle Budget

Issue: #288

The current RapidRAW frontend build produces one large application chunk. That
is accepted temporarily, but it is now tracked as an explicit budget instead of
an unowned Vite warning.

## Initial Budget

| Asset class              | Raw budget      | Gzip budget   |
| ------------------------ | --------------- | ------------- |
| Largest JavaScript asset | 2,650,000 bytes | 762,048 bytes |
| Largest CSS asset        | 125,000 bytes   | 20,000 bytes  |

## Validation

Run:

```sh
bun run check:bundle
```

This command builds the frontend and then runs
`scripts/check-vite-bundle-budget.mjs` against `dist/assets`.

## Policy

- The current monolithic JavaScript chunk is accepted as temporary debt.
- Growth beyond the raw or gzip budget fails validation.
- HDR, panorama, color style, and advanced color setup UI increased the temporary JavaScript
  gzip ceiling; future code-splitting should lower this again.
- A future code-splitting PR should lower the JavaScript budget after reducing
  the largest chunk.
- `vite.config.js` sets `chunkSizeWarningLimit` to the same raw budget range so
  Vite warnings and the explicit budget gate stay aligned.
