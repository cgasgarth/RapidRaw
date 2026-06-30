# Workflow Layout

Keep all GitHub Actions workflow YAML files directly in this folder.

- Do not nest workflow files in subdirectories; GitHub Actions only discovers workflows from `.github/workflows/`.
- Keep existing workflow file names and job names stable unless a branch-protection update is being coordinated at the same time.
- Put shared implementation details in scripts or reusable action code, not in extra workflow folder layers.
