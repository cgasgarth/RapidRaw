# Rust Clippy Pedantic And Nursery Evaluation

- Issue: #1354
- Validation command:
  `cd src-tauri && cargo clippy --quiet --locked --all-targets --no-default-features --features required-ci --message-format=json -- -W clippy::pedantic -W clippy::nursery`
- Current decision: defer global presets; use targeted lint promotion only.

## Result

The required-ci feature set produced 4,948 Clippy warnings when `pedantic` and
`nursery` were enabled as warning groups. The command exited successfully because
the probe used warnings, but the finding volume is too high for a PR gate.

Top warning groups:

| Count | Rule                                         |
| ----: | -------------------------------------------- |
|   771 | `clippy::cast_possible_truncation`           |
|   592 | `clippy::cast_lossless`                      |
|   580 | `clippy::cast_precision_loss`                |
|   542 | `clippy::uninlined_format_args`              |
|   439 | `clippy::suboptimal_flops`                   |
|   386 | `clippy::cast_sign_loss`                     |
|   217 | `clippy::needless_pass_by_value`             |
|   212 | `clippy::cast_possible_wrap`                 |
|    94 | `clippy::unreadable_literal`                 |
|    82 | `clippy::option_if_let_else`                 |
|    78 | `clippy::too_many_lines`                     |
|    77 | `clippy::default_trait_access`               |
|    71 | `clippy::similar_names`                      |
|    66 | `clippy::redundant_closure_for_method_calls` |
|    58 | `clippy::significant_drop_tightening`        |

## Categorization

- Correctness candidates:
  `cast_possible_truncation`, `cast_precision_loss`, `cast_sign_loss`,
  `cast_possible_wrap`, `float_cmp`, and `significant_drop_tightening`.
- Numeric-pipeline review candidates:
  `suboptimal_flops` and `imprecise_flops`, but only after image-science review
  because algebraic rewrites can change floating-point behavior.
- Maintainability candidates:
  `needless_pass_by_value`, `redundant_clone`, `unnecessary_wraps`, and
  `must_use_candidate`.
- Style-only or high-churn candidates:
  `uninlined_format_args`, `unreadable_literal`, `option_if_let_else`,
  `too_many_lines`, `default_trait_access`, `similar_names`,
  `items_after_statements`, and `many_single_char_names`.

## Promotion Policy

Do not enable `clippy::pedantic` or `clippy::nursery` globally. Promote one
targeted rule at a time only when all of these are true:

- the rule has a plausible bug-prevention value for RAW processing, command
  boundaries, serialization, or artifact persistence;
- the baseline count is small enough for a focused cleanup PR;
- the rule can run under `required-ci` without optional platform features;
- numeric behavior changes are covered by existing fixtures or a new focused
  fixture; and
- the PR keeps `bun run check:rust:clippy` green with `-D warnings`.

## Next Candidates

1. Evaluate a scoped numeric-cast policy for core processing modules.
2. `clippy::redundant_clone` was promoted into `bun run check:rust:clippy`
   after removing the focused required-ci findings in #1950.
3. Evaluate `clippy::must_use_candidate` only for public APIs and command/result
   helpers.

Global preset enablement remains rejected for now.
