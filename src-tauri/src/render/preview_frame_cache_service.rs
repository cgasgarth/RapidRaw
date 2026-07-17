//! Private ownership for the edited preview frame cache.
//!
//! Rendering receives immutable snapshots. Publication uses an epoch token so
//! Reset, device loss, or a successor request cannot be followed by a stale
//! in-flight cache write.

use std::sync::Mutex;

#[derive(Clone)]
pub(crate) struct CachedPreview {
    pub(crate) image: crate::gpu_processing::RevisionedImage,
    pub(crate) small_image: crate::gpu_processing::RevisionedImage,
    pub(crate) identity: crate::render::artifact_identity::RenderArtifactIdentity,
    pub(crate) scale: f32,
    pub(crate) unscaled_crop_offset: (f32, f32),
    pub(crate) preview_dim: u32,
    pub(crate) interactive_divisor: f32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct PreviewFrameRequest(u64);

#[derive(Default)]
struct PreviewFrameCacheState {
    epoch: u64,
    cached: Option<CachedPreview>,
}

#[derive(Default)]
pub(crate) struct PreviewFrameCacheService {
    state: Mutex<PreviewFrameCacheState>,
}

impl PreviewFrameCacheService {
    pub(crate) fn begin_request(&self) -> PreviewFrameRequest {
        let mut state = self.state.lock().expect("preview frame cache poisoned");
        state.epoch = state
            .epoch
            .checked_add(1)
            .expect("preview frame cache epoch exhausted");
        PreviewFrameRequest(state.epoch)
    }

    pub(crate) fn snapshot(&self) -> Option<CachedPreview> {
        self.state
            .lock()
            .expect("preview frame cache poisoned")
            .cached
            .clone()
    }

    #[cfg(feature = "validation-harness")]
    pub(crate) fn try_snapshot(&self) -> Option<CachedPreview> {
        self.state.lock().ok()?.cached.clone()
    }

    pub(crate) fn publish_if_current(
        &self,
        request: PreviewFrameRequest,
        preview: CachedPreview,
    ) -> bool {
        let mut state = self.state.lock().expect("preview frame cache poisoned");
        if state.epoch != request.0 {
            return false;
        }
        if state.cached.as_ref().is_some_and(|current| {
            current
                .identity
                .same_content_different_resolution(&preview.identity)
                && preview.preview_dim < current.preview_dim
        }) {
            // A duplicate low-tier request must never downgrade the reusable
            // base. The request can still complete for the caller, but the
            // sharp cache remains authoritative for the next render.
            return false;
        }
        state.cached = Some(preview);
        true
    }

    pub(crate) fn clear(&self) {
        let mut state = self.state.lock().expect("preview frame cache poisoned");
        state.epoch = state
            .epoch
            .checked_add(1)
            .expect("preview frame cache epoch exhausted");
        state.cached = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};
    use std::thread;

    fn cached(path: &str, generation: u64, width: u32) -> CachedPreview {
        let image = Arc::new(image::DynamicImage::new_rgb8(width, 2));
        let revision = crate::gpu_processing::PixelBufferRevision::constructed(
            generation,
            generation,
            generation,
            width,
            2,
            image.color(),
        );
        CachedPreview {
            image: crate::gpu_processing::RevisionedImage::new(Arc::clone(&image), revision),
            small_image: crate::gpu_processing::RevisionedImage::new(image, revision),
            identity: crate::render::artifact_identity::RenderArtifactIdentity::source_geometry(
                &crate::render::artifact_identity::tests_support::source(path),
                generation,
                generation,
                generation,
                generation,
                width,
                2,
            ),
            scale: 1.0,
            unscaled_crop_offset: (0.0, 0.0),
            preview_dim: width,
            interactive_divisor: 1.0,
        }
    }

    #[test]
    fn clear_and_successor_request_reject_late_publication() {
        let service = Arc::new(PreviewFrameCacheService::default());
        let stale = service.begin_request();
        let barrier = Arc::new(Barrier::new(2));
        let late_service = Arc::clone(&service);
        let late_barrier = Arc::clone(&barrier);
        let late = thread::spawn(move || {
            late_barrier.wait();
            late_service.publish_if_current(stale, cached("stale.raw", 1, 3))
        });

        service.clear();
        let current = service.begin_request();
        assert!(service.publish_if_current(current, cached("current.raw", 2, 5)));
        barrier.wait();
        assert!(!late.join().unwrap());

        let snapshot = service.snapshot().unwrap();
        assert_eq!(snapshot.identity.source.canonical_identity, "current.raw");
        assert_eq!(snapshot.image.shared_image().width(), 5);
        service.clear();
        assert!(service.snapshot().is_none());
    }

    #[test]
    fn lower_resolution_duplicate_does_not_replace_sharp_cache() {
        let service = PreviewFrameCacheService::default();
        let request = service.begin_request();
        assert!(service.publish_if_current(request, cached("same.raw", 1, 4096)));
        assert!(!service.publish_if_current(request, cached("same.raw", 1, 1920)));
        let snapshot = service.snapshot().expect("sharp cache remains");
        assert_eq!(snapshot.preview_dim, 4096);
        assert_eq!(snapshot.image.shared_image().width(), 4096);
    }
}
