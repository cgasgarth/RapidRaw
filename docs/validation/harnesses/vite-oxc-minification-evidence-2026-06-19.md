# Vite Oxc Minification Evidence

Issue: #2407

## Change

Production Vite builds now use Oxc for JavaScript minification and keep esbuild
for CSS minification.

## Baseline

Command:

```sh
/usr/bin/time -p bun run build:frontend && bun run check:bundle:budget && bun run check:bundle:report
```

Result:

| Metric             | Esbuild JS minify |
| ------------------ | ----------------: |
| Build wall time    |             2.95s |
| Largest JS raw     |   2,350,975 bytes |
| Largest JS gzip    |     683,216 bytes |
| Initial entry raw  |   2,713,684 bytes |
| Initial entry gzip |     776,860 bytes |
| Total raw          |   2,987,263 bytes |
| Total gzip         |     853,659 bytes |

## Oxc

Command:

```sh
/usr/bin/time -p bun run build:frontend && bun run check:bundle:budget && bun run check:bundle:report
```

Result:

| Metric             |   Oxc JS minify |
| ------------------ | --------------: |
| Build wall time    |           1.39s |
| Largest JS raw     | 2,321,093 bytes |
| Largest JS gzip    |   664,955 bytes |
| Initial entry raw  | 2,677,619 bytes |
| Initial entry gzip |   755,347 bytes |
| Total raw          | 2,948,036 bytes |
| Total gzip         |   829,286 bytes |

## Sourcemaps

Commands:

```sh
TAURI_ENV_DEBUG=1 bun run build:frontend
find dist -name '*.map' | wc -l
bun run build:frontend
find dist -name '*.map' | wc -l
```

Result:

| Build mode          | Sourcemaps |
| ------------------- | ---------: |
| `TAURI_ENV_DEBUG=1` |         13 |
| normal production   |          0 |
