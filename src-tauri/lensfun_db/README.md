# Lensfun DB

This directory is a vendored snapshot of the upstream Lensfun calibration
database. It is loaded as a single `lensfun_db` resource by
`src-tauri/src/color/lens_correction.rs` and packaged through
`src-tauri/tauri.conf.json`.

Provenance and license:

- Source: upstream Lensfun database snapshot from the Lensfun project
  (`https://github.com/lensfun/lensfun`).
- Database license: Creative Commons Attribution-Share Alike 3.0 (CC BY-SA 3.0).
- Code license for Lensfun itself is separate; only the database payload is
  bundled here.

Policy:

- Keep the flat upstream XML layout. Do not introduce subdirectories or rename
  files unless the loader and packaging code change in the same PR.
- Update by replacing the full directory from the upstream Lensfun snapshot, not
  by hand-editing individual vendor files.
- Refresh from a new upstream Lensfun release or database export, then replace
  this directory wholesale and update `timestamp.txt`, `lensfun-database.dtd`,
  and `lensfun-database.xsd` from the same drop.
- Keep `timestamp.txt`, `lensfun-database.dtd`, and `lensfun-database.xsd`
  aligned with the same upstream drop.
- Only remove a file here when it is clearly stale and the change is backed by
  the upstream Lensfun source or a matching code change.

Ownership for this folder stays with lens correction/vendor cleanup work.
