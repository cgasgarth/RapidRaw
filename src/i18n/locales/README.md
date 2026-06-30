# Locale files

These JSON files stay flat on purpose. `src/i18n/index.ts` imports each locale
directly, so the repository should keep one file per locale code here instead of
nesting by namespace or feature.

Current locale set:
`de`, `en`, `es`, `fr`, `it`, `ja`, `ko`, `pl`, `pt`, `ru`, `zh-CN`, `zh-TW`.

Update flow:
- Edit the locale file directly when a translation changes.
- Use `src/i18n/update_translations.py` to refresh the small generated folder
  updates that the repo uses for language coverage.
- Keep filenames aligned with the i18next language codes already consumed by
  the app and tests.

Ownership:
- This folder is the canonical locale source for the app.
- Add new locale files here only when the app and tests are ready to consume the
  new language code end to end.
