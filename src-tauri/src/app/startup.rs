use std::sync::{Arc, Mutex};
use std::time::Instant;

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
    pub trace_id: String,
    pub phases: Vec<StartupPhaseReceipt>,
}

#[derive(Clone)]
pub struct StartupTrace {
    trace_id: String,
    started_at: Instant,
    phases: Arc<Mutex<Vec<StartupPhaseReceipt>>>,
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
        }
    }

    pub fn trace_id(&self) -> &str {
        &self.trace_id
    }

    pub fn mark(&self, phase: NativeStartupPhase, status: &'static str, detail: Option<String>) {
        let receipt = StartupPhaseReceipt {
            phase,
            elapsed_ms: self.started_at.elapsed().as_millis(),
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
    }

    pub fn snapshot(&self) -> StartupTraceSnapshot {
        StartupTraceSnapshot {
            trace_id: self.trace_id.clone(),
            phases: self.phases.lock().unwrap().clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{NativeStartupPhase, StartupTrace};

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
        assert!(phases[0].elapsed_ms <= phases[1].elapsed_ms);
        assert_eq!(phases[1].detail.as_deref(), Some("shell"));
    }
}
