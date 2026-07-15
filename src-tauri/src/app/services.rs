//! Narrow service capabilities used by the application composition root.
//!
//! New commands should receive one of these handles instead of reaching into
//! `AppState`'s legacy fields. The registry owns operation currentness and
//! cancellation so callers cannot publish stale results through an unrelated
//! singleton slot.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

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
    image: Arc<crate::editor::image_service::EditorImageService>,
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

    pub(crate) fn install_image(&self, image: crate::editor::image_service::LoadedImage) {
        self.image.install(image);
    }

    pub(crate) fn image_snapshot(&self) -> Option<crate::editor::image_service::LoadedImage> {
        self.image.snapshot()
    }

    #[cfg(feature = "validation-harness")]
    pub(crate) fn try_image_snapshot(&self) -> Option<crate::editor::image_service::LoadedImage> {
        self.image.try_snapshot()
    }

    pub(crate) fn clone_image_pixels(&self) -> Result<(image::DynamicImage, bool), String> {
        self.image.clone_pixels()
    }

    pub(crate) fn clear_image(&self) {
        self.image.clear();
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
    pub(crate) display_profile:
        Arc<crate::app::display_profile_service::DisplayProfileRuntimeService>,
    pub(crate) startup: Arc<crate::app::startup::StartupRuntimeService>,
    pub(crate) startup_files: Arc<crate::app::startup_file_handoff::StartupFileHandoffService>,
    computational: crate::computational::runtime_services::ComputationalRuntimeServices,
    pub(crate) payload_residency:
        Arc<crate::color::payload_residency_service::PayloadResidencyService>,
    gpu: crate::gpu::runtime_services::GpuRuntimeServices,
    pub(crate) lens_database: Arc<crate::color::lens_database_service::LensDatabaseService>,
    export: crate::export::runtime_services::ExportRuntimeServices,
    film: crate::render::film_runtime_services::FilmRuntimeServices,
    pub(crate) preview_runtime: Arc<crate::render::preview_runtime_service::PreviewRuntimeService>,
    pub(crate) preview_frames:
        Arc<crate::render::preview_frame_cache_service::PreviewFrameCacheService>,
    library: crate::library::runtime_services::LibraryRuntimeServices,
    pub(crate) preview_session: Arc<crate::app::preview_session_service::PreviewSessionService>,
    pub(crate) analytics: Arc<crate::render::analytics_service::AnalyticsRuntimeService>,
    pub(crate) full_warp_cache: Arc<crate::render::full_warp_cache_service::FullWarpCacheService>,
    pub(crate) native_caches: Arc<crate::render::native_cache_service::NativeCacheService>,
    #[cfg(feature = "ai")]
    pub(crate) ai: Arc<crate::ai::runtime_service::AiRuntimeService>,
    pub(crate) interactive_gpu_pressure:
        Arc<crate::render::interactive_gpu_pressure::InteractiveGpuPressure>,
    pub(crate) source_fingerprints: Arc<crate::source_revision::FingerprintCache>,
    pub(crate) image_open: Arc<crate::image_open_session::ImageOpenCoordinator>,
    pub(crate) viewer_sampling: Arc<crate::editor::viewer_sampling_service::ViewerSamplingService>,
    pub jobs: Arc<JobCoordinator>,
}

