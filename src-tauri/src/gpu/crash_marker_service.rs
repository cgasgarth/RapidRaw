use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
struct ActiveMarker {
    lease_id: u64,
    path: PathBuf,
}

#[derive(Default)]
struct CrashMarkerState {
    configured_path: Option<PathBuf>,
    next_lease_id: u64,
    active: Option<ActiveMarker>,
}

#[derive(Default)]
pub(crate) struct GpuCrashMarkerService {
    state: Mutex<CrashMarkerState>,
}

impl GpuCrashMarkerService {
    pub(crate) fn configure(&self, path: PathBuf) {
        self.state
            .lock()
            .expect("GPU crash marker service poisoned")
            .configured_path = Some(path);
    }

    /// Starts a best-effort crash marker lease. Filesystem work happens after
    /// releasing service state, and only the current lease may clear its marker.
    #[must_use]
    pub(crate) fn begin_initialization(self: &Arc<Self>) -> GpuCrashMarkerLease {
        let (lease_id, path, superseded_path) = {
            let mut state = self
                .state
                .lock()
                .expect("GPU crash marker service poisoned");
            state.next_lease_id = state.next_lease_id.wrapping_add(1);
            let lease_id = state.next_lease_id;
            let path = state.configured_path.clone();
            let superseded_path = state.active.take().map(|active| active.path);
            state.active = path.as_ref().map(|path| ActiveMarker {
                lease_id,
                path: path.clone(),
            });
            (lease_id, path, superseded_path)
        };

        if superseded_path.as_ref() != path.as_ref()
            && let Some(path) = superseded_path
        {
            let _ = std::fs::remove_file(path);
        }
        if let Some(path) = &path {
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::write(path, "initializing_gpu");
            let active = self
                .state
                .lock()
                .expect("GPU crash marker service poisoned")
                .active
                .clone();
            if active
                .as_ref()
                .is_none_or(|active| active.lease_id != lease_id && active.path != *path)
            {
                let _ = std::fs::remove_file(path);
            }
        }

        GpuCrashMarkerLease {
            service: Arc::clone(self),
            lease_id,
        }
    }

    fn finish(&self, lease_id: u64) {
        let path = {
            let mut state = self
                .state
                .lock()
                .expect("GPU crash marker service poisoned");
            match state.active.as_ref() {
                Some(active) if active.lease_id == lease_id => {
                    state.active.take().map(|active| active.path)
                }
                _ => None,
            }
        };
        if let Some(path) = path {
            let _ = std::fs::remove_file(path);
        }
    }
}

pub(crate) struct GpuCrashMarkerLease {
    service: Arc<GpuCrashMarkerService>,
    lease_id: u64,
}

impl Drop for GpuCrashMarkerLease {
    fn drop(&mut self) {
        self.service.finish(self.lease_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Barrier;
    use std::thread;

    #[test]
    fn lease_creates_and_clears_marker() {
        let root = tempfile::tempdir().unwrap();
        let marker = root.path().join("nested/.gpu_init_crash_flag");
        let service = Arc::new(GpuCrashMarkerService::default());
        service.configure(marker.clone());

        let lease = service.begin_initialization();
        assert_eq!(
            std::fs::read_to_string(&marker).unwrap(),
            "initializing_gpu"
        );
        drop(lease);
        assert!(!marker.exists());
    }

    #[test]
    fn obsolete_concurrent_lease_cannot_clear_successor_marker() {
        let root = tempfile::tempdir().unwrap();
        let marker = root.path().join(".gpu_init_crash_flag");
        let service = Arc::new(GpuCrashMarkerService::default());
        service.configure(marker.clone());
        let obsolete = service.begin_initialization();
        let release = Arc::new(Barrier::new(2));
        let worker = {
            let release = Arc::clone(&release);
            thread::spawn(move || {
                release.wait();
                drop(obsolete);
            })
        };

        let current = service.begin_initialization();
        release.wait();
        worker.join().unwrap();
        assert_eq!(
            std::fs::read_to_string(&marker).unwrap(),
            "initializing_gpu"
        );
        drop(current);
        assert!(!marker.exists());
    }

    #[test]
    fn reconfigured_successor_cleans_superseded_marker_identity() {
        let root = tempfile::tempdir().unwrap();
        let first_marker = root.path().join("first/.gpu_init_crash_flag");
        let current_marker = root.path().join("current/.gpu_init_crash_flag");
        let service = Arc::new(GpuCrashMarkerService::default());
        service.configure(first_marker.clone());
        let obsolete = service.begin_initialization();

        service.configure(current_marker.clone());
        let current = service.begin_initialization();
        assert!(!first_marker.exists());
        assert!(current_marker.exists());

        drop(obsolete);
        assert!(current_marker.exists());
        drop(current);
        assert!(!current_marker.exists());
    }
}
