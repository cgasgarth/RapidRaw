use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

/// Shared scheduling signal that gives interactive previews priority over
/// background export work without exposing a writable counter to AppState users.
#[derive(Default)]
pub(crate) struct InteractiveGpuPressure {
    active_preview_leases: AtomicUsize,
}

impl InteractiveGpuPressure {
    pub(crate) fn acquire(self: &Arc<Self>) -> InteractiveGpuPressureLease {
        self.active_preview_leases.fetch_add(1, Ordering::AcqRel);
        InteractiveGpuPressureLease {
            pressure: Arc::clone(self),
        }
    }

    pub(crate) fn has_pending_preview(&self) -> bool {
        self.active_preview_leases.load(Ordering::Acquire) > 0
    }
}

pub(crate) struct InteractiveGpuPressureLease {
    pressure: Arc<InteractiveGpuPressure>,
}

impl Drop for InteractiveGpuPressureLease {
    fn drop(&mut self) {
        let previous = self
            .pressure
            .active_preview_leases
            .fetch_sub(1, Ordering::AcqRel);
        debug_assert!(previous > 0, "interactive GPU pressure lease underflow");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Barrier;
    use std::thread;

    #[test]
    fn overlapping_leases_clear_only_after_the_last_preview_finishes() {
        let pressure = Arc::new(InteractiveGpuPressure::default());
        assert!(!pressure.has_pending_preview());

        let first = pressure.acquire();
        let second = pressure.acquire();
        assert!(pressure.has_pending_preview());

        drop(first);
        assert!(pressure.has_pending_preview());
        drop(second);
        assert!(!pressure.has_pending_preview());
    }

    #[test]
    fn concurrent_preview_leases_recover_after_every_worker_releases() {
        let pressure = Arc::new(InteractiveGpuPressure::default());
        let acquired = Arc::new(Barrier::new(9));
        let release = Arc::new(Barrier::new(9));
        let workers: Vec<_> = (0..8)
            .map(|_| {
                let pressure = Arc::clone(&pressure);
                let acquired = Arc::clone(&acquired);
                let release = Arc::clone(&release);
                thread::spawn(move || {
                    let lease = pressure.acquire();
                    acquired.wait();
                    release.wait();
                    drop(lease);
                })
            })
            .collect();

        acquired.wait();
        assert!(pressure.has_pending_preview());
        release.wait();
        for worker in workers {
            worker.join().unwrap();
        }
        assert!(!pressure.has_pending_preview());
    }
}
