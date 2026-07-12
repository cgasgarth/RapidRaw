use std::sync::{Arc, Mutex};
use std::time::Instant;

#[cfg(test)]
use std::sync::atomic::{AtomicU64, Ordering};

/// Target from process start through native shell visibility. The shell still
/// remains usable if a host exceeds this budget; the trace makes the miss
/// actionable without turning optional services into a startup failure.
pub const FIRST_PAINT_BUDGET_MS: u128 = 750;

use serde::Serialize;
use uuid::Uuid;

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
    FrontendSettingsHydrated,
    FrontendLibraryReady,
    FrontendEditorReady,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FrontendStartupPhase {
    ShellVisible,
    SettingsHydrated,
    LibraryReady,
    EditorReady,
}

impl From<FrontendStartupPhase> for NativeStartupPhase {
    fn from(phase: FrontendStartupPhase) -> Self {
        match phase {
            FrontendStartupPhase::ShellVisible => Self::FrontendShellVisible,
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
        Self {
            trace_id: format!("startup:{}", Uuid::new_v4()),
            started_at: Instant::now(),
            phases: Arc::new(Mutex::new(Vec::new())),
            #[cfg(test)]
            test_elapsed_ms: None,
        }
    }

    #[cfg(test)]
    fn with_test_clock(test_elapsed_ms: Arc<AtomicU64>) -> Self {
        Self {
            trace_id: format!("startup:{}", Uuid::new_v4()),
            started_at: Instant::now(),
            phases: Arc::new(Mutex::new(Vec::new())),
            test_elapsed_ms: Some(test_elapsed_ms),
        }
    }

    pub fn trace_id(&self) -> &str {
        &self.trace_id
    }

    pub fn mark(&self, phase: NativeStartupPhase, status: &'static str, detail: Option<String>) {
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
        self.phases.lock().unwrap().push(receipt);
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
    let ordered = [
        NativeStartupPhase::ProcessStarted,
        NativeStartupPhase::MinimalSettingsLoaded,
        NativeStartupPhase::WindowCreated,
        NativeStartupPhase::WindowVisible,
    ];
    ordered
        .windows(2)
        .all(|pair| match (first_index(pair[0]), first_index(pair[1])) {
            (Some(left), Some(right)) => left < right,
            (_, None) => true,
            (None, Some(_)) => false,
        })
}

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

#[cfg(test)]
mod tests {
    use super::{
        FIRST_PAINT_BUDGET_MS, FrontendStartupPhase, NativeStartupPhase, StartupTrace,
        mark_deferred_service_result, record_frontend_phase,
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
    fn deterministic_cold_and_warm_traces_meet_first_paint_budget_and_ordering() {
        for (label, timings) in [
            ("cold", [0, 180, 510, 700, 710, 1_900, 2_400]),
            ("warm", [0, 8, 25, 55, 61, 120, 160]),
        ] {
            let clock = Arc::new(AtomicU64::new(0));
            let trace = StartupTrace::with_test_clock(Arc::clone(&clock));
            for (elapsed_ms, phase) in timings.into_iter().zip([
                NativeStartupPhase::ProcessStarted,
                NativeStartupPhase::MinimalSettingsLoaded,
                NativeStartupPhase::WindowCreated,
                NativeStartupPhase::WindowVisible,
                NativeStartupPhase::FrontendShellVisible,
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
}