impl AppServices {
    pub(crate) fn new() -> Self {
        let native_caches =
            Arc::new(crate::render::native_cache_service::NativeCacheService::default());
        let cache_budget = native_caches.budget();
        #[cfg(feature = "ai")]
        let ai = Arc::new(crate::ai::runtime_service::AiRuntimeService::new(
            Arc::clone(&cache_budget),
        ));
        crate::patch_assets::initialize_patch_asset_cache(Arc::clone(&cache_budget));
        Self {
            editor: Arc::default(),
            display_profile: Arc::default(),
            startup: Arc::default(),
            startup_files: Arc::default(),
            computational: Default::default(),
            payload_residency: Arc::default(),
            gpu: Default::default(),
            lens_database: Arc::default(),
            export: Default::default(),
            film: Default::default(),
            preview_runtime: Arc::default(),
            preview_frames: Arc::default(),
            library: Default::default(),
            preview_session: Arc::default(),
            analytics: Arc::default(),
            full_warp_cache: Arc::default(),
            native_caches,
            #[cfg(feature = "ai")]
            ai,
            interactive_gpu_pressure: Arc::default(),
            source_fingerprints: Arc::new(crate::source_revision::FingerprintCache::new(64)),
            image_open: Arc::default(),
            viewer_sampling: Arc::new(
                crate::editor::viewer_sampling_service::ViewerSamplingService::new(cache_budget),
            ),
            jobs: Arc::default(),
        }
    }

    pub(crate) fn library(&self) -> &crate::library::runtime_services::LibraryRuntimeServices {
        &self.library
    }

    pub(crate) fn computational(
        &self,
    ) -> &crate::computational::runtime_services::ComputationalRuntimeServices {
        &self.computational
    }

    pub(crate) fn export(&self) -> &crate::export::runtime_services::ExportRuntimeServices {
        &self.export
    }

    pub(crate) fn film(&self) -> &crate::render::film_runtime_services::FilmRuntimeServices {
        &self.film
    }

    pub(crate) fn gpu(&self) -> &crate::gpu::runtime_services::GpuRuntimeServices {
        &self.gpu
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::smart_preview_scheduler::SmartPreviewDemandClass;
    use crate::merge::computational_job::{
        ComputationalMergeFamily, ComputationalMergeJobId, ComputationalMergeJobStatus,
    };
    use crate::source_revision::SourceRevision;
    use std::sync::Barrier;
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

    #[test]
    fn computational_job_service_keeps_concurrent_families_independent() {
        let services = Arc::new(AppServices::new());
        let hdr = services
            .computational()
            .jobs()
            .begin(ComputationalMergeFamily::Hdr, "decode", 2, 2)
            .unwrap();
        let focus = services
            .computational()
            .jobs()
            .begin(ComputationalMergeFamily::FocusStack, "align", 2, 2)
            .unwrap();
        let super_resolution = services
            .computational()
            .jobs()
            .begin(ComputationalMergeFamily::SuperResolution, "register", 2, 2)
            .unwrap();
        let barrier = Arc::new(Barrier::new(4));

        let cancel_hdr = {
            let services = Arc::clone(&services);
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                barrier.wait();
                services
                    .computational()
                    .jobs()
                    .cancel_active_family(ComputationalMergeFamily::Hdr)
            })
        };
        let advance_focus = {
            let services = Arc::clone(&services);
            let barrier = Arc::clone(&barrier);
            let job_id = focus.job_id.clone();
            thread::spawn(move || {
                barrier.wait();
                services
                    .computational()
                    .jobs()
                    .publish_progress(&job_id, "merge", 1, 2, 1, None)
            })
        };
        let finish_super_resolution = {
            let services = Arc::clone(&services);
            let barrier = Arc::clone(&barrier);
            let job_id = super_resolution.job_id;
            thread::spawn(move || {
                barrier.wait();
                services.computational().jobs().finish(&job_id)
            })
        };

