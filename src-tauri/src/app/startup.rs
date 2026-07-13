use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[cfg(test)]
use std::sync::atomic::AtomicU64;

/// Target from process start through native shell visibility. The shell still
/// remains usable if a host exceeds this budget; the trace makes the miss
/// actionable without turning optional services into a startup failure.
pub const FIRST_PAINT_BUDGET_MS: u128 = 750;

use serde::Serialize;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InitializationPriority {
    IdleWarm,
    EditorDemand,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InitializationState {
    Unrequested,
    Warming,
    Ready,
    Degraded,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializationServiceSnapshot {
    pub state: InitializationState,
    pub priority: Option<InitializationPriority>,
    pub starts: u64,
    pub promotions: u64,
}

pub struct InitializationService {
    inner: Mutex<InitializationServiceSnapshot>,
}

impl Default for InitializationService {
    fn default() -> Self {
        Self {
            inner: Mutex::new(InitializationServiceSnapshot {
                state: InitializationState::Unrequested,
                priority: None,
                starts: 0,
                promotions: 0,
            }),
        }
    }
}

impl InitializationService {
    pub fn request(&self, priority: InitializationPriority) -> bool {
        let mut inner = self.inner.lock().unwrap();
        match inner.state {
            InitializationState::Unrequested => {
                inner.state = InitializationState::Warming;
                inner.priority = Some(priority);
                inner.starts += 1;
                true
            }
            InitializationState::Warming => {
                if inner.priority.is_none_or(|current| priority > current) {
                    inner.priority = Some(priority);
                    inner.promotions += 1;
                }
                false
            }
            InitializationState::Ready | InitializationState::Degraded => false,
        }
    }

    pub fn finish(&self, result: &Result<(), String>) {
        self.inner.lock().unwrap().state = if result.is_ok() {
            InitializationState::Ready
        } else {
            InitializationState::Degraded
        };
    }

    pub fn snapshot(&self) -> InitializationServiceSnapshot {
        *self.inner.lock().unwrap()
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn request_gpu_initialization(app: tauri::AppHandle, priority: InitializationPriority) {
    use tauri::Manager;

    if !app
        .state::<crate::AppState>()
        .gpu_initialization
        .request(priority)
    {
        return;
    }
    let completion_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = tauri::async_runtime::spawn_blocking(move || {
            #[cfg(feature = "validation-harness")]
            if std::env::var("RAWENGINE_STARTUP_INJECT_GPU_FAILURE").as_deref() == Ok("1") {
                return Err("injected gpu startup failure".to_string());
            }
            crate::get_or_init_gpu_context(&app.state::<crate::AppState>(), &app).map(|_| ())
        })
        .await
        .unwrap_or_else(|error| Err(error.to_string()));
        let state = completion_app.state::<crate::AppState>();
        state.gpu_initialization.finish(&result);
        mark_initialization_service_result(
            &state.startup_trace,
            NativeStartupPhase::GpuReady,
            "gpu",
            state.gpu_initialization.snapshot(),
            result,
        );
    });
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn request_lens_initialization(app: tauri::AppHandle, priority: InitializationPriority) {
    use tauri::Manager;

    if !app
        .state::<crate::AppState>()
        .lens_initialization
        .request(priority)
    {
        return;
    }
    let completion_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = tauri::async_runtime::spawn_blocking(move || {
            #[cfg(feature = "validation-harness")]
            if std::env::var("RAWENGINE_STARTUP_INJECT_LENSFUN_FAILURE").as_deref() == Ok("1") {
                return Err("injected lensfun startup failure".to_string());
            }
            let lens_db = crate::lens_correction::load_lensfun_db(&app);
            *app.state::<crate::AppState>().lens_db.lock().unwrap() = Some(Arc::new(lens_db));
            Ok(())
        })
        .await
        .unwrap_or_else(|error| Err(error.to_string()));
        let state = completion_app.state::<crate::AppState>();
        state.lens_initialization.finish(&result);
        mark_initialization_service_result(
            &state.startup_trace,
            NativeStartupPhase::LibraryServicesReady,
            "lensfun",
            state.lens_initialization.snapshot(),
            result,
        );
    });
}

/// Native startup phases are intentionally independent of frontend readiness. A
/// shell can be visible while optional services are still warming.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NativeStartupPhase {
    ProcessStarted,
    MinimalSettingsLoaded,
    WindowCreated,
    WindowVisible,
    CoreCommandsReady,
    LibraryServicesReady,
    GpuReady,
    OptionalServicesReady,
    FrontendShellVisible,
    FrontendInteractive,
    FrontendSettingsHydrated,
    FrontendLibraryReady,
    FrontendEditorReady,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FrontendStartupPhase {
    ShellVisible,
    Interactive,
    SettingsHydrated,
    LibraryReady,
    EditorReady,
}

impl From<FrontendStartupPhase> for NativeStartupPhase {
    fn from(phase: FrontendStartupPhase) -> Self {
        match phase {
            FrontendStartupPhase::ShellVisible => Self::FrontendShellVisible,
            FrontendStartupPhase::Interactive => Self::FrontendInteractive,
            FrontendStartupPhase::SettingsHydrated => Self::FrontendSettingsHydrated,
            FrontendStartupPhase::LibraryReady => Self::FrontendLibraryReady,
            FrontendStartupPhase::EditorReady => Self::FrontendEditorReady,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupPhaseReceipt {
    pub phase: NativeStartupPhase,
    pub elapsed_ms: u128,
    pub status: &'static str,
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupTraceSnapshot {
    pub critical_path_order_valid: bool,
    pub first_paint_budget_met: Option<bool>,
    pub first_paint_budget_ms: u128,
    pub process_id: u32,
    pub trace_id: String,
    pub phases: Vec<StartupPhaseReceipt>,
}

#[derive(Clone)]
pub struct StartupTrace {
    idle_warm_armed: Arc<AtomicBool>,
    trace_id: String,
    started_at: Instant,
    phases: Arc<Mutex<Vec<StartupPhaseReceipt>>>,
    #[cfg(test)]
    test_elapsed_ms: Option<Arc<AtomicU64>>,
}

impl Default for StartupTrace {
    fn default() -> Self {
        Self::new()
    }
}

impl StartupTrace {
    pub fn new() -> Self {
        let entry = Instant::now();
        let started_at = std::env::var("RAWENGINE_STARTUP_BENCHMARK_ORIGIN_EPOCH_MS")
            .ok()
            .and_then(|value| value.parse::<u128>().ok())
            .and_then(|origin| {
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .ok()
                    .map(|now| now.as_millis().saturating_sub(origin))
            })
            .and_then(|elapsed_ms| u64::try_from(elapsed_ms).ok())
            .and_then(|elapsed_ms| entry.checked_sub(Duration::from_millis(elapsed_ms)))
            .unwrap_or(entry);
        Self {
            idle_warm_armed: Arc::new(AtomicBool::new(false)),
            trace_id: format!("startup:{}", Uuid::new_v4()),
            started_at,
            phases: Arc::new(Mutex::new(Vec::new())),
            #[cfg(test)]
            test_elapsed_ms: None,
        }
    }

    #[cfg(test)]
    fn with_test_clock(test_elapsed_ms: Arc<AtomicU64>) -> Self {
        Self {
            idle_warm_armed: Arc::new(AtomicBool::new(false)),
            trace_id: format!("startup:{}", Uuid::new_v4()),
            started_at: Instant::now(),
            phases: Arc::new(Mutex::new(Vec::new())),
            test_elapsed_ms: Some(test_elapsed_ms),
        }
    }

    pub fn trace_id(&self) -> &str {
        &self.trace_id
    }

    pub fn arm_idle_warm_after(&self, phase: FrontendStartupPhase) -> bool {
        phase == FrontendStartupPhase::Interactive
            && self
                .idle_warm_armed
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
    }

    pub fn mark(&self, phase: NativeStartupPhase, status: &'static str, detail: Option<String>) {
        let mut phases = self.phases.lock().unwrap();
        if phases.iter().any(|receipt| receipt.phase == phase) {
            return;
        }
        let receipt = StartupPhaseReceipt {
            phase,
            elapsed_ms: self.elapsed_ms(),
            status,
            detail,
        };
        if matches!(phase, NativeStartupPhase::WindowVisible)
            && receipt.elapsed_ms > FIRST_PAINT_BUDGET_MS
        {
            log::warn!(
                "startup first-paint budget exceeded trace={} elapsed_ms={} budget_ms={}",
                self.trace_id,
                receipt.elapsed_ms,
                FIRST_PAINT_BUDGET_MS
            );
        }
        log::info!(
            "startup phase trace={} phase={:?} status={} elapsed_ms={} detail={:?}",
            self.trace_id,
            receipt.phase,
            receipt.status,
            receipt.elapsed_ms,
            receipt.detail
        );
        phases.push(receipt);
        drop(phases);
        #[cfg(feature = "validation-harness")]
        self.write_benchmark_report_if_ready();
    }

    pub fn snapshot(&self) -> StartupTraceSnapshot {
        let phases = self.phases.lock().unwrap().clone();
        let first_paint_elapsed_ms = phases
            .iter()
            .find(|receipt| receipt.phase == NativeStartupPhase::WindowVisible)
            .map(|receipt| receipt.elapsed_ms);
        StartupTraceSnapshot {
            critical_path_order_valid: critical_path_order_valid(&phases),
            first_paint_budget_met: first_paint_elapsed_ms
                .map(|elapsed_ms| elapsed_ms <= FIRST_PAINT_BUDGET_MS),
            first_paint_budget_ms: FIRST_PAINT_BUDGET_MS,
            process_id: std::process::id(),
            trace_id: self.trace_id.clone(),
            phases,
        }
    }

    fn elapsed_ms(&self) -> u128 {
        #[cfg(test)]
        if let Some(elapsed_ms) = &self.test_elapsed_ms {
            return u128::from(elapsed_ms.load(Ordering::SeqCst));
        }
        self.started_at.elapsed().as_millis()
    }

    #[cfg(feature = "validation-harness")]
    fn write_benchmark_report_if_ready(&self) {
        let Some(report_path) = std::env::var_os("RAWENGINE_STARTUP_BENCHMARK_REPORT") else {
            return;
        };
        let snapshot = self.snapshot();
        let has_phase = |phase, status: Option<&str>| {
            snapshot.phases.iter().any(|receipt| {
                receipt.phase == phase && status.is_none_or(|expected| receipt.status == expected)
            })
        };
        if !has_phase(NativeStartupPhase::FrontendLibraryReady, None) {
            return;
        }
        if std::env::var("RAWENGINE_STARTUP_INJECT_GPU_FAILURE").as_deref() == Ok("1")
            && !has_phase(NativeStartupPhase::GpuReady, Some("degraded"))
        {
            return;
        }
        if std::env::var("RAWENGINE_STARTUP_INJECT_LENSFUN_FAILURE").as_deref() == Ok("1")
            && !has_phase(NativeStartupPhase::LibraryServicesReady, Some("degraded"))
        {
            return;
        }

        let report_path = std::path::PathBuf::from(report_path);
        if let Some(parent) = report_path.parent()
            && let Err(error) = std::fs::create_dir_all(parent)
        {
            log::warn!("startup benchmark report directory failed: {error}");
            return;
        }
        let temporary_path = report_path.with_extension(format!("tmp-{}", std::process::id()));
        let result = serde_json::to_vec_pretty(&snapshot)
            .map_err(|error| error.to_string())
            .and_then(|bytes| {
                std::fs::write(&temporary_path, bytes).map_err(|error| error.to_string())
            })
            .and_then(|()| {
                std::fs::rename(&temporary_path, &report_path).map_err(|error| error.to_string())
            });
        if let Err(error) = result {
            let _ = std::fs::remove_file(&temporary_path);
            log::warn!("startup benchmark report write failed: {error}");
        }
    }
}

fn critical_path_order_valid(phases: &[StartupPhaseReceipt]) -> bool {
    let first_index = |phase| phases.iter().position(|receipt| receipt.phase == phase);
    let Some(process) = first_index(NativeStartupPhase::ProcessStarted) else {
        return false;
    };
    let Some(settings) = first_index(NativeStartupPhase::MinimalSettingsLoaded) else {
        return false;
    };
    let Some(created) = first_index(NativeStartupPhase::WindowCreated) else {
        return false;
    };
    let Some(visible) = first_index(NativeStartupPhase::WindowVisible) else {
        return false;
    };
    process < settings && settings < created && created < visible
}

#[cfg(test)]
pub fn mark_deferred_service_result(
    trace: &StartupTrace,
    phase: NativeStartupPhase,
    service: &'static str,
    result: Result<(), String>,
) {
    match result {
        Ok(()) => trace.mark(phase, "ok", Some(service.to_string())),
        Err(error) => trace.mark(phase, "degraded", Some(format!("{service}: {error}"))),
    }
}

fn mark_initialization_service_result(
    trace: &StartupTrace,
    phase: NativeStartupPhase,
    service: &'static str,
    snapshot: InitializationServiceSnapshot,
    result: Result<(), String>,
) {
    let priority = snapshot.priority.map_or("none", |priority| match priority {
        InitializationPriority::IdleWarm => "idle_warm",
        InitializationPriority::EditorDemand => "editor_demand",
    });
    let detail = format!(
        "{service}:priority={priority}:starts={}:promotions={}",
        snapshot.starts, snapshot.promotions
    );
    match result {
        Ok(()) => trace.mark(phase, "ok", Some(detail)),
        Err(error) => trace.mark(phase, "degraded", Some(format!("{detail}:{error}"))),
    }
}

pub fn record_frontend_phase(
    trace: &StartupTrace,
    trace_id: &str,
    phase: FrontendStartupPhase,
    status: &str,
    detail: Option<String>,
) -> Result<StartupTraceSnapshot, String> {
    if trace_id != trace.trace_id() {
        return Err("stale_startup_trace_id".to_string());
    }
    let status = match status {
        "ok" => "ok",
        "degraded" => "degraded",
        "failed" => "failed",
        _ => return Err("invalid_startup_phase_status".to_string()),
    };
    trace.mark(phase.into(), status, detail);
    Ok(trace.snapshot())
}

pub fn record_frontend_phase_with_followup(
    trace: &StartupTrace,
    trace_id: &str,
    phase: FrontendStartupPhase,
    status: &str,
    detail: Option<String>,
    followup: impl FnOnce(&StartupTraceSnapshot),
) -> Result<StartupTraceSnapshot, String> {
    let snapshot = record_frontend_phase(trace, trace_id, phase, status, detail)?;
    followup(&snapshot);
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::{
        FIRST_PAINT_BUDGET_MS, FrontendStartupPhase, NativeStartupPhase, StartupTrace,
        mark_deferred_service_result, record_frontend_phase, record_frontend_phase_with_followup,
    };
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn mark_at(
        trace: &StartupTrace,
        clock: &AtomicU64,
        elapsed_ms: u64,
        phase: NativeStartupPhase,
    ) {
        clock.store(elapsed_ms, Ordering::SeqCst);
        trace.mark(phase, "ok", None);
    }

    #[test]
    fn startup_trace_keeps_monotonic_phase_receipts_and_trace_identity() {
        let trace = StartupTrace::new();
        trace.mark(NativeStartupPhase::ProcessStarted, "ok", None);
        trace.mark(
            NativeStartupPhase::WindowVisible,
            "ok",
            Some("shell".to_string()),
        );
        let snapshot = trace.snapshot();
        let phases = snapshot.phases;
        assert_eq!(phases.len(), 2);
        assert!(trace.trace_id().starts_with("startup:"));
        assert_eq!(snapshot.process_id, std::process::id());
        assert!(phases[0].elapsed_ms <= phases[1].elapsed_ms);
        assert_eq!(phases[1].detail.as_deref(), Some("shell"));
    }

    #[test]
    fn visible_shell_requires_loaded_minimal_settings_and_mounted_webview() {
        let clock = Arc::new(AtomicU64::new(0));
        let trace = StartupTrace::with_test_clock(Arc::clone(&clock));
        for (elapsed_ms, phase) in [
            (0, NativeStartupPhase::ProcessStarted),
            (20, NativeStartupPhase::MinimalSettingsLoaded),
            (80, NativeStartupPhase::WindowCreated),
            (120, NativeStartupPhase::WindowVisible),
            (125, NativeStartupPhase::FrontendShellVisible),
            (130, NativeStartupPhase::FrontendInteractive),
        ] {
            mark_at(&trace, &clock, elapsed_ms, phase);
        }
        let snapshot = trace.snapshot();
        assert!(snapshot.critical_path_order_valid);
        assert_eq!(snapshot.first_paint_budget_met, Some(true));
        assert_eq!(
            snapshot
                .phases
                .iter()
                .find(|receipt| receipt.phase == NativeStartupPhase::WindowVisible)
                .unwrap()
                .elapsed_ms,
            120
        );
        assert_eq!(
            snapshot.phases.last().unwrap().phase,
            NativeStartupPhase::FrontendInteractive
        );
    }

    #[test]
    fn deterministic_cold_and_warm_traces_meet_first_paint_budget_and_ordering() {
        for (label, timings) in [
            ("cold", [0, 180, 510, 700, 710, 716, 1_900, 2_400]),
            ("warm", [0, 8, 25, 55, 61, 64, 120, 160]),
        ] {
            let clock = Arc::new(AtomicU64::new(0));
            let trace = StartupTrace::with_test_clock(Arc::clone(&clock));
            for (elapsed_ms, phase) in timings.into_iter().zip([
                NativeStartupPhase::ProcessStarted,
                NativeStartupPhase::MinimalSettingsLoaded,
                NativeStartupPhase::WindowCreated,
                NativeStartupPhase::WindowVisible,
                NativeStartupPhase::FrontendShellVisible,
                NativeStartupPhase::FrontendInteractive,
                NativeStartupPhase::LibraryServicesReady,
                NativeStartupPhase::GpuReady,
            ]) {
                mark_at(&trace, &clock, elapsed_ms, phase);
            }

            let snapshot = trace.snapshot();
            assert!(snapshot.critical_path_order_valid, "{label} critical path");
            assert_eq!(snapshot.first_paint_budget_ms, FIRST_PAINT_BUDGET_MS);
            assert_eq!(
                snapshot.first_paint_budget_met,
                Some(true),
                "{label} budget"
            );
            let visible = snapshot
                .phases
                .iter()
                .position(|receipt| receipt.phase == NativeStartupPhase::WindowVisible)
                .unwrap();
            for deferred in [
                NativeStartupPhase::LibraryServicesReady,
                NativeStartupPhase::GpuReady,
            ] {
                assert!(
                    snapshot
                        .phases
                        .iter()
                        .position(|receipt| receipt.phase == deferred)
                        .unwrap()
                        > visible,
                    "{label} {deferred:?} must remain off the first-paint path"
                );
            }
        }
    }

    #[test]
    fn first_paint_budget_and_ordering_fail_closed() {
        let clock = Arc::new(AtomicU64::new(0));
        let trace = StartupTrace::with_test_clock(Arc::clone(&clock));
        mark_at(&trace, &clock, 0, NativeStartupPhase::ProcessStarted);
        mark_at(&trace, &clock, 80, NativeStartupPhase::WindowCreated);
        mark_at(
            &trace,
            &clock,
            (FIRST_PAINT_BUDGET_MS + 1) as u64,
            NativeStartupPhase::WindowVisible,
        );
        let snapshot = trace.snapshot();
        assert!(!snapshot.critical_path_order_valid);
        assert_eq!(snapshot.first_paint_budget_met, Some(false));
    }

    #[test]
    fn injected_gpu_and_lensfun_failures_are_degraded_after_a_usable_shell() {
        let clock = Arc::new(AtomicU64::new(0));
        let trace = StartupTrace::with_test_clock(Arc::clone(&clock));
        for (elapsed_ms, phase) in [
            (0, NativeStartupPhase::ProcessStarted),
            (10, NativeStartupPhase::MinimalSettingsLoaded),
            (20, NativeStartupPhase::WindowCreated),
            (30, NativeStartupPhase::WindowVisible),
            (35, NativeStartupPhase::FrontendShellVisible),
        ] {
            mark_at(&trace, &clock, elapsed_ms, phase);
        }
        clock.store(900, Ordering::SeqCst);
        mark_deferred_service_result(
            &trace,
            NativeStartupPhase::LibraryServicesReady,
            "lensfun",
            Err("injected database failure".to_string()),
        );
        clock.store(1_200, Ordering::SeqCst);
        mark_deferred_service_result(
            &trace,
            NativeStartupPhase::GpuReady,
            "gpu",
            Err("injected adapter failure".to_string()),
        );

        let snapshot = trace.snapshot();
        assert_eq!(snapshot.first_paint_budget_met, Some(true));
        assert!(snapshot.critical_path_order_valid);
        let degraded: Vec<_> = snapshot
            .phases
            .iter()
            .filter(|receipt| receipt.status == "degraded")
            .collect();
        assert_eq!(degraded.len(), 2);
        assert!(degraded[0].detail.as_deref().unwrap().contains("lensfun"));
        assert!(degraded[1].detail.as_deref().unwrap().contains("gpu"));
    }

    #[test]
    fn frontend_phases_require_and_preserve_the_native_trace_identity() {
        let clock = Arc::new(AtomicU64::new(25));
        let trace = StartupTrace::with_test_clock(Arc::clone(&clock));
        let trace_id = trace.trace_id().to_string();
        let snapshot = record_frontend_phase(
            &trace,
            &trace_id,
            FrontendStartupPhase::ShellVisible,
            "ok",
            Some("react-root-mounted".to_string()),
        )
        .unwrap();
        assert_eq!(snapshot.trace_id, trace_id);
        assert_eq!(
            snapshot.phases.last().unwrap().phase,
            NativeStartupPhase::FrontendShellVisible
        );

        assert_eq!(
            record_frontend_phase(
                &trace,
                "startup:stale",
                FrontendStartupPhase::SettingsHydrated,
                "ok",
                None,
            )
            .unwrap_err(),
            "stale_startup_trace_id"
        );
        assert_eq!(
            record_frontend_phase(
                &trace,
                &trace_id,
                FrontendStartupPhase::SettingsHydrated,
                "unknown",
                None,
            )
            .unwrap_err(),
            "invalid_startup_phase_status"
        );
    }

    #[test]
    fn editor_demand_promotes_one_in_flight_initialization_without_duplicate_start() {
        let service = super::InitializationService::default();
        assert!(service.request(super::InitializationPriority::IdleWarm));
        assert!(!service.request(super::InitializationPriority::EditorDemand));
        assert!(!service.request(super::InitializationPriority::EditorDemand));
        let warming = service.snapshot();
        assert_eq!(warming.state, super::InitializationState::Warming);
        assert_eq!(
            warming.priority,
            Some(super::InitializationPriority::EditorDemand)
        );
        assert_eq!(warming.starts, 1);
        assert_eq!(warming.promotions, 1);

        service.finish(&Ok(()));
        assert!(!service.request(super::InitializationPriority::EditorDemand));
        assert_eq!(service.snapshot().state, super::InitializationState::Ready);
        assert_eq!(service.snapshot().starts, 1);
    }

    #[test]
    fn interactive_receipt_precedes_nonblocking_editor_demand_followup() {
        let trace = StartupTrace::new();
        let service = super::InitializationService::default();
        let trace_id = trace.trace_id().to_string();

        let returned = record_frontend_phase_with_followup(
            &trace,
            &trace_id,
            FrontendStartupPhase::Interactive,
            "ok",
            Some("static-shell-handlers-and-ipc-ready".to_string()),
            |snapshot| {
                assert_eq!(
                    snapshot.phases.last().map(|receipt| receipt.phase),
                    Some(NativeStartupPhase::FrontendInteractive)
                );
                assert!(service.request(super::InitializationPriority::EditorDemand));
                assert!(!service.request(super::InitializationPriority::IdleWarm));
            },
        )
        .unwrap();

        assert_eq!(
            returned.phases.last().map(|receipt| receipt.phase),
            Some(NativeStartupPhase::FrontendInteractive)
        );
        let warming = service.snapshot();
        assert_eq!(warming.starts, 1);
        assert_eq!(warming.promotions, 0);
        assert_eq!(warming.state, super::InitializationState::Warming);
        service.finish(&Ok(()));
        assert_eq!(service.snapshot().state, super::InitializationState::Ready);
    }

    #[test]
    fn idle_warm_arms_once_only_after_interactive_receipt() {
        let trace = StartupTrace::new();
        assert!(!trace.arm_idle_warm_after(FrontendStartupPhase::ShellVisible));
        assert!(!trace.arm_idle_warm_after(FrontendStartupPhase::LibraryReady));
        assert!(trace.arm_idle_warm_after(FrontendStartupPhase::Interactive));
        assert!(!trace.arm_idle_warm_after(FrontendStartupPhase::Interactive));
    }

    #[test]
    fn initialization_failure_is_explicitly_degraded_and_not_restarted_implicitly() {
        let service = super::InitializationService::default();
        assert!(service.request(super::InitializationPriority::EditorDemand));
        service.finish(&Err("injected failure".to_string()));
        assert_eq!(
            service.snapshot().state,
            super::InitializationState::Degraded
        );
        assert!(!service.request(super::InitializationPriority::IdleWarm));
        assert_eq!(service.snapshot().starts, 1);
    }
}
