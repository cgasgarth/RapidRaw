use std::sync::{Arc, Mutex};
use std::time::Instant;

#[cfg(target_os = "macos")]
use std::sync::OnceLock;

#[cfg(target_os = "macos")]
struct EarlyMacosShell {
    started_at: Instant,
    window: usize,
    window_created_ms: u128,
    window_visible_ms: u128,
}

#[cfg(target_os = "macos")]
static EARLY_MACOS_SHELL: OnceLock<Mutex<EarlyMacosShell>> = OnceLock::new();

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
struct AppKitRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[cfg(target_os = "macos")]
unsafe impl objc::Encode for AppKitRect {
    fn encode() -> objc::Encoding {
        unsafe { objc::Encoding::from_str("{CGRect={CGPoint=dd}{CGSize=dd}}") }
    }
}

#[cfg(target_os = "macos")]
pub fn prepare_macos_startup_shell() {
    use objc::runtime::Object;
    use objc::{class, msg_send, sel, sel_impl};

    if EARLY_MACOS_SHELL.get().is_some() {
        return;
    }
    let started_at = Instant::now();
    unsafe {
        let pool: *mut Object = msg_send![class!(NSAutoreleasePool), new];
        let application: *mut Object = msg_send![class!(NSApplication), sharedApplication];
        let () = msg_send![application, setActivationPolicy: 0_i64];
        let allocated: *mut Object = msg_send![class!(NSWindow), alloc];
        let frame = AppKitRect {
            x: 0.0,
            y: 0.0,
            width: 1_100.0,
            height: 720.0,
        };
        let style_mask = 1_u64 | 2_u64 | 4_u64 | 8_u64;
        let window: *mut Object = msg_send![allocated,
            initWithContentRect: frame
            styleMask: style_mask
            backing: 2_u64
            defer: false
        ];
        assert!(
            !window.is_null(),
            "AppKit failed to create early startup shell"
        );
        let created_ms = started_at.elapsed().as_millis();
        let color: *mut Object = msg_send![class!(NSColor),
            colorWithSRGBRed: 0.055_f64
            green: 0.063_f64
            blue: 0.078_f64
            alpha: 1.0_f64
        ];
        let () = msg_send![window, setBackgroundColor: color];
        let () = msg_send![window, setReleasedWhenClosed: false];
        let () = msg_send![window, center];
        let () = msg_send![window, makeKeyAndOrderFront: std::ptr::null::<Object>()];
        let () = msg_send![window, displayIfNeeded];
        let () = msg_send![application, activateIgnoringOtherApps: true];
        let visible_ms = started_at.elapsed().as_millis();
        EARLY_MACOS_SHELL
            .set(Mutex::new(EarlyMacosShell {
                started_at,
                window: window as usize,
                window_created_ms: created_ms,
                window_visible_ms: visible_ms,
            }))
            .ok()
            .expect("early AppKit startup shell initialized once");
        let () = msg_send![pool, drain];
    }
}

#[cfg(target_os = "macos")]
pub fn handoff_macos_startup_shell() {
    use objc::runtime::Object;
    use objc::{msg_send, sel, sel_impl};

    let Some(shell) = EARLY_MACOS_SHELL.get() else {
        return;
    };
    let mut shell = shell.lock().unwrap();
    if shell.window == 0 {
        return;
    }
    unsafe {
        let window = shell.window as *mut Object;
        let () = msg_send![window, orderOut: std::ptr::null::<Object>()];
        let () = msg_send![window, close];
        let () = msg_send![window, release];
    }
    shell.window = 0;
}

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
        #[cfg(target_os = "macos")]
        if let Some(shell) = EARLY_MACOS_SHELL.get() {
            let shell = shell.lock().unwrap();
            return Self {
                trace_id: format!("startup:{}", Uuid::new_v4()),
                started_at: shell.started_at,
                phases: Arc::new(Mutex::new(vec![
                    StartupPhaseReceipt {
                        phase: NativeStartupPhase::ProcessStarted,
                        elapsed_ms: 0,
                        status: "ok",
                        detail: Some("rust-main-entry".to_string()),
                    },
                    StartupPhaseReceipt {
                        phase: NativeStartupPhase::WindowCreated,
                        elapsed_ms: shell.window_created_ms,
                        status: "ok",
                        detail: Some("appkit-pre-tauri-shell".to_string()),
                    },
                    StartupPhaseReceipt {
                        phase: NativeStartupPhase::WindowVisible,
                        elapsed_ms: shell.window_visible_ms,
                        status: "ok",
                        detail: Some("appkit-pre-tauri-shell".to_string()),
                    },
                ])),
                #[cfg(test)]
                test_elapsed_ms: None,
            };
        }
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

/// Commits the native-shell visibility receipt before starting work that is
/// allowed to complete behind that shell (notably clean-account WKWebView
/// initialization on macOS).
#[cfg(any(target_os = "macos", test))]
pub fn after_native_shell_visible<T>(
    trace: &StartupTrace,
    detail: &str,
    initialize_deferred_ui: impl FnOnce() -> T,
) -> T {
    trace.mark(
        NativeStartupPhase::WindowVisible,
        "ok",
        Some(detail.to_string()),
    );
    initialize_deferred_ui()
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
    process < settings && process < created && created < visible
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
    fn injected_heavy_ui_delay_cannot_move_native_shell_visibility_receipt() {
        let clock = Arc::new(AtomicU64::new(100));
        let trace = StartupTrace::with_test_clock(Arc::clone(&clock));
        trace.mark(NativeStartupPhase::ProcessStarted, "ok", None);
        trace.mark(NativeStartupPhase::MinimalSettingsLoaded, "ok", None);
        trace.mark(NativeStartupPhase::WindowCreated, "ok", None);

        super::after_native_shell_visible(&trace, "native-shell-before-webview", || {
            // Models a clean-account WKWebView/framework initialization stall.
            clock.store(2_100, Ordering::SeqCst);
        });
        trace.mark(NativeStartupPhase::CoreCommandsReady, "ok", None);

        let snapshot = trace.snapshot();
        let visible = snapshot
            .phases
            .iter()
            .find(|receipt| receipt.phase == NativeStartupPhase::WindowVisible)
            .expect("native shell visibility receipt");
        assert_eq!(visible.elapsed_ms, 100);
        assert_eq!(snapshot.first_paint_budget_met, Some(true));
        assert_eq!(
            snapshot
                .phases
                .iter()
                .find(|receipt| receipt.phase == NativeStartupPhase::CoreCommandsReady)
                .expect("post-webview receipt")
                .elapsed_ms,
            2_100
        );
    }

    #[test]
    fn pre_tauri_shell_may_precede_minimal_settings_without_weakening_required_order() {
        let clock = Arc::new(AtomicU64::new(0));
        let trace = StartupTrace::with_test_clock(Arc::clone(&clock));
        for (elapsed_ms, phase) in [
            (0, NativeStartupPhase::ProcessStarted),
            (20, NativeStartupPhase::WindowCreated),
            (35, NativeStartupPhase::WindowVisible),
            (80, NativeStartupPhase::MinimalSettingsLoaded),
            (120, NativeStartupPhase::FrontendSettingsHydrated),
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
            35
        );
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
