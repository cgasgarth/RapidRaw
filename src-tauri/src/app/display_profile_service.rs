//! Runtime ownership for the active display profile and its color transform snapshot.

#[cfg(not(any(target_os = "android", target_os = "linux")))]
use std::sync::{Arc, Mutex};

#[cfg(not(any(target_os = "android", target_os = "linux")))]
#[derive(Clone, Debug, Eq, PartialEq)]
struct DisplaySelectionIdentity {
    display_id: Option<u32>,
    icc_sha256: String,
}

#[cfg(not(any(target_os = "android", target_os = "linux")))]
#[derive(Default)]
struct DisplayProfileRuntimeState {
    current_identity: Option<DisplaySelectionIdentity>,
    current_snapshot: Option<Arc<crate::display_profile::DisplayPreviewTransformSnapshot>>,
    generation: u64,
}

/// Owns display-profile selection generation and publishes immutable pixel/tag snapshots.
#[derive(Default)]
pub(crate) struct DisplayProfileRuntimeService {
    #[cfg(not(any(target_os = "android", target_os = "linux")))]
    state: Mutex<DisplayProfileRuntimeState>,
}

impl DisplayProfileRuntimeService {
    pub(crate) fn active_profile_for_app(
        &self,
        app: &tauri::AppHandle,
    ) -> Result<crate::display_profile::ActiveDisplayProfile, String> {
        #[cfg(not(any(target_os = "android", target_os = "linux")))]
        {
            Ok(self.preview_transform_snapshot_for_app(app).profile.clone())
        }
        #[cfg(any(target_os = "android", target_os = "linux"))]
        {
            crate::display_profile::active_display_profile_for_app(app)
        }
    }

    pub(crate) fn preview_lut_status_for_app(
        &self,
        app: &tauri::AppHandle,
    ) -> Result<crate::display_profile::DisplayPreviewLutStatus, String> {
        #[cfg(not(any(target_os = "android", target_os = "linux")))]
        {
            let snapshot = self.preview_transform_snapshot_for_app(app);
            let status = match snapshot.profile.status {
                crate::display_profile::ActiveDisplayProfileStatus::ActiveProfileLoaded => {
                    crate::display_profile::DisplayPreviewLutTransformStatus::ActiveDisplayTransform
                }
                crate::display_profile::ActiveDisplayProfileStatus::FallbackNoActiveProfile => {
                    crate::display_profile::DisplayPreviewLutTransformStatus::SrgbFallbackTransform
                }
                crate::display_profile::ActiveDisplayProfileStatus::UnsupportedPlatform => {
                    crate::display_profile::DisplayPreviewLutTransformStatus::UnsupportedPlatform
                }
            };
            Ok(crate::display_profile::DisplayPreviewLutStatus {
                profile: snapshot.profile.clone(),
                sample_count: snapshot.lut.rgba16f.len() / 4,
                size: snapshot.lut.size,
                status,
            })
        }
        #[cfg(any(target_os = "android", target_os = "linux"))]
        {
            crate::display_profile::display_preview_lut_status_for_app(app)
        }
    }

    #[cfg(not(any(target_os = "android", target_os = "linux")))]
    pub(crate) fn preview_transform_snapshot_for_app(
        &self,
        app: &tauri::AppHandle,
    ) -> Arc<crate::display_profile::DisplayPreviewTransformSnapshot> {
        self.preview_transform_snapshot_from_capture(
            crate::display_profile::display_preview_transform_capture_for_app(app),
        )
    }

    #[cfg(not(any(target_os = "android", target_os = "linux")))]
    pub(crate) fn preview_transform_snapshot_from_capture(
        &self,
        capture: Result<(Option<u32>, Vec<u8>), String>,
    ) -> Arc<crate::display_profile::DisplayPreviewTransformSnapshot> {
        let captured_display_id = capture
            .as_ref()
            .ok()
            .and_then(|(display_id, _)| *display_id);
        let mut candidate =
            crate::display_profile::display_preview_transform_snapshot_from_capture(capture, 0);
        let identity = DisplaySelectionIdentity {
            display_id: captured_display_id.or(candidate.profile.display_id),
            icc_sha256: candidate.icc_sha256.clone(),
        };
        let mut state = self.state.lock().expect("display profile service poisoned");
        if state.current_identity.as_ref() == Some(&identity) {
            return Arc::clone(
                state
                    .current_snapshot
                    .as_ref()
                    .expect("display selection identity requires a snapshot"),
            );
        }
        state.generation = state
            .generation
            .checked_add(1)
            .expect("display profile generation exhausted");
        candidate.selection_generation = state.generation;
        let candidate = Arc::new(candidate);
        state.current_identity = Some(identity);
        state.current_snapshot = Some(Arc::clone(&candidate));
        candidate
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn display_lut_for_app(
        &self,
        app: &tauri::AppHandle,
    ) -> crate::display_profile::DisplayLut {
        self.preview_transform_snapshot_for_app(app).lut.clone()
    }
}

#[cfg(test)]
mod tests {
    #[cfg(not(any(target_os = "android", target_os = "linux")))]
    use std::sync::{Arc, Barrier};

