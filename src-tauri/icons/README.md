# Icon assets

This folder keeps the flat Tauri bundle icons required by `src-tauri/tauri.conf.json`.

The root filenames (`32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico`) must stay in place for Tauri packaging.

The `ios/` directory is the generated iOS icon bundle. Keep the canonical filenames there and do not reintroduce duplicate `*-1.png` copies unless the generator starts requiring them again.
