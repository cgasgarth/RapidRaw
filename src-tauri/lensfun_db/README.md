# Lensfun DB

This directory is a vendored Lensfun database snapshot. It is loaded as a single
`lensfun_db` resource by `src-tauri/src/lens_correction.rs` and packaged through
`src-tauri/tauri.conf.json`.

Policy:

- Keep the flat upstream XML layout. Do not introduce subdirectories or rename
  files unless the loader and packaging code change in the same PR.
- Update by replacing the full directory from the upstream Lensfun snapshot, not
  by hand-editing individual vendor files.
- Keep `timestamp.txt`, `lensfun-database.dtd`, and `lensfun-database.xsd`
  aligned with the same upstream drop.
- Only remove a file here when it is clearly stale and the change is backed by
  the upstream Lensfun source or a matching code change.

Ownership for this folder stays with lens correction/vendor cleanup work.
