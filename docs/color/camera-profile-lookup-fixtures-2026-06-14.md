# Camera Profile Lookup Fixtures

`bun run check:camera-profile-lookup` validates the first camera-profile lookup
fixture set for RawEngine color pipeline work.

The fixture covers:

- exact camera model lookup;
- camera model alias lookup;
- case-insensitive manufacturer and file extension handling;
- DNG embedded-matrix fallback;
- generic raw-decoder fallback with a stable warning.

This is schema and lookup-policy validation only. It does not apply camera
profiles to rendered pixels yet, and it does not replace ColorChecker,
DeltaE, or CPU/GPU parity tests.