    #[cfg(not(any(target_os = "android", target_os = "linux")))]
    use super::*;

    #[cfg(not(any(target_os = "android", target_os = "linux")))]
    #[test]
    fn concurrent_same_profile_advances_generation_exactly_once() {
        let service = Arc::new(DisplayProfileRuntimeService::default());
        let first_bytes = moxcms::ColorProfile::new_srgb().encode().unwrap();
        let first = service.preview_transform_snapshot_from_capture(Ok((Some(9), first_bytes)));
        assert_eq!(first.selection_generation, 1);

        let changed_bytes = moxcms::ColorProfile::new_display_p3().encode().unwrap();
        let barrier = Arc::new(Barrier::new(9));
        let handles: Vec<_> = (0..8)
            .map(|_| {
                let service = Arc::clone(&service);
                let barrier = Arc::clone(&barrier);
                let bytes = changed_bytes.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    service.preview_transform_snapshot_from_capture(Ok((Some(9), bytes)))
                })
            })
            .collect();
        barrier.wait();
        let snapshots: Vec<_> = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect();
        assert!(
            snapshots
                .iter()
                .all(|snapshot| snapshot.selection_generation == 2)
        );
        assert!(
            snapshots
                .windows(2)
                .all(|pair| Arc::ptr_eq(&pair[0], &pair[1]))
        );

        let moved =
            service.preview_transform_snapshot_from_capture(Ok((Some(10), changed_bytes.clone())));
        let same_moved =
            service.preview_transform_snapshot_from_capture(Ok((Some(10), changed_bytes)));
        assert_eq!(moved.selection_generation, 3);
        assert_eq!(same_moved.selection_generation, 3);
        assert!(Arc::ptr_eq(&moved, &same_moved));
    }

    #[cfg(not(any(target_os = "android", target_os = "linux")))]
    #[test]
    fn corrupt_profile_falls_back_to_one_stable_srgb_pixel_and_tag_snapshot() {
        let service = DisplayProfileRuntimeService::default();
        let first = service
            .preview_transform_snapshot_from_capture(Ok((Some(88), b"corrupt profile".to_vec())));
        let second = service
            .preview_transform_snapshot_from_capture(Ok((Some(88), b"corrupt profile".to_vec())));

        assert_eq!(first.selection_generation, 1);
        assert_eq!(second.selection_generation, 1);
        assert!(Arc::ptr_eq(&first, &second));
        assert_eq!(
            first.icc_sha256,
            crate::display_profile::sha256_hex(&first.icc_bytes)
        );
        assert_eq!(
            first.profile.icc_sha256.as_deref(),
            Some(first.icc_sha256.as_str())
        );
        assert_eq!(first.lut.profile.icc_sha256, first.profile.icc_sha256);
        assert!(moxcms::ColorProfile::new_from_slice(&first.icc_bytes).is_ok());
        let gray = first.lut.sample_rgb([0.5; 3]);
        assert!((gray[0] - gray[1]).abs() < 0.001 && (gray[1] - gray[2]).abs() < 0.001);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn active_macos_profile_builds_a_valid_lut_and_matching_icc_snapshot() {
        let service = DisplayProfileRuntimeService::default();
        let profile = crate::display_profile::active_display_profile().unwrap();
        let bytes = crate::display_profile::active_display_profile_bytes().unwrap();
        let snapshot =
            service.preview_transform_snapshot_from_capture(Ok((profile.display_id, bytes)));

        assert_eq!(snapshot.selection_generation, 1);
        assert_eq!(
            snapshot.icc_sha256,
            crate::display_profile::sha256_hex(&snapshot.icc_bytes)
        );
        assert_eq!(
            snapshot.profile.icc_sha256.as_deref(),
            Some(snapshot.icc_sha256.as_str())
        );
        assert_eq!(snapshot.lut.size, crate::display_profile::DISPLAY_LUT_SIZE);
        assert_eq!(snapshot.lut.rgba16f.len(), 4 * 32_usize.pow(3));
        assert!(
            snapshot
                .lut
                .sample_rgb([0.18; 3])
                .iter()
                .all(|value| value.is_finite())
        );
    }
}