        barrier.wait();
        assert!(cancel_hdr.join().unwrap().unwrap());
        assert_eq!(advance_focus.join().unwrap().unwrap().fraction, 0.5);
        assert!(finish_super_resolution.join().unwrap().unwrap());
        assert!(hdr.cancellation_token.checkpoint().is_err());
        assert!(!services.computational().jobs().finish(&hdr.job_id).unwrap());
        assert_eq!(
            services
                .computational()
                .jobs()
                .progress(&hdr.job_id)
                .unwrap()
                .status,
            ComputationalMergeJobStatus::Cancelled
        );
        assert_eq!(
            services
                .computational()
                .jobs()
                .cancel_active_family(ComputationalMergeFamily::Hdr)
                .unwrap_err(),
            "computational_merge_job_not_found"
        );
        assert_eq!(
            services
                .computational()
                .jobs()
                .cancel(&ComputationalMergeJobId::from_string(
                    "stale-job-id".to_string()
                ))
                .unwrap_err(),
            "computational_merge_job_not_found"
        );
        assert_eq!(
            services
                .computational()
                .jobs()
                .progress(&focus.job_id)
                .unwrap()
                .status,
            ComputationalMergeJobStatus::Active
        );
        assert!(
            services
                .computational()
                .jobs()
                .finish(&focus.job_id)
                .unwrap()
        );
    }

    #[test]
    fn source_fingerprint_service_shares_concurrent_digests_and_separates_revisions() {
        let services = Arc::new(AppServices::new());
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("source.raw");
        std::fs::write(&path, vec![17_u8; 2 * 1024 * 1024]).unwrap();
        let first_revision = SourceRevision::from_path(&path).unwrap();
        let handles: Vec<_> = (0..8)
            .map(|_| {
                let services = Arc::clone(&services);
                let revision = first_revision.clone();
                let path = path.clone();
                thread::spawn(move || {
                    services
                        .source_fingerprints
                        .fingerprint_streaming(&revision, &path)
                        .unwrap()
                        .sha256
                })
            })
            .collect();
        let digests: Vec<_> = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect();
        assert!(digests.windows(2).all(|pair| pair[0] == pair[1]));

        std::fs::write(&path, vec![23_u8; 2 * 1024 * 1024 + 1]).unwrap();
        let second_revision = SourceRevision::from_path(&path).unwrap();
        assert_ne!(first_revision, second_revision);
        let second = services
            .source_fingerprints
            .fingerprint_streaming(&second_revision, &path)
            .unwrap();
        assert_ne!(digests[0], second.sha256);
        assert_eq!(
            services
                .source_fingerprints
                .verified_sha256(&first_revision),
            Some(digests[0])
        );
        assert_eq!(
            services
                .source_fingerprints
                .verified_sha256(&second_revision),
            Some(second.sha256)
        );
    }

    #[test]
    fn smart_preview_service_coalesces_concurrent_revision_replacement() {
        let services = Arc::new(AppServices::new());
        let old_generation = services.library().smart_previews().enqueue(
            "/roll/image.raw".to_string(),
            "revision-1".to_string(),
            Vec::new(),
            SmartPreviewDemandClass::VisibleIdle,
        );
        let old_job = services.library().smart_previews().claim();
        assert_eq!(old_job.generation, old_generation);

        let barrier = Arc::new(Barrier::new(9));
        let handles: Vec<_> = (0..8)
            .map(|_| {
                let services = Arc::clone(&services);
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    barrier.wait();
                    services.library().smart_previews().enqueue(
                        "/roll/image.raw".to_string(),
                        "revision-2".to_string(),
                        vec![1, 2, 3],
                        SmartPreviewDemandClass::ExplicitBuild,
                    )
                })
            })
            .collect();
        barrier.wait();
        let generations: Vec<_> = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect();
        assert!(
            generations
                .iter()
                .all(|generation| *generation == generations[0])
        );
        assert_ne!(generations[0], old_generation);
        assert!(!services.library().smart_previews().is_publishable(&old_job));
        let cancelled = services.library().smart_previews().finish(&old_job, false);
        assert_eq!(cancelled.cancelled, 1);

        let replacement = services.library().smart_previews().claim();
        assert_eq!(replacement.generation, generations[0]);
        assert!(
            services
                .library()
                .smart_previews()
                .is_publishable(&replacement)
        );
        let progress = services
            .library()
            .smart_previews()
            .finish(&replacement, true);
        assert_eq!(progress.pending, 0);
        assert_eq!(progress.in_flight, 0);
        assert_eq!(progress.completed, 1);
        assert_eq!(progress.cancelled, 1);
    }
}
