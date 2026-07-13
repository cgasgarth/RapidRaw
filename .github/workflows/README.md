# Workflow Layout

Keep all GitHub Actions workflow YAML files directly in this folder.

- Do not nest workflow files in subdirectories; GitHub Actions only discovers workflows from `.github/workflows/`.
- Keep existing workflow file names and job names stable unless a branch-protection update is being coordinated at the same time.
- Put shared implementation details in scripts or reusable action code, not in extra workflow folder layers.
- `lint.yml` runs the content-addressed affected color lab and wires it into `PR CI / required`.
- `main-long-validation.yml` runs the full color lab without cache on schedule/manual dispatch.
- `color-lab-hardware.yml` is manual-only; it measures the native adapter/driver before binding reports to that identity.
