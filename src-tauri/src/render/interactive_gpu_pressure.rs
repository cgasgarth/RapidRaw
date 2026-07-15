use std::sync::atomic::{AtomicBool, Ordering};

/// Shared scheduling signal that gives interactive previews priority over
/// background export work without exposing a writable counter to AppState users.
#[derive(Default)]
pub(crate) struct InteractiveGpuPressure {
    preview_pending: AtomicBool,
}

impl InteractiveGpuPressure {
    pub(crate) fn set_preview_pending(&self, pending: bool) {
        self.preview_pending.store(pending, Ordering::Release);
    }

    pub(crate) fn has_pending_preview(&self) -> bool {
        self.preview_pending.load(Ordering::Acquire)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pressure_is_binary_and_clears_explicitly() {
        let pressure = InteractiveGpuPressure::default();
        assert!(!pressure.has_pending_preview());

        pressure.set_preview_pending(true);
        pressure.set_preview_pending(true);
        assert!(pressure.has_pending_preview());

        pressure.set_preview_pending(false);
        assert!(!pressure.has_pending_preview());
    }
}
