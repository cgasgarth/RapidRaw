# WGPU presentation scheduler

## Ownership and mutation inventory

`WgpuPresentationScheduler` is the sole owner of mutable `WgpuDisplay` state. Its named
`wgpu-presentation` thread performs surface acquisition/configuration, bind-group replacement,
transform uniform writes, queue submission, and presentation.

The previous direct mutation sites were:

- `update_wgpu_transform` for pan, zoom, fit, and animation transforms;
- the main-window resize callback for surface configuration and redraw;
- GPU processor reallocation for display texture rebinding;
- completed preview processing for texture rebinding and redraw.

All four now publish immutable values or WGPU resource handles to the scheduler. No caller can
access `WgpuDisplay` fields or render methods outside `gpu_display.rs`.

## Lock order and resource lifetime

Submission locks only the scheduler mailbox and never a GPU processor or application cache.
Preview processing clones the completed `TextureView` while it already owns the processor lock,
then publishes it without acquiring presentation state. The owner locks the mailbox only to take
pending state or complete waiters; it never holds that lock during surface acquisition, queue
writes, bind-group creation, or rendering. Surface/device work therefore cannot invert the
processor, cache, application-state, or mailbox lock order.

The mailbox has one transform, one surface size, and one texture handle. New values replace old
pending values while dirty flags are OR-ed. A bind group retains a published texture view through
the submitted presentation; a pending view replaced before presentation is dropped immediately.

## Cadence and acknowledgement

Interactive submission returns its sequence after mailbox acceptance. `flush_wgpu_presentation`
waits until that sequence, or a newer coalesced sequence, is presented. Identical transforms are
covered without a redundant uniform write or render. Presentation is capped at 120 Hz using
measured deadlines; wakeups before a deadline continue coalescing rather than advancing it.

Zero-size surfaces retain the latest state and suspend rendering until a valid resize. Lost or
outdated surfaces are reconfigured once by `WgpuDisplay::render`; timeouts are skipped. Scheduler
drop rejects submissions, resolves all waiters with `presentation_stopped`, wakes, and joins the
owner thread.

## Runtime evidence

`get_wgpu_presentation_report` reports submissions, coalesced transforms, uniform writes, presents,
surface configurations, texture publications/replacements, hidden skips, latest/maximum transform
latency, bounded mailbox bytes, and pending flushes.
The focused flood test emits its measured publication time and compares the old per-event model
(`10,000` blocking tasks and render attempts) with one bounded pending snapshot.
