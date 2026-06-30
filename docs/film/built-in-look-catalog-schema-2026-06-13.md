# Built-In Film Look Catalog Schema

RawEngine film looks are creative rendering recipes, not exact stock emulations.
The v1 catalog schema is intentionally conservative so the app can ship polished
generic looks while leaving measured, licensed, or user-supplied profiles behind
explicit provenance gates.

## Contract

- `FilmLookCatalogV1` contains a versioned list of `FilmLookRecipeV1` records.
- Every built-in generic recipe uses `claimLevel: "generic_engineered"` and
  `legalNamingStatus: "generic_safe_name"`.
- Generic built-ins cannot use manufacturer, stock, competitor, official,
  endorsement, or exact-emulation language in IDs or user-facing copy.
- `FilmRenderDomainV1` records whether the recipe expects scene-referred,
  Negative Lab positive, working RGB, or display-referred input.
- `FilmLookNodeV1` records ordered creative nodes such as tone curves, color
  matrices, black-and-white mixers, grain, halation, glow, and LUT references.

## Built-In Seed Set

The initial catalog sample covers six generic looks:

- Clean Color
- Warm Print
- Cool Contrast
- Soft Fade
- Mono Silver
- Punch Color

These are starting points for the look browser and renderer API. They are not
claims about specific commercial film stocks.

## Validation

`bun run schema:check` validates the TypeScript schema, parses the sample catalog,
rejects unsafe exact-emulation naming, and checks the generated JSON artifact at
`packages/rawengine-schema/samples/film/film-look-catalog-v1.json`.
