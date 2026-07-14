use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde::Serialize;

#[cfg(any(test, feature = "validation-harness"))]
use super::hdr_display_capability::EdrHeadroomSample;
use super::hdr_display_capability::HdrDisplayCapabilityV1;
#[cfg(any(test, target_os = "macos", feature = "validation-harness"))]
use super::hdr_display_capability::compile_hdr_display_capability;
#[cfg(target_os = "macos")]
use super::hdr_display_capability::query_edr_headroom;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DisplayColorSpace {
    DisplayEncodedSrgb,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayTargetIdentity {
    pub display_id: Option<u32>,
    pub profile_sha256: String,
    pub scale_factor_bits: u64,
    pub color_space: DisplayColorSpace,
    pub hdr_capability_fingerprint: u64,
}

#[derive(Clone)]
pub struct ResolvedDisplayTarget {
    pub identity: DisplayTargetIdentity,
    pub color_contract: String,
    pub hdr_capability: HdrDisplayCapabilityV1,
    #[cfg(not(any(target_os = "android", target_os = "linux")))]
    capture: Result<(Option<u32>, Vec<u8>), String>,
    #[cfg(not(any(target_os = "android", target_os = "linux")))]
    snapshot: Option<Arc<crate::display_profile::DisplayPreviewTransformSnapshot>>,
}

impl ResolvedDisplayTarget {
    #[cfg(not(any(target_os = "android", target_os = "linux")))]
    fn materialize(mut self) -> Result<Self, String> {
        validate_hdr_capability_contract(&self.identity, &self.hdr_capability)?;
        if let Some(snapshot) = &self.snapshot {
            validate_color_contract(
                &self.identity.profile_sha256,
                &snapshot.icc_sha256,
                snapshot.encoding_contract,
            )?;
            return Ok(self);
        }
        let snapshot = Arc::new(
            crate::display_profile::display_preview_transform_snapshot_from_capture(
                self.capture.clone(),
            ),
        );
        validate_color_contract(
            &self.identity.profile_sha256,
            &snapshot.icc_sha256,
            snapshot.encoding_contract,
        )?;
        self.snapshot = Some(snapshot);
        Ok(self)
    }

    #[cfg(any(target_os = "android", target_os = "linux"))]
    fn materialize(self) -> Result<Self, String> {
        validate_hdr_capability_contract(&self.identity, &self.hdr_capability)?;
        Ok(self)
    }
}

#[derive(Clone)]
struct DisplayResources {
    device_generation: u64,
    generation: u64,
    target: ResolvedDisplayTarget,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayTargetReport {
    pub process_id: u32,
    pub raw_events: u64,
    pub coalesced_events: u64,
    pub resolutions: u64,
    pub same_target_noops: u64,
    pub display_resource_builds: u64,
    pub stale_builds_discarded: u64,
    pub build_failures: u64,
    pub latest_build_duration_micros: u64,
    pub compute_context_resets_from_display_events: u64,
    pub in_flight_jobs_cancelled_from_display_events: u64,
    pub blank_frames_from_display_events: u64,
    pub device_generation: Option<u64>,
    pub display_resource_generation: Option<u64>,
    pub target: Option<DisplayTargetIdentity>,
    pub color_contract: Option<String>,
    pub hdr_capability: Option<HdrDisplayCapabilityV1>,
    pub pending: bool,
    pub building: bool,
    pub injected_cross_display_transition_verified: bool,
    pub atomic_generation_swap_verified: bool,
    pub old_resource_lease_preserved: bool,
    pub mismatched_publish_excluded: bool,
    pub export_lease_preserved: bool,
    pub interaction_churn_duration_micros: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayTargetChange {
    pub device_generation: u64,
    pub display_resource_generation: u64,
    pub target: DisplayTargetIdentity,
}

struct CoordinatorState {
    report: DisplayTargetReport,
    latest_revision: u64,
    requested_at: Instant,
    requested_device_generation: u64,
    current: Option<Arc<DisplayResources>>,
    stopped: bool,
}

struct CoordinatorShared {
    state: Mutex<CoordinatorState>,
    wake: Condvar,
    debounce: Duration,
    resolver: Arc<dyn Fn(u64) -> Result<ResolvedDisplayTarget, String> + Send + Sync>,
    publisher: Arc<dyn Fn(DisplayTargetChange) + Send + Sync>,
}

pub struct DisplayTargetCoordinator {
    shared: Arc<CoordinatorShared>,
    owner: Mutex<Option<JoinHandle<()>>>,
}

impl DisplayTargetCoordinator {
    pub fn new(
        debounce: Duration,
        resolver: impl Fn(u64) -> Result<ResolvedDisplayTarget, String> + Send + Sync + 'static,
    ) -> Arc<Self> {
        Self::new_with_publisher(debounce, resolver, |_| {})
    }

    pub fn new_with_publisher(
        debounce: Duration,
        resolver: impl Fn(u64) -> Result<ResolvedDisplayTarget, String> + Send + Sync + 'static,
        publisher: impl Fn(DisplayTargetChange) + Send + Sync + 'static,
    ) -> Arc<Self> {
        let shared = Arc::new(CoordinatorShared {
            state: Mutex::new(CoordinatorState {
                report: DisplayTargetReport::default(),
                latest_revision: 0,
                requested_at: Instant::now(),
                requested_device_generation: 0,
                current: None,
                stopped: false,
            }),
            wake: Condvar::new(),
            debounce,
            resolver: Arc::new(resolver),
            publisher: Arc::new(publisher),
        });
        let worker_shared = Arc::clone(&shared);
        let owner = std::thread::Builder::new()
            .name("display-target-resolver".to_string())
            .spawn(move || resolver_loop(worker_shared))
            .expect("display target resolver thread");
        Arc::new(Self {
            shared,
            owner: Mutex::new(Some(owner)),
        })
    }

    pub fn request_refresh(&self, device_generation: u64) -> u64 {
        let mut state = self.shared.state.lock().unwrap();
        state.report.raw_events += 1;
        if state.report.pending || state.report.building {
            state.report.coalesced_events += 1;
        }
        state.latest_revision += 1;
        state.requested_at = Instant::now();
        state.requested_device_generation = device_generation;
        state.report.pending = true;
        let revision = state.latest_revision;
        drop(state);
        self.shared.wake.notify_one();
        revision
    }

    pub fn report(&self) -> DisplayTargetReport {
        let mut report = self.shared.state.lock().unwrap().report.clone();
        report.process_id = std::process::id();
        report
    }

    #[cfg(not(any(target_os = "android", target_os = "linux")))]
    pub fn current_snapshot(
        &self,
    ) -> Option<Arc<crate::display_profile::DisplayPreviewTransformSnapshot>> {
        self.shared
            .state
            .lock()
            .unwrap()
            .current
            .as_ref()
            .and_then(|resources| resources.target.snapshot.as_ref().map(Arc::clone))
    }

    pub fn wait_for_idle(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let mut state = self.shared.state.lock().unwrap();
        while state.report.pending || state.report.building {
            let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                return false;
            };
            let (next, result) = self.shared.wake.wait_timeout(state, remaining).unwrap();
            state = next;
            if result.timed_out() && (state.report.pending || state.report.building) {
                return false;
            }
        }
        true
    }

    #[cfg(any(test, feature = "validation-harness"))]
    fn current_resources_for_test(&self) -> Option<Arc<DisplayResources>> {
        self.shared.state.lock().unwrap().current.clone()
    }
}

#[cfg(target_os = "macos")]
pub fn request_for_state(state: &crate::AppState) {
    let device_generation = state
        .gpu_context
        .lock()
        .unwrap()
        .as_ref()
        .map_or(0, |context| context.generation);
    if let Some(coordinator) = state.display_target_coordinator.lock().unwrap().as_ref() {
        coordinator.request_refresh(device_generation);
    }
}

impl Drop for DisplayTargetCoordinator {
    fn drop(&mut self) {
        {
            let mut state = self.shared.state.lock().unwrap();
            state.stopped = true;
        }
        self.shared.wake.notify_all();
        if let Some(owner) = self.owner.lock().unwrap().take() {
            let _ = owner.join();
        }
    }
}

fn resolver_loop(shared: Arc<CoordinatorShared>) {
    loop {
        let (revision, device_generation) = {
            let mut state = shared.state.lock().unwrap();
            while !state.report.pending && !state.stopped {
                state = shared.wake.wait(state).unwrap();
            }
            if state.stopped {
                return;
            }
            loop {
                let deadline = state.requested_at + shared.debounce;
                let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                    break;
                };
                let (next, _) = shared.wake.wait_timeout(state, remaining).unwrap();
                state = next;
                if state.stopped {
                    return;
                }
            }
            state.report.pending = false;
            state.report.building = true;
            state.report.resolutions += 1;
            (state.latest_revision, state.requested_device_generation)
        };

        let resolved = (shared.resolver)(revision);
        let mut state = shared.state.lock().unwrap();
        if revision != state.latest_revision {
            state.report.building = false;
            state.report.stale_builds_discarded += 1;
            state.report.pending = true;
            state.requested_at = Instant::now();
            shared.wake.notify_all();
            continue;
        }
        let mut published_change = None;
        match resolved {
            Ok(target) => {
                let unchanged = state.current.as_ref().is_some_and(|current| {
                    current.device_generation == device_generation
                        && current.target.identity == target.identity
                });
                if unchanged {
                    state.report.building = false;
                    state.report.same_target_noops += 1;
                } else {
                    drop(state);
                    let build_started_at = Instant::now();
                    let target = match target.materialize() {
                        Ok(target) => target,
                        Err(error) => {
                            let mut state = shared.state.lock().unwrap();
                            state.report.building = false;
                            state.report.build_failures += 1;
                            log::warn!(
                                "display resource construction failed without resetting GPU: {error}"
                            );
                            shared.wake.notify_all();
                            continue;
                        }
                    };
                    let build_duration_micros = build_started_at.elapsed().as_micros() as u64;
                    state = shared.state.lock().unwrap();
                    state.report.building = false;
                    state.report.latest_build_duration_micros = build_duration_micros;
                    if revision != state.latest_revision {
                        state.report.stale_builds_discarded += 1;
                        state.report.pending = true;
                        state.requested_at = Instant::now();
                        shared.wake.notify_all();
                        continue;
                    }
                    let generation = state
                        .current
                        .as_ref()
                        .map_or(1, |current| current.generation + 1);
                    state.current = Some(Arc::new(DisplayResources {
                        device_generation,
                        generation,
                        target: target.clone(),
                    }));
                    state.report.display_resource_builds += 1;
                    state.report.device_generation = Some(device_generation);
                    state.report.display_resource_generation = Some(generation);
                    state.report.target = Some(target.identity);
                    state.report.color_contract = Some(target.color_contract);
                    state.report.hdr_capability = Some(target.hdr_capability);
                    published_change =
                        state
                            .report
                            .target
                            .clone()
                            .map(|target| DisplayTargetChange {
                                device_generation,
                                display_resource_generation: generation,
                                target,
                            });
                }
            }
            Err(error) => {
                state.report.building = false;
                state.report.build_failures += 1;
                log::warn!("display target resolution failed without resetting GPU: {error}");
            }
        }
        drop(state);
        if let Some(change) = published_change {
            (shared.publisher)(change);
        }
        shared.wake.notify_all();
    }
}

#[cfg(target_os = "macos")]
pub fn resolve_for_app(app: &tauri::AppHandle) -> Result<ResolvedDisplayTarget, String> {
    use tauri::Manager;

    let capture = crate::display_profile::display_preview_transform_capture_for_app(app);
    let (display_id, profile_sha256) = match &capture {
        Ok((display_id, bytes)) => (*display_id, crate::display_profile::sha256_hex(bytes)),
        Err(_) => {
            let bytes = moxcms::ColorProfile::new_srgb()
                .encode()
                .map_err(|error| format!("display_fallback_profile_encode_failed:{error}"))?;
            (None, crate::display_profile::sha256_hex(&bytes))
        }
    };
    let scale_factor = app
        .get_webview_window("main")
        .and_then(|window| window.scale_factor().ok())
        .unwrap_or(1.0);
    let identity = DisplayTargetIdentity {
        display_id,
        profile_sha256,
        scale_factor_bits: scale_factor.to_bits(),
        color_space: DisplayColorSpace::DisplayEncodedSrgb,
        hdr_capability_fingerprint: 0,
    };
    let hdr_capability = compile_hdr_display_capability(
        identity.profile_sha256.clone(),
        query_edr_headroom(display_id),
        false,
    );
    let identity = DisplayTargetIdentity {
        hdr_capability_fingerprint: hdr_capability.fingerprint,
        ..identity
    };
    Ok(ResolvedDisplayTarget {
        identity,
        color_contract: "pixels_and_jpeg_icc_from_same_snapshot".to_string(),
        hdr_capability,
        capture,
        snapshot: None,
    })
}

#[cfg(any(test, not(any(target_os = "android", target_os = "linux"))))]
fn validate_color_contract(
    target_profile_sha256: &str,
    snapshot_profile_sha256: &str,
    encoding_contract: &str,
) -> Result<(), String> {
    if target_profile_sha256 != snapshot_profile_sha256 {
        return Err("display_target_profile_snapshot_mismatch".to_string());
    }
    if encoding_contract != "pixels_and_jpeg_icc_from_same_snapshot" {
        return Err("display_target_color_contract_mismatch".to_string());
    }
    Ok(())
}

fn validate_hdr_capability_contract(
    identity: &DisplayTargetIdentity,
    capability: &HdrDisplayCapabilityV1,
) -> Result<(), String> {
    if identity.profile_sha256 != capability.display_profile_sha256 {
        return Err("display_target_hdr_profile_mismatch".to_string());
    }
    if identity.hdr_capability_fingerprint != capability.fingerprint {
        return Err("display_target_hdr_capability_identity_mismatch".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn get_display_target_report(state: tauri::State<'_, crate::AppState>) -> DisplayTargetReport {
    state
        .display_target_coordinator
        .lock()
        .unwrap()
        .as_ref()
        .map_or_else(DisplayTargetReport::default, |coordinator| {
            coordinator.report()
        })
}

#[cfg(all(feature = "validation-harness", target_os = "macos"))]
fn validate_injected_cross_display_transition(report: &mut DisplayTargetReport) {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::mpsc;

    let started_at = Instant::now();
    let transition = Arc::new(AtomicU64::new(0));
    let resolver_transition = Arc::clone(&transition);
    let (published_tx, published_rx) = mpsc::channel();
    let coordinator = DisplayTargetCoordinator::new_with_publisher(
        Duration::ZERO,
        move |_| {
            let second = resolver_transition.load(Ordering::SeqCst) != 0;
            let (display_id, bytes) = if second {
                (202, moxcms::ColorProfile::new_display_p3().encode())
            } else {
                (101, moxcms::ColorProfile::new_srgb().encode())
            };
            let bytes = bytes.map_err(|error| error.to_string())?;
            let profile_sha256 = crate::display_profile::sha256_hex(&bytes);
            let hdr_capability = compile_hdr_display_capability(
                profile_sha256.clone(),
                EdrHeadroomSample::default(),
                false,
            );
            Ok(ResolvedDisplayTarget {
                identity: DisplayTargetIdentity {
                    display_id: Some(display_id),
                    profile_sha256,
                    scale_factor_bits: 2.0_f64.to_bits(),
                    color_space: DisplayColorSpace::DisplayEncodedSrgb,
                    hdr_capability_fingerprint: hdr_capability.fingerprint,
                },
                color_contract: "pixels_and_jpeg_icc_from_same_snapshot".to_string(),
                hdr_capability,
                capture: Ok((Some(display_id), bytes)),
                snapshot: None,
            })
        },
        move |change| {
            let _ = published_tx.send(change);
        },
    );
    coordinator.request_refresh(77);
    if !coordinator.wait_for_idle(Duration::from_secs(5)) {
        return;
    }
    let first = coordinator.current_resources_for_test();
    let first_publish = published_rx.recv_timeout(Duration::from_secs(1)).ok();
    transition.store(1, Ordering::SeqCst);
    coordinator.request_refresh(77);
    if !coordinator.wait_for_idle(Duration::from_secs(5)) {
        return;
    }
    let second = coordinator.current_resources_for_test();
    let second_publish = published_rx.recv_timeout(Duration::from_secs(1)).ok();
    if let (Some(first), Some(second), Some(first_publish), Some(second_publish)) =
        (first, second, first_publish, second_publish)
    {
        report.injected_cross_display_transition_verified = first.target.identity.display_id
            == Some(101)
            && second.target.identity.display_id == Some(202)
            && first.target.identity.profile_sha256 != second.target.identity.profile_sha256;
        report.atomic_generation_swap_verified = first.generation == 1
            && second.generation == 2
            && first_publish.display_resource_generation == 1
            && second_publish.display_resource_generation == 2;
        report.old_resource_lease_preserved =
            Arc::strong_count(&first) >= 1 && first.device_generation == second.device_generation;
        report.export_lease_preserved = report.old_resource_lease_preserved
            && report.in_flight_jobs_cancelled_from_display_events == 0;
    }

    let bad_snapshot =
        crate::display_profile::display_preview_transform_snapshot_from_capture(Ok((
            Some(303),
            moxcms::ColorProfile::new_srgb().encode().unwrap(),
        )));
    let bad_hdr_capability = compile_hdr_display_capability(
        "mismatched-profile-hash".to_string(),
        EdrHeadroomSample::default(),
        false,
    );
    let bad = ResolvedDisplayTarget {
        identity: DisplayTargetIdentity {
            display_id: Some(303),
            profile_sha256: "mismatched-profile-hash".to_string(),
            scale_factor_bits: 2.0_f64.to_bits(),
            color_space: DisplayColorSpace::DisplayEncodedSrgb,
            hdr_capability_fingerprint: bad_hdr_capability.fingerprint,
        },
        color_contract: "pixels_and_jpeg_icc_from_same_snapshot".to_string(),
        hdr_capability: bad_hdr_capability,
        capture: Err("unused".to_string()),
        snapshot: Some(Arc::new(bad_snapshot)),
    };
    report.mismatched_publish_excluded = bad.materialize().is_err();
    report.interaction_churn_duration_micros = started_at.elapsed().as_micros() as u64;
}

#[cfg(feature = "validation-harness")]
pub fn start_validation_benchmark(app: tauri::AppHandle) {
    let Some(report_path) = std::env::var_os("RAWENGINE_DISPLAY_TARGET_BENCHMARK_REPORT") else {
        return;
    };
    std::thread::Builder::new()
        .name("display-target-validation".to_string())
        .spawn(move || {
            use tauri::Manager;

            let state = app.state::<crate::AppState>();
            let Some(coordinator) = state.display_target_coordinator.lock().unwrap().clone() else {
                return;
            };
            for _ in 0..1_000 {
                coordinator.request_refresh(0);
            }
            if !coordinator.wait_for_idle(Duration::from_secs(20)) {
                log::error!("display target validation did not become idle");
                return;
            }
            let mut report = coordinator.report();
            #[cfg(target_os = "macos")]
            validate_injected_cross_display_transition(&mut report);
            let report_path = std::path::PathBuf::from(report_path);
            let temporary = report_path.with_extension("tmp");
            let result = serde_json::to_vec_pretty(&report)
                .map_err(|error| error.to_string())
                .and_then(|bytes| {
                    std::fs::write(&temporary, bytes).map_err(|error| error.to_string())
                })
                .and_then(|()| {
                    std::fs::rename(&temporary, &report_path).map_err(|error| error.to_string())
                });
            if let Err(error) = result {
                log::error!("display target validation report failed: {error}");
                let _ = std::fs::remove_file(temporary);
            }
        })
        .expect("display target validation thread");
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::mpsc;

    use super::*;

    fn target(display_id: u32, profile: &str) -> ResolvedDisplayTarget {
        #[cfg(not(any(target_os = "android", target_os = "linux")))]
        let snapshot = {
            let mut snapshot =
                crate::display_profile::display_preview_transform_snapshot_from_capture(Err(
                    "synthetic_test_fallback".to_string(),
                ));
            snapshot.icc_sha256 = profile.to_string();
            Arc::new(snapshot)
        };
        let hdr_capability = compile_hdr_display_capability(
            profile.to_string(),
            EdrHeadroomSample::default(),
            false,
        );
        ResolvedDisplayTarget {
            identity: DisplayTargetIdentity {
                display_id: Some(display_id),
                profile_sha256: profile.to_string(),
                scale_factor_bits: 2.0_f64.to_bits(),
                color_space: DisplayColorSpace::DisplayEncodedSrgb,
                hdr_capability_fingerprint: hdr_capability.fingerprint,
            },
            color_contract: "pixels_and_jpeg_icc_from_same_snapshot".to_string(),
            hdr_capability,
            #[cfg(not(any(target_os = "android", target_os = "linux")))]
            capture: Err("synthetic_test_fallback".to_string()),
            #[cfg(not(any(target_os = "android", target_os = "linux")))]
            snapshot: Some(snapshot),
        }
    }

    #[test]
    fn thousand_moves_coalesce_and_same_target_preserves_both_generations() {
        let resolutions = Arc::new(AtomicU64::new(0));
        let counter = Arc::clone(&resolutions);
        let coordinator = DisplayTargetCoordinator::new(Duration::from_millis(4), move |_| {
            counter.fetch_add(1, Ordering::SeqCst);
            Ok(target(1, "profile-a"))
        });
        for _ in 0..1_000 {
            coordinator.request_refresh(9);
        }
        assert!(coordinator.wait_for_idle(Duration::from_secs(2)));
        let first = coordinator.report();
        assert_eq!(first.raw_events, 1_000);
        assert!(first.coalesced_events >= 999);
        assert!(first.resolutions <= 2);
        assert_eq!(first.display_resource_builds, 1);
        assert_eq!(first.device_generation, Some(9));
        assert_eq!(first.display_resource_generation, Some(1));
        assert_eq!(first.compute_context_resets_from_display_events, 0);
        assert_eq!(first.in_flight_jobs_cancelled_from_display_events, 0);
        assert_eq!(first.blank_frames_from_display_events, 0);

        coordinator.request_refresh(9);
        assert!(coordinator.wait_for_idle(Duration::from_secs(1)));
        let same = coordinator.report();
        assert_eq!(same.same_target_noops, 1);
        assert_eq!(same.display_resource_builds, 1);
        assert_eq!(same.device_generation, Some(9));
        assert_eq!(same.display_resource_generation, Some(1));
        assert!(resolutions.load(Ordering::SeqCst) <= 3);
    }

    #[test]
    fn profile_change_replaces_only_display_generation_and_preserves_color_contract() {
        let profile = Arc::new(AtomicU64::new(1));
        let resolver_profile = Arc::clone(&profile);
        let coordinator = DisplayTargetCoordinator::new(Duration::ZERO, move |_| {
            let name = if resolver_profile.load(Ordering::SeqCst) == 1 {
                "profile-a"
            } else {
                "profile-b"
            };
            Ok(target(1, name))
        });
        coordinator.request_refresh(41);
        assert!(coordinator.wait_for_idle(Duration::from_secs(1)));
        profile.store(2, Ordering::SeqCst);
        coordinator.request_refresh(41);
        assert!(coordinator.wait_for_idle(Duration::from_secs(1)));
        let report = coordinator.report();
        assert_eq!(report.device_generation, Some(41));
        assert_eq!(report.display_resource_generation, Some(2));
        assert_eq!(report.display_resource_builds, 2);
        assert_eq!(report.compute_context_resets_from_display_events, 0);
        assert_eq!(report.in_flight_jobs_cancelled_from_display_events, 0);
        assert_eq!(
            report.color_contract.as_deref(),
            Some("pixels_and_jpeg_icc_from_same_snapshot")
        );
    }

    #[test]
    fn scale_change_rebuilds_display_resources_without_changing_device_generation() {
        let scale_bits = Arc::new(AtomicU64::new(1.0_f64.to_bits()));
        let resolver_scale = Arc::clone(&scale_bits);
        let coordinator = DisplayTargetCoordinator::new(Duration::ZERO, move |_| {
            let mut resolved = target(4, "profile-scale");
            resolved.identity.scale_factor_bits = resolver_scale.load(Ordering::SeqCst);
            Ok(resolved)
        });
        coordinator.request_refresh(22);
        assert!(coordinator.wait_for_idle(Duration::from_secs(1)));
        scale_bits.store(2.0_f64.to_bits(), Ordering::SeqCst);
        coordinator.request_refresh(22);
        assert!(coordinator.wait_for_idle(Duration::from_secs(1)));
        let report = coordinator.report();
        assert_eq!(report.device_generation, Some(22));
        assert_eq!(report.display_resource_generation, Some(2));
        assert_eq!(report.display_resource_builds, 2);
    }

    #[test]
    fn hdr_capability_change_rebuilds_only_display_resources_and_updates_report() {
        let headroom = Arc::new(AtomicU64::new(1.0_f64.to_bits()));
        let resolver_headroom = Arc::clone(&headroom);
        let coordinator = DisplayTargetCoordinator::new(Duration::ZERO, move |_| {
            let mut resolved = target(4, "profile-hdr");
            resolved.hdr_capability = compile_hdr_display_capability(
                resolved.identity.profile_sha256.clone(),
                EdrHeadroomSample {
                    current: Some(1.0),
                    potential: Some(f64::from_bits(resolver_headroom.load(Ordering::SeqCst))),
                    reference: Some(1.0),
                },
                false,
            );
            resolved.identity.hdr_capability_fingerprint = resolved.hdr_capability.fingerprint;
            Ok(resolved)
        });
        coordinator.request_refresh(22);
        assert!(coordinator.wait_for_idle(Duration::from_secs(1)));
        headroom.store(4.0_f64.to_bits(), Ordering::SeqCst);
        coordinator.request_refresh(22);
        assert!(coordinator.wait_for_idle(Duration::from_secs(1)));

        let report = coordinator.report();
        let capability = report.hdr_capability.expect("published HDR capability");
        assert_eq!(report.device_generation, Some(22));
        assert_eq!(report.display_resource_generation, Some(2));
        assert_eq!(report.display_resource_builds, 2);
        assert_eq!(report.compute_context_resets_from_display_events, 0);
        assert_eq!(capability.display_potential_peak_nits, 812.0);
        assert_eq!(capability.headroom_stops, 2.0);
        assert!(!capability.authoritative_hdr_preview);
        assert_eq!(
            capability.fallback_reason.as_deref(),
            Some("hdr_surface_contract_not_accepted")
        );
    }

    #[test]
    fn device_generation_change_is_distinct_and_old_display_resources_remain_leased() {
        let coordinator =
            DisplayTargetCoordinator::new(Duration::ZERO, move |_| Ok(target(8, "stable-profile")));
        coordinator.request_refresh(30);
        assert!(coordinator.wait_for_idle(Duration::from_secs(1)));
        let old_resources = coordinator.current_resources_for_test().unwrap();
        coordinator.request_refresh(31);
        assert!(coordinator.wait_for_idle(Duration::from_secs(1)));
        let current_resources = coordinator.current_resources_for_test().unwrap();
        assert_eq!(old_resources.device_generation, 30);
        assert_eq!(current_resources.device_generation, 31);
        assert_eq!(old_resources.generation, 1);
        assert_eq!(current_resources.generation, 2);
        assert!(!Arc::ptr_eq(&old_resources, &current_resources));
        assert_eq!(
            old_resources.target.identity,
            current_resources.target.identity
        );
    }

    #[test]
    fn display_color_contract_rejects_profile_or_encoding_mismatch() {
        assert!(
            validate_color_contract(
                "profile-a",
                "profile-a",
                "pixels_and_jpeg_icc_from_same_snapshot"
            )
            .is_ok()
        );
        assert_eq!(
            validate_color_contract(
                "profile-a",
                "profile-b",
                "pixels_and_jpeg_icc_from_same_snapshot"
            ),
            Err("display_target_profile_snapshot_mismatch".to_string())
        );
        assert_eq!(
            validate_color_contract("profile-a", "profile-a", "independent_profile_lookup"),
            Err("display_target_color_contract_mismatch".to_string())
        );
    }

    #[test]
    fn display_hdr_contract_rejects_stale_or_cross_profile_capability() {
        let capability = compile_hdr_display_capability(
            "profile-a".to_string(),
            EdrHeadroomSample::default(),
            false,
        );
        let mut identity = target(5, "profile-a").identity;
        assert!(validate_hdr_capability_contract(&identity, &capability).is_ok());

        identity.profile_sha256 = "profile-b".to_string();
        assert_eq!(
            validate_hdr_capability_contract(&identity, &capability),
            Err("display_target_hdr_profile_mismatch".to_string())
        );
        identity.profile_sha256 = "profile-a".to_string();
        identity.hdr_capability_fingerprint ^= 1;
        assert_eq!(
            validate_hdr_capability_contract(&identity, &capability),
            Err("display_target_hdr_capability_identity_mismatch".to_string())
        );
    }

    #[cfg(not(any(target_os = "android", target_os = "linux")))]
    #[test]
    fn prebuilt_mismatched_snapshot_is_rejected_before_publication() {
        let mut mismatched = target(5, "snapshot-profile");
        mismatched.identity.profile_sha256 = "target-profile".to_string();
        mismatched.hdr_capability = compile_hdr_display_capability(
            "target-profile".to_string(),
            EdrHeadroomSample::default(),
            false,
        );
        mismatched.identity.hdr_capability_fingerprint = mismatched.hdr_capability.fingerprint;
        assert_eq!(
            mismatched.materialize().err().as_deref(),
            Some("display_target_profile_snapshot_mismatch")
        );
    }

    #[test]
    fn publishes_only_committed_display_generations_and_suppresses_same_target_events() {
        let profile = Arc::new(AtomicU64::new(1));
        let resolver_profile = Arc::clone(&profile);
        let (published_tx, published_rx) = mpsc::channel();
        let coordinator = DisplayTargetCoordinator::new_with_publisher(
            Duration::ZERO,
            move |_| {
                Ok(target(
                    9,
                    if resolver_profile.load(Ordering::SeqCst) == 1 {
                        "profile-one"
                    } else {
                        "profile-two"
                    },
                ))
            },
            move |change| published_tx.send(change).unwrap(),
        );
        coordinator.request_refresh(50);
        assert!(coordinator.wait_for_idle(Duration::from_secs(1)));
        let first = published_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!(first.device_generation, 50);
        assert_eq!(first.display_resource_generation, 1);

        coordinator.request_refresh(50);
        assert!(coordinator.wait_for_idle(Duration::from_secs(1)));
        assert!(published_rx.try_recv().is_err());

        profile.store(2, Ordering::SeqCst);
        coordinator.request_refresh(50);
        assert!(coordinator.wait_for_idle(Duration::from_secs(1)));
        let second = published_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!(second.display_resource_generation, 2);
        assert_eq!(second.target.profile_sha256, "profile-two");
    }

    #[test]
    fn stale_slow_build_cannot_overwrite_newer_cross_display_target() {
        let (started_tx, started_rx) = mpsc::sync_channel(1);
        let (release_tx, release_rx) = mpsc::sync_channel(1);
        let release_rx = Mutex::new(release_rx);
        let coordinator = DisplayTargetCoordinator::new(Duration::ZERO, move |revision| {
            if revision == 1 {
                started_tx.send(()).unwrap();
                release_rx.lock().unwrap().recv().unwrap();
                Ok(target(1, "old-profile"))
            } else {
                Ok(target(2, "new-profile"))
            }
        });
        coordinator.request_refresh(7);
        started_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        coordinator.request_refresh(7);
        release_tx.send(()).unwrap();
        assert!(coordinator.wait_for_idle(Duration::from_secs(1)));
        let report = coordinator.report();
        assert_eq!(report.stale_builds_discarded, 1);
        assert_eq!(report.display_resource_builds, 1);
        assert_eq!(
            report.target.as_ref().and_then(|target| target.display_id),
            Some(2)
        );
        assert_eq!(report.device_generation, Some(7));
    }

    #[test]
    fn failed_transform_build_keeps_current_display_and_device_resources() {
        let should_fail = Arc::new(AtomicU64::new(0));
        let resolver_failure = Arc::clone(&should_fail);
        let coordinator = DisplayTargetCoordinator::new(Duration::ZERO, move |_| {
            if resolver_failure.load(Ordering::SeqCst) == 1 {
                Err("injected_profile_failure".to_string())
            } else {
                Ok(target(3, "stable-profile"))
            }
        });
        coordinator.request_refresh(12);
        assert!(coordinator.wait_for_idle(Duration::from_secs(1)));
        should_fail.store(1, Ordering::SeqCst);
        coordinator.request_refresh(12);
        assert!(coordinator.wait_for_idle(Duration::from_secs(1)));
        let report = coordinator.report();
        assert_eq!(report.build_failures, 1);
        assert_eq!(report.display_resource_builds, 1);
        assert_eq!(report.device_generation, Some(12));
        assert_eq!(report.display_resource_generation, Some(1));
    }
}
