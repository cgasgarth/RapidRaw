//! Private ownership for the active decoded editor image.
//!
//! Callers receive immutable snapshots and never hold the service mutex while
//! rendering, performing I/O, emitting events, or awaiting work.

use std::sync::{Arc, Mutex};

use image::DynamicImage;

#[derive(Clone)]
pub(crate) struct LoadedImage {
    pub(crate) path: String,
    pub(crate) image: Arc<DynamicImage>,
    pub(crate) is_raw: bool,
    pub(crate) artifact_source: crate::render::artifact_identity::SourceArtifactIdentity,
}

#[derive(Default)]
pub(crate) struct EditorImageService {
    current: Mutex<Option<LoadedImage>>,
}

impl EditorImageService {
    pub(crate) fn install(&self, image: LoadedImage) {
        *self.current.lock().expect("editor image service poisoned") = Some(image);
    }

    pub(crate) fn snapshot(&self) -> Option<LoadedImage> {
        self.current
            .lock()
            .expect("editor image service poisoned")
            .clone()
    }

    #[cfg(feature = "validation-harness")]
    pub(crate) fn try_snapshot(&self) -> Option<LoadedImage> {
        self.current.lock().ok()?.clone()
    }

    pub(crate) fn clear(&self) {
        *self.current.lock().expect("editor image service poisoned") = None;
    }

    pub(crate) fn clone_pixels(&self) -> Result<(DynamicImage, bool), String> {
        let loaded = self.snapshot().ok_or("No original image loaded")?;
        Ok((loaded.image.as_ref().clone(), loaded.is_raw))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render::artifact_identity::tests_support::source;

    fn loaded(path: &str, width: u32, is_raw: bool) -> LoadedImage {
        LoadedImage {
            path: path.to_string(),
            image: Arc::new(DynamicImage::new_rgb8(width, 2)),
            is_raw,
            artifact_source: source(path),
        }
    }

    #[test]
    fn snapshots_are_atomic_and_pixel_clones_cannot_mutate_the_source() {
        let service = EditorImageService::default();
        assert_eq!(
            service.clone_pixels().unwrap_err(),
            "No original image loaded"
        );

        service.install(loaded("a.raw", 3, true));
        let snapshot = service.snapshot().unwrap();
        assert_eq!(snapshot.path, "a.raw");
        let (mut pixels, is_raw) = service.clone_pixels().unwrap();
        pixels = pixels.resize_exact(1, 1, image::imageops::FilterType::Nearest);
        assert!(is_raw);
        assert_eq!(pixels.width(), 1);
        assert_eq!(service.snapshot().unwrap().image.width(), 3);

        service.install(loaded("b.jpg", 5, false));
        assert_eq!(service.snapshot().unwrap().path, "b.jpg");
        service.clear();
        assert!(service.snapshot().is_none());
    }
}
