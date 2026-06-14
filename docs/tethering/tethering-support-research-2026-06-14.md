# Tethering Support Research

- Issue: #237 `tethering(research): research tethering support`
- Milestone: 15, Professional Workflow Polish
- Scope: macOS-first tethered capture research for RawEngine/RapidRaw.
- Status: research and implementation-plan document only. This does not add a
  runtime tethering implementation.

## Recommendation

RawEngine should treat tethering as a staged desktop capability with a provider
interface and a hardware-backed validation tier:

1. Build a `TetherProvider` abstraction first.
2. Use libgphoto2 as the first experimental provider for camera control,
   capture, download, and live-view where supported.
3. Keep Apple ImageCaptureCore as a discovery/import fallback, not the primary
   capture provider, because its tethering APIs are deprecated on modern macOS.
4. Defer vendor SDK integrations until libgphoto2 coverage or reliability is
   proven inadequate for named camera families.
5. Keep CI hardware-free, with simulator/fixture contract tests; run real camera
   validation as a manual macOS hardware lane.

## Source Findings

- libgphoto2 publishes an official supported-camera matrix and distinguishes
  between download, capture, configuration, and preview capability levels. This
  makes it the best public baseline for a cross-brand support table.
  Source: <https://www.gphoto.org/proj/libgphoto2/support.php>
- libgphoto2's repository describes PTP support as the common path for modern
  non-mass-storage cameras, including Canon, Nikon, Fujifilm, Sony, and
  Panasonic families.
  Source: <https://github.com/gphoto/libgphoto2>
- Apple ImageCaptureCore can discover connected cameras and inspect camera
  files, but `ICCameraDevice.requestEnableTethering()` and related tethering
  capture APIs are deprecated as of macOS 14.0.
  Source: <https://developer.apple.com/documentation/imagecapturecore>
- Apple still exposes PTP pass-through methods in ImageCaptureCore, but these
  should be treated as low-level compatibility tools, not the main RawEngine
  tether provider.
  Source:
  <https://developer.apple.com/documentation/imagecapturecore/iccameradevice/requestsendptpcommand%28_%3Aoutdata%3Asendcommanddelegate%3Adidsendcommand%3Acontextinfo%3A%29>

## Product Requirements

- Camera discovery: show connection type, provider, camera model, serial when
  available, battery, storage, capture capability, live-view capability, and
  warning state.
- Session setup: choose destination album/session, naming template, metadata
  preset, import preset, backup destination, and whether to leave images on the
  card when the provider supports that behavior.
- Capture controls: trigger capture, cancel pending capture when supported,
  import new files, apply import presets, and surface provider errors with a
  recovery path.
- Camera controls: expose aperture, shutter, ISO, white balance, focus mode, and
  drive mode only when the provider reports them as supported and writable.
- Live view: optional provider capability with frame-rate, resolution, focus
  aid, and exposure-preview warnings.
- Reliability: detect disconnects, recover sessions, avoid duplicate imports,
  preserve partially downloaded files safely, and write a durable session log.
- Agent/API: expose discovery, session start/stop, capture, import, and status
  as typed API/app-server tools with dry-run support and audit records.

## Architecture

```text
React tethering UI
  -> Tauri command surface
  -> TetherProvider registry
  -> provider implementation
  -> camera device / downloaded files / RawEngine import pipeline
```

The provider contract should be explicit and capability-driven:

- `listDevices()`: returns attached cameras and provider metadata.
- `openSession(deviceId, options)`: creates a durable tether session.
- `getCapabilities(sessionId)`: returns supported controls and capture modes.
- `getState(sessionId)`: returns battery, storage, busy state, and warnings.
- `setControl(sessionId, controlId, value)`: updates writable camera settings.
- `capture(sessionId, request)`: triggers capture and returns pending/imported
  artifact records.
- `startLiveView(sessionId, options)`: starts preview when supported.
- `stopLiveView(sessionId)`: stops preview and releases provider resources.
- `closeSession(sessionId)`: releases handles and writes final session status.

## Validation Plan

- Unit tests: provider capability parsing, unsupported-control behavior, capture
  state transitions, duplicate file detection, naming templates, and session log
  serialization.
- Contract tests: fake provider that simulates discovery, capture success,
  disconnects, busy camera states, unsupported live view, and failed downloads.
- Integration tests: libgphoto2 adapter tests behind an opt-in hardware flag.
- Manual macOS hardware lane: at least one Canon/Nikon/Sony/Fujifilm body before
  marking tethering broadly supported.
- UI tests: disconnected state, connected unsupported state, capture success,
  capture error, and imported-image handoff to the library.

## Implementation Order

1. Add the typed provider contract and fake provider tests.
2. Add the Tauri command surface with fake-provider wiring.
3. Add a minimal tether panel for discovery and session state.
4. Add capture/import handoff through the existing import preset and metadata
   template contracts.
5. Add the libgphoto2 provider as experimental macOS functionality.
6. Add hardware validation docs and a manual GitHub issue template.
7. Promote camera-family support only after hardware proof is attached.

## Risks And Open Decisions

- Camera support is model-specific. RawEngine should never imply universal
  tether support from a generic USB/PTP connection.
- libgphoto2 packaging on macOS must be validated against app bundling,
  notarization, sandbox expectations, and dynamic-library loading.
- Apple ImageCaptureCore tethering deprecation makes it a poor primary capture
  path, but it may still be useful for discovery/import fallback behavior.
- Live view and writable controls vary heavily by camera. The UI must be driven
  by provider-reported capabilities instead of static camera assumptions.
- Hardware validation cannot be fully shifted into normal CI without physical
  camera runners.

## Follow-Up Issues

- `tethering(contract): add provider capability schema`
- `tethering(fake): add fake provider and contract tests`
- `tethering(ui): add discovery and session panel`
- `tethering(import): connect captures to import presets and metadata templates`
- `tethering(libgphoto2): add experimental macOS provider`
- `validation(tethering): add manual hardware validation checklist`
