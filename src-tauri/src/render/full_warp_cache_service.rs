use std::borrow::Cow;
use std::sync::{Arc, Mutex};

use image::DynamicImage;

use crate::app_state::AppState;
use crate::render::artifact_identity::{RenderArtifactIdentity, SourceArtifactIdentity};

#[derive(Clone, Debug, Eq, PartialEq)]
struct WarpSessionIdentity {
    image_session: u64,
    source: SourceArtifactIdentity,
}

struct CachedWarp {
    identity: RenderArtifactIdentity,
    image: Arc<DynamicImage>,
}

#[derive(Default)]
struct WarpCacheState {
    active_epoch: u64,
    cached: Option<CachedWarp>,
    session: Option<WarpSessionIdentity>,
}

struct WarpRequestToken {
    epoch: u64,
    identity: RenderArtifactIdentity,
    session: WarpSessionIdentity,
}

enum WarpLookup {
    Hit(Arc<DynamicImage>),
    Miss(Box<WarpRequestToken>),
}

#[derive(Default)]
pub(crate) struct FullWarpCacheService {
    state: Mutex<WarpCacheState>,
}

impl FullWarpCacheService {
    pub(crate) fn install_session(&self, image_session: u64, source: &SourceArtifactIdentity) {
        let mut state = self.state.lock().expect("full warp cache poisoned");
        state.active_epoch = state.active_epoch.wrapping_add(1);
        state.cached = None;
        state.session = Some(WarpSessionIdentity {
            image_session,
            source: source.clone(),
        });
    }

    fn begin(&self, identity: RenderArtifactIdentity) -> Result<WarpLookup, String> {
        let mut state = self.state.lock().expect("full warp cache poisoned");
        let request_session = WarpSessionIdentity {
            image_session: identity.image_session,
            source: identity.source.clone(),
        };
        if state.session.as_ref() != Some(&request_session) {
            return Err("full_warp_cache.stale_session".to_string());
        }
        if let Some(cached) = state.cached.as_ref()
            && cached.identity == identity
        {
            return Ok(WarpLookup::Hit(Arc::clone(&cached.image)));
        }
        state.active_epoch = state.active_epoch.wrapping_add(1);
        Ok(WarpLookup::Miss(Box::new(WarpRequestToken {
            epoch: state.active_epoch,
            identity,
            session: request_session,
        })))
    }

    fn publish(&self, token: WarpRequestToken, image: Arc<DynamicImage>) -> bool {
        let mut state = self.state.lock().expect("full warp cache poisoned");
        if state.session.as_ref() != Some(&token.session) || state.active_epoch != token.epoch {
            return false;
        }
        state.cached = Some(CachedWarp {
            identity: token.identity,
            image,
        });
        true
    }

    pub(crate) fn clear_frame(&self) {
        let mut state = self.state.lock().expect("full warp cache poisoned");
        state.active_epoch = state.active_epoch.wrapping_add(1);
        state.cached = None;
    }

    pub(crate) fn clear_session(&self) {
        let mut state = self.state.lock().expect("full warp cache poisoned");
        state.active_epoch = state.active_epoch.wrapping_add(1);
        state.cached = None;
        state.session = None;
    }
}

pub(crate) fn get_cached_full_warped_image(
    state: &tauri::State<AppState>,
    adjustments: &serde_json::Value,
) -> Result<Arc<DynamicImage>, String> {
    let geometry_hash = crate::cache_utils::calculate_geometry_hash(adjustments);
    let loaded_image = state
        .original_image
        .lock()
        .expect("original image poisoned")
        .clone()
        .ok_or("No original image loaded")?;
    let identity = RenderArtifactIdentity::source_geometry(
        &loaded_image.artifact_source,
        state
            .load_image_generation
            .load(std::sync::atomic::Ordering::SeqCst) as u64,
        crate::cache_utils::calculate_transform_hash(adjustments),
        loaded_image.artifact_source.source_fingerprint(),
        geometry_hash,
        loaded_image.image.width(),
        loaded_image.image.height(),
    );
    let token = match state.services.full_warp_cache.begin(identity)? {
        WarpLookup::Hit(image) => return Ok(image),
        WarpLookup::Miss(token) => *token,
    };

    let (mut full_image, is_raw) = crate::get_full_image_for_processing(state)?;
    if is_raw {
        crate::image_processing::apply_cpu_default_raw_processing(&mut full_image);
    }
    let warped_image =
        crate::image_processing::apply_geometry_warp(Cow::Borrowed(&full_image), adjustments)
            .into_owned();
    let warped_image = Arc::new(warped_image);
    state
        .services
        .full_warp_cache
        .publish(token, Arc::clone(&warped_image));
    Ok(warped_image)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render::artifact_identity::tests_support::source;
    use std::sync::{Arc, Barrier};
    use std::thread;

    fn identity(path: &str, session: u64, geometry: u64) -> RenderArtifactIdentity {
        RenderArtifactIdentity::source_geometry(&source(path), session, geometry, 1, geometry, 4, 3)
    }

    fn miss(service: &FullWarpCacheService, identity: RenderArtifactIdentity) -> WarpRequestToken {
        match service.begin(identity).unwrap() {
            WarpLookup::Miss(token) => *token,
            WarpLookup::Hit(_) => panic!("expected cache miss"),
        }
    }

    #[test]
    fn late_a_cannot_replace_b_or_a_successor_within_one_session() {
        let service = FullWarpCacheService::default();
        let source = source("a.raw");
        service.install_session(7, &source);
        let old_a = miss(&service, identity("a.raw", 7, 1));
        let _b = miss(&service, identity("a.raw", 7, 2));
        let successor_a = miss(&service, identity("a.raw", 7, 1));

        assert!(!service.publish(old_a, Arc::new(DynamicImage::new_rgb8(1, 1))));
        assert!(service.publish(successor_a, Arc::new(DynamicImage::new_rgb8(3, 1))));
        match service.begin(identity("a.raw", 7, 1)).unwrap() {
            WarpLookup::Hit(image) => assert_eq!(image.width(), 3),
            WarpLookup::Miss(_) => panic!("successor A was not cached"),
        }
    }

    #[test]
    fn concurrent_old_source_publication_cannot_mutate_successor_session() {
        let service = Arc::new(FullWarpCacheService::default());
        service.install_session(1, &source("a.raw"));
        let old = miss(&service, identity("a.raw", 1, 1));
        let release = Arc::new(Barrier::new(2));
        let worker = {
            let release = Arc::clone(&release);
            let service = Arc::clone(&service);
            thread::spawn(move || {
                release.wait();
                service.publish(old, Arc::new(DynamicImage::new_rgb8(1, 1)))
            })
        };

        service.install_session(3, &source("a.raw"));
        release.wait();
        assert!(!worker.join().unwrap());
        assert!(matches!(
            service.begin(identity("a.raw", 3, 1)).unwrap(),
            WarpLookup::Miss(_)
        ));
    }
}
