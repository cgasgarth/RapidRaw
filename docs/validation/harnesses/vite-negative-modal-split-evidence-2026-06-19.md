# Negative Lab Modal Split Bundle Evidence

Issue: #2401

## Change

`AppModals` now lazy-loads `NegativeConversionModal` only when the Negative Lab
modal opens. This keeps the large Negative Lab modal out of the initial
frontend bundle while preserving the existing modal UI path.

## Before

Measured from the Oxc-minified production build before the split:

| Metric             |          Before |
| ------------------ | --------------: |
| Largest JS raw     | 2,321,093 bytes |
| Largest JS gzip    |   664,955 bytes |
| Initial entry raw  | 2,677,619 bytes |
| Initial entry gzip |   755,347 bytes |
| Total raw          | 2,948,036 bytes |
| Total gzip         |   829,286 bytes |
| Asset count        |              14 |

## After

Command:

```sh
bun run check:bundle
```

Result:

| Metric             |           After |
| ------------------ | --------------: |
| Largest JS raw     | 2,173,372 bytes |
| Largest JS gzip    |   630,989 bytes |
| Initial entry raw  | 2,572,420 bytes |
| Initial entry gzip |   734,003 bytes |
| Asset count        |              17 |

## Delta

| Metric             |          Delta |
| ------------------ | -------------: |
| Largest JS raw     | -147,721 bytes |
| Largest JS gzip    |  -33,966 bytes |
| Initial entry raw  | -105,199 bytes |
| Initial entry gzip |  -21,344 bytes |

The split reduces first-load JavaScript while adding deferred modal chunks for
the Negative Lab path.
