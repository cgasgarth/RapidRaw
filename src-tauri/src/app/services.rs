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

pub struct EditorRuntimeService {
    image: Arc<crate::editor::image_service::EditorImageService>,
    viewer_sampling: Arc<crate::editor::viewer_sampling_service::ViewerSamplingService>,
}

impl EditorRuntimeService {
    fn new(cache_budget: Arc<crate::render::native_cache::CacheBudgetCoordinator>) -> Self {
        Self {
            image: Arc::default(),
            viewer_sampling: Arc::new(
                crate::editor::viewer_sampling_service::ViewerSamplingService::new(cache_budget),
            ),
        }
    }

    #[cfg(all(test, feature = "tauri-test"))]
    pub(crate) fn install_image(&self, image: crate::editor::image_service::LoadedImage) {
        self.image.install(image);
    }

    pub(crate) fn install_active_image(
        &self,
        image_session: u64,
        image_identity: &str,
        image: crate::editor::image_service::LoadedImage,
    ) {
        self.viewer_sampling
            .install_session(image_session, image_identity);
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

    pub(crate) fn clear_active_image(&self) {
        self.image.clear();
        self.viewer_sampling.clear_session();
    }

    pub(crate) fn clear_viewer_frames(&self) {
        self.viewer_sampling.clear_frames();
    }

    pub(crate) fn viewer_sample_stats(&self) -> crate::render::native_cache::CacheStats {
        self.viewer_sampling.stats()
    }

    pub(crate) fn publish_viewer_sample(
        &self,
        slot: crate::editor::viewer_sampling_service::ViewerSampleCacheSlot,
        frame: crate::editor::viewer_sampling_service::CachedViewerSampleFrame,
    ) -> crate::editor::viewer_sampling_service::ViewerSamplePublishDisposition {
        self.viewer_sampling.publish(slot, frame)
    }

    pub(crate) fn viewer_sample_frame(
        &self,
        key: &str,
    ) -> Option<Arc<crate::editor::viewer_sampling_service::CachedViewerSampleFrame>> {
        self.viewer_sampling.frame_for_key(key)
    }

    pub(crate) fn sample_viewer_pixel(
        &self,
        request: crate::editor::viewer_sampling_service::ViewerSampleRequest,
    ) -> crate::editor::viewer_sampling_service::ViewerSampleResponse {
        self.viewer_sampling.sample(request)
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
    editor: Arc<EditorRuntimeService>,
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
    render: crate::render::runtime_services::RenderRuntimeServices,
    library: crate::library::runtime_services::LibraryRuntimeServices,
    #[cfg(feature = "ai")]
    pub(crate) ai: Arc<crate::ai::runtime_service::AiRuntimeService>,
    pub(crate) source_fingerprints: Arc<crate::source_revision::FingerprintCache>,
    pub(crate) image_open: Arc<crate::image_open_session::ImageOpenCoordinator>,
    pub jobs: Arc<JobCoordinator>,
}

impl AppServices {
    pub(crate) fn new() -> Self {
        let render = crate::render::runtime_services::RenderRuntimeServices::default();
        let cache_budget = render.native_caches().budget();
        #[cfg(feature = "ai")]
        let ai = Arc::new(crate::ai::runtime_service::AiRuntimeService::new(
            Arc::clone(&cache_budget),
        ));
        crate::patch_assets::initialize_patch_asset_cache(Arc::clone(&cache_budget));
        Self {
            editor: Arc::new(EditorRuntimeService::new(Arc::clone(&cache_budget))),
            display_profile: Arc::default(),
            startup: Arc::default(),
            startup_files: Arc::default(),
            computational: Default::default(),
            payload_residency: Arc::default(),
            gpu: Default::default(),
            lens_database: Arc::default(),
            export: Default::default(),
            film: Default::default(),
            render,
            library: Default::default(),
            #[cfg(feature = "ai")]
            ai,
            source_fingerprints: Arc::new(crate::source_revision::FingerprintCache::new(64)),
            image_open: Arc::default(),
            jobs: Arc::default(),
        }
    }

    pub(crate) fn library(&self) -> &crate::library::runtime_services::LibraryRuntimeServices {
        &self.library
    }

    pub(crate) fn editor(&self) -> &Arc<EditorRuntimeService> {
        &self.editor
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

    pub(crate) fn render(&self) -> &crate::render::runtime_services::RenderRuntimeServices {
        &self.render
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::image_service::LoadedImage;
    use crate::editor::viewer_sampling_service::{
        CachedViewerSampleFrame, SampleablePixels, ViewerSampleCacheSlot,
        ViewerSamplePublishDisposition,
    };
    use crate::library::smart_preview_scheduler::SmartPreviewDemandClass;
    use crate::merge::computational_job::{
        ComputationalMergeFamily, ComputationalMergeJobId, ComputationalMergeJobStatus,
    };
    use crate::source_revision::SourceRevision;
    use image::{DynamicImage, ImageBuffer};
    use std::sync::Barrier;
    use std::thread;

    fn editor_service() -> EditorRuntimeService {
        EditorRuntimeService::new(crate::render::native_cache::CacheBudgetCoordinator::new(
            256 * 1024 * 1024,
            512 * 1024 * 1024,
        ))
    }

    fn loaded(path: &str, value: u8) -> LoadedImage {
        LoadedImage {
            path: path.to_string(),
            image: Arc::new(DynamicImage::ImageRgb8(ImageBuffer::from_pixel(
                1,
                1,
                image::Rgb([value; 3]),
            ))),
            is_raw: true,
            artifact_source: crate::render::artifact_identity::tests_support::source(path),
        }
    }

    fn sample_frame(path: &str, image_session: u64, value: u8) -> CachedViewerSampleFrame {
        CachedViewerSampleFrame {
            artifact_identity:
                crate::render::artifact_identity::RenderArtifactIdentity::source_geometry(
                    &crate::render::artifact_identity::tests_support::source(path),
                    image_session,
                    1,
                    1,
                    1,
                    1,
                    1,
                ),
            graph_revision: "graph-current".to_string(),
            pixels: SampleablePixels::native(Arc::new(DynamicImage::ImageRgb8(
                ImageBuffer::from_pixel(1, 1, image::Rgb([value; 3])),
            ))),
            image_identity: path.to_string(),
            space_label: "Display encoded sRGB".to_string(),
        }
    }

    #[test]
    fn editor_runtime_rejects_stale_sample_publication_after_active_image_switch() {
        let service = Arc::new(editor_service());
        service.install_active_image(1, "a.raw", loaded("a.raw", 10));

        let publish_barrier = Arc::new(Barrier::new(2));
        let stale_publisher = {
            let service = Arc::clone(&service);
            let publish_barrier = Arc::clone(&publish_barrier);
            thread::spawn(move || {
                publish_barrier.wait();
                service.publish_viewer_sample(
                    ViewerSampleCacheSlot::Edited,
                    sample_frame("a.raw", 1, 20),
                )
            })
        };

        service.install_active_image(2, "b.raw", loaded("b.raw", 30));
        publish_barrier.wait();
        assert_eq!(
            stale_publisher.join().unwrap(),
            ViewerSamplePublishDisposition::RejectedStaleSession
        );
        assert_eq!(
            service.publish_viewer_sample(
                ViewerSampleCacheSlot::Edited,
                sample_frame("b.raw", 2, 40),
            ),
            ViewerSamplePublishDisposition::Published
        );

        assert_eq!(service.image_snapshot().unwrap().path, "b.raw");
        let frame = service.viewer_sample_frame("edited").unwrap();
        assert_eq!(frame.image_identity, "b.raw");
        assert_eq!(frame.artifact_identity.image_session, 2);

        service.clear_active_image();
        assert!(service.image_snapshot().is_none());
        assert!(service.viewer_sample_frame("edited").is_none());
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
