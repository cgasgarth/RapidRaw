use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::{error::Error, fmt};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct UncroppedPreviewRequest {
    epoch: u64,
    image_generation: u64,
    source_identity: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ActiveImageSession {
    image_generation: u64,
    source_identity: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ActiveImageSourceError {
    Missing,
    Stale,
}

impl fmt::Display for ActiveImageSourceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Missing => "No original image loaded",
            Self::Stale => "Preview request rejected: expected image is no longer loaded",
        })
    }
}

impl Error for ActiveImageSourceError {}

pub(crate) fn validate_expected_preview_image(
    actual_path: &str,
    expected_path: &str,
) -> Result<(), ActiveImageSourceError> {
    if actual_path == expected_path {
        Ok(())
    } else {
        Err(ActiveImageSourceError::Stale)
    }
}

#[derive(Default)]
struct PreviewSessionAuthority {
    epoch: u64,
    active_image: Option<ActiveImageSession>,
}

/// Typed currentness handle for one image load.
#[derive(Clone, Debug)]
pub(crate) struct ImageLoadOperation {
    generation: usize,
    tracker: Arc<AtomicUsize>,
}

impl ImageLoadOperation {
    pub(crate) fn generation(&self) -> u64 {
        self.generation as u64
    }

    pub(crate) fn is_current(&self) -> bool {
        self.tracker.load(Ordering::SeqCst) == self.generation
    }

    pub(crate) fn cancellation_pair(&self) -> (Arc<AtomicUsize>, usize) {
        (Arc::clone(&self.tracker), self.generation)
    }
}

/// Owns image-load generation, the active image session, and preview publication authority.
///
/// Image-load completion and image-session installation are one bounded in-memory transition.
/// Callers must not perform I/O, GPU work, event emission, or awaited work in that transition.
pub(crate) struct PreviewSessionService {
    authority: Mutex<PreviewSessionAuthority>,
    generation: Arc<AtomicUsize>,
}

impl Default for PreviewSessionService {
    fn default() -> Self {
        Self {
            authority: Mutex::new(PreviewSessionAuthority::default()),
            generation: Arc::new(AtomicUsize::new(0)),
        }
    }
}

impl PreviewSessionService {
    pub(crate) fn validate_active_source(
        &self,
        expected_source_identity: &str,
    ) -> Result<(), ActiveImageSourceError> {
        let authority = self
            .authority
            .lock()
            .expect("preview-session authority poisoned");
        match authority.active_image.as_ref() {
            None => Err(ActiveImageSourceError::Missing),
            Some(active) if active.source_identity != expected_source_identity => {
                Err(ActiveImageSourceError::Stale)
            }
            Some(_) => Ok(()),
        }
    }

    pub(crate) fn begin_image_load(&self) -> ImageLoadOperation {
        let mut authority = self
            .authority
            .lock()
            .expect("preview-session authority poisoned");
        authority.epoch = authority.epoch.wrapping_add(1);
        authority.active_image = None;
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        ImageLoadOperation {
            generation,
            tracker: Arc::clone(&self.generation),
        }
    }

    pub(crate) fn current_operation(&self) -> ImageLoadOperation {
        ImageLoadOperation {
            generation: self.generation.load(Ordering::SeqCst),
            tracker: Arc::clone(&self.generation),
        }
    }

