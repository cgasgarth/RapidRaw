//! Narrow service capabilities used by the application composition root.
//!
//! New commands should receive one of these handles instead of reaching into
//! `AppState`'s legacy fields. The registry owns operation currentness and
//! cancellation so callers cannot publish stale results through an unrelated
//! singleton slot.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use crate::render::native_cache::CacheBudgetCoordinator;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct OperationId(u64);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum OperationState {
    Running,
    Cancelled,
    Completed,
}

#[derive(Default)]
struct OperationRegistry {
    next_id: AtomicU64,
    states: Mutex<HashMap<OperationId, OperationState>>,
}

impl OperationRegistry {
    fn begin(&self) -> OperationId {
        let id = OperationId(self.next_id.fetch_add(1, Ordering::Relaxed) + 1);
        self.states
            .lock()
            .expect("operation registry poisoned")
            .insert(id, OperationState::Running);
        id
    }

    fn transition(&self, id: OperationId, state: OperationState) -> bool {
        let mut states = self.states.lock().expect("operation registry poisoned");
        let Some(current) = states.get_mut(&id) else {
            return false;
        };
        if *current != OperationState::Running {
            return false;
        }
        *current = state;
        true
    }

    fn is_current(&self, id: OperationId) -> bool {
        self.states
            .lock()
            .expect("operation registry poisoned")
            .get(&id)
            == Some(&OperationState::Running)
    }
}

#[derive(Clone, Default)]
pub struct EditorRuntimeService {
    operations: Arc<OperationRegistry>,
}

impl EditorRuntimeService {
    pub fn begin_operation(&self) -> OperationId {
        self.operations.begin()
    }
    pub fn cancel(&self, id: OperationId) -> bool {
        self.operations.transition(id, OperationState::Cancelled)
    }
    pub fn complete(&self, id: OperationId) -> bool {
        self.operations.transition(id, OperationState::Completed)
    }
    pub fn is_current(&self, id: OperationId) -> bool {
        self.operations.is_current(id)
    }
}

#[derive(Clone, Default)]
pub struct JobCoordinator {
    operations: Arc<OperationRegistry>,
}

impl JobCoordinator {
    pub fn begin(&self) -> OperationId {
        self.operations.begin()
    }
    pub fn cancel(&self, id: OperationId) -> bool {
        self.operations.transition(id, OperationState::Cancelled)
    }
    pub fn complete(&self, id: OperationId) -> bool {
        self.operations.transition(id, OperationState::Completed)
    }
    pub fn is_current(&self, id: OperationId) -> bool {
        self.operations.is_current(id)
    }
}

#[derive(Clone)]
pub struct AppServices {
    pub editor: Arc<EditorRuntimeService>,
    pub(crate) startup_files: Arc<crate::app::startup_file_handoff::StartupFileHandoffService>,
    pub(crate) denoise: Arc<crate::computational::denoise_service::EnhancedDenoiseService>,
    pub(crate) payload_residency:
        Arc<crate::color::payload_residency_service::PayloadResidencyService>,
    pub(crate) gpu_crash_marker: Arc<crate::gpu::crash_marker_service::GpuCrashMarkerService>,
    pub(crate) lens_database: Arc<crate::color::lens_database_service::LensDatabaseService>,
    pub(crate) focus_stack:
        Arc<crate::merge::focus_stack::planning_service::FocusStackPlanningService>,
    pub(crate) focus_stack_results: Arc<crate::merge::focus_stack::job::FocusStackResultService>,
    pub(crate) hdr: Arc<crate::merge::hdr::planning_service::HdrPlanningService>,
    pub(crate) burst_sr:
        Arc<crate::merge::super_resolution::planning_service::BurstSrPlanningService>,
    pub(crate) panorama: Arc<crate::merge::panorama_stitching::service::PanoramaService>,
    pub(crate) preview_runtime: Arc<crate::render::preview_runtime_service::PreviewRuntimeService>,
    pub(crate) import_jobs: Arc<crate::library::import_job_service::ImportJobService>,
    pub(crate) catalog_indexing:
        Arc<crate::library::catalog_indexing_service::CatalogIndexingService>,
    pub(crate) thumbnails:
        Arc<crate::library::thumbnail_generation_service::ThumbnailGenerationService>,
    pub(crate) uncropped_preview:
        Arc<crate::app::commands::uncropped_preview::UncroppedPreviewService>,
    pub(crate) analytics: Arc<crate::render::analytics_service::AnalyticsRuntimeService>,
    pub(crate) full_warp_cache: Arc<crate::render::full_warp_cache_service::FullWarpCacheService>,
    pub(crate) viewer_sampling: Arc<crate::editor::viewer_sampling_service::ViewerSamplingService>,
    pub(crate) tether: Arc<crate::library::tethering::TetherSessionService>,
    pub jobs: Arc<JobCoordinator>,
}

impl AppServices {
    pub(crate) fn new(cache_budget: Arc<CacheBudgetCoordinator>) -> Self {
        Self {
            editor: Arc::default(),
            startup_files: Arc::default(),
            denoise: Arc::default(),
            payload_residency: Arc::default(),
            gpu_crash_marker: Arc::default(),
            lens_database: Arc::default(),
            focus_stack: Arc::default(),
            focus_stack_results: Arc::default(),
            hdr: Arc::default(),
            burst_sr: Arc::default(),
            panorama: Arc::default(),
            preview_runtime: Arc::default(),
            import_jobs: Arc::default(),
            catalog_indexing: Arc::default(),
            thumbnails: Arc::default(),
            uncropped_preview: Arc::default(),
            analytics: Arc::default(),
            full_warp_cache: Arc::default(),
            viewer_sampling: Arc::new(
                crate::editor::viewer_sampling_service::ViewerSamplingService::new(cache_budget),
            ),
            tether: Arc::default(),
            jobs: Arc::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn operation_handles_reject_stale_completion_and_cancellation() {
        let service = EditorRuntimeService::default();
        let first = service.begin_operation();
        let second = service.begin_operation();
        assert!(service.is_current(first));
        assert!(service.cancel(first));
        assert!(!service.is_current(first));
        assert!(!service.complete(first));
        assert!(service.complete(second));
        assert!(!service.complete(second));
    }

    #[test]
    fn registry_is_safe_for_concurrent_begin_and_cancel() {
        let service = Arc::new(JobCoordinator::default());
        let handles: Vec<_> = (0..8)
            .map(|_| {
                let service = Arc::clone(&service);
                thread::spawn(move || {
                    let id = service.begin();
                    assert!(service.cancel(id));
                    assert!(!service.is_current(id));
                })
            })
            .collect();
        for handle in handles {
            handle.join().unwrap();
        }
    }
}
