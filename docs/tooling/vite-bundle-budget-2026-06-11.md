# Vite Bundle Budget

Issue: #288

The current RapidRAW frontend build produces one large application chunk. That is accepted temporarily, but it is now tracked as an explicit budget instead of an unowned Vite warning.

## Initial Budget

| Asset class              |          Budget |
| ------------------------ | --------------: |
| Largest JavaScript asset | 2,650,000 bytes |
| Largest CSS asset        |   125,000 bytes |

## Validation

Run:

```sh
bun run check:bundle
```

This command builds the frontend and then runs `scripts/check-vite-bundle-budget.mjs` against `dist/assets`.

## Policy

- The current monolithic JavaScript chunk is accepted as temporary debt.
- Growth beyond the budget fails validation.
- A future code-splitting PR should lower the JavaScript budget after reducing the largest chunk.