    pub(crate) fn current_generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst) as u64
    }

    pub(crate) fn complete_image_load<T>(
        &self,
        operation: &ImageLoadOperation,
        source_identity: &str,
        publish: impl FnOnce() -> T,
    ) -> Option<T> {
        let mut authority = self
            .authority
            .lock()
            .expect("preview-session authority poisoned");
        if !operation.is_current() {
            return None;
        }
        let published = publish();
        authority.active_image = Some(ActiveImageSession {
            image_generation: operation.generation(),
            source_identity: source_identity.to_string(),
        });
        Some(published)
    }

    pub(crate) fn with_active_image_session<T>(
        &self,
        image_generation: u64,
        source_identity: &str,
        work: impl FnOnce() -> T,
    ) -> Option<T> {
        let authority = self
            .authority
            .lock()
            .expect("preview-session authority poisoned");
        let expected = ActiveImageSession {
            image_generation,
            source_identity: source_identity.to_string(),
        };
        (authority.active_image.as_ref() == Some(&expected)).then(work)
    }

    pub(crate) fn begin_request(&self, source_identity: String) -> Option<UncroppedPreviewRequest> {
        let mut authority = self
            .authority
            .lock()
            .expect("preview-session authority poisoned");
        let image_generation = self.current_generation();
        let requested_image = ActiveImageSession {
            image_generation,
            source_identity: source_identity.clone(),
        };
        if authority.active_image.as_ref() != Some(&requested_image) {
            return None;
        }
        authority.epoch = authority.epoch.wrapping_add(1);
        Some(UncroppedPreviewRequest {
            epoch: authority.epoch,
            image_generation,
            source_identity,
        })
    }

    pub(crate) fn publish_if_current<CurrentSource, Publish>(
        &self,
        request: &UncroppedPreviewRequest,
        current_source: CurrentSource,
        publish: Publish,
    ) -> bool
    where
        CurrentSource: FnOnce() -> Option<String>,
        Publish: FnOnce(),
    {
        let authority = self
            .authority
            .lock()
            .expect("preview-session authority poisoned");
        let request_image = ActiveImageSession {
            image_generation: request.image_generation,
            source_identity: request.source_identity.clone(),
        };
        let is_current = authority.epoch == request.epoch
            && authority.active_image.as_ref() == Some(&request_image)
            && request.image_generation == self.current_generation()
            && current_source().as_deref() == Some(request.source_identity.as_str());
        if is_current {
            publish();
        }
        is_current
    }
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    use super::*;

    fn install(service: &PreviewSessionService, source: &str) -> ImageLoadOperation {
        let operation = service.begin_image_load();
        service
            .complete_image_load(&operation, source, || ())
            .expect("current load installs");
        operation
    }

    #[test]
    fn later_request_supersedes_earlier_request() {
        let service = PreviewSessionService::default();
        install(&service, "/image-a.raw");
        let first = service.begin_request("/image-a.raw".to_string()).unwrap();
        let second = service.begin_request("/image-a.raw".to_string()).unwrap();
        let mut published = Vec::new();

        assert!(!service.publish_if_current(
            &first,
            || Some("/image-a.raw".to_string()),
            || published.push("first"),
        ));
        assert!(service.publish_if_current(
            &second,
            || Some("/image-a.raw".to_string()),
            || published.push("second"),
        ));
        assert_eq!(published, ["second"]);
    }

    #[test]
    fn stale_load_cannot_install_after_a_new_generation_begins() {
        let service = PreviewSessionService::default();
        let stale = service.begin_image_load();
        let (cancellation_tracker, stale_generation) = stale.cancellation_pair();
        let current = service.begin_image_load();
        let mut published = Vec::new();

        assert!(
            service
                .complete_image_load(&stale, "/stale.raw", || published.push("stale"))
                .is_none()
        );
        assert!(published.is_empty());
        assert!(!stale.is_current());
        assert_ne!(
            cancellation_tracker.load(Ordering::SeqCst),
            stale_generation
        );
        assert!(current.is_current());
        assert_eq!(current.generation(), stale.generation() + 1);
        assert!(
            service
                .complete_image_load(&current, "/current.raw", || published.push("current"))
                .is_some()
        );
        assert_eq!(published, ["current"]);
        assert!(service.begin_request("/current.raw".to_string()).is_some());
    }

    #[test]
    fn image_switch_waits_for_atomic_publication_then_invalidates_it() {
        let service = Arc::new(PreviewSessionService::default());
        let installed = install(&service, "/a.raw");
        let installed_generation = installed.generation();
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let publisher_service = Arc::clone(&service);
        let publisher = thread::spawn(move || {
            publisher_service.with_active_image_session(installed_generation, "/a.raw", || {
                entered_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                "published"
            })
        });
        entered_rx.recv().unwrap();

        let (transition_tx, transition_rx) = mpsc::channel();
        let transition_service = Arc::clone(&service);
        let transition = thread::spawn(move || {
            transition_tx
                .send(transition_service.begin_image_load())
                .unwrap();
        });
        assert!(
            transition_rx
                .recv_timeout(Duration::from_millis(25))
                .is_err()
        );

        release_tx.send(()).unwrap();
        assert_eq!(publisher.join().unwrap(), Some("published"));
        let next = transition_rx.recv().unwrap();
        transition.join().unwrap();
        assert_eq!(next.generation(), installed_generation + 1);
        assert_eq!(
            service.with_active_image_session(installed_generation, "/a.raw", || {
                panic!("stale output published after image switch")
            }),
            None
        );
    }

    #[test]
    fn active_source_validation_is_owned_by_the_atomic_image_session() {
        let service = PreviewSessionService::default();
        assert_eq!(
            service.validate_active_source("/a.raw"),
            Err(ActiveImageSourceError::Missing)
        );
        install(&service, "/a.raw");
        assert_eq!(service.validate_active_source("/a.raw"), Ok(()));
        assert_eq!(
            service.validate_active_source("/b.raw"),
            Err(ActiveImageSourceError::Stale)
        );
        service.begin_image_load();
        assert_eq!(
            service.validate_active_source("/a.raw"),
            Err(ActiveImageSourceError::Missing)
        );
        assert_eq!(
            validate_expected_preview_image("/b.raw", "/a.raw"),
            Err(ActiveImageSourceError::Stale)
        );
    }
}
