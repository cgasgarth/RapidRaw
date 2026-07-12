#![allow(dead_code)]

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tokio::sync::{Notify, OwnedSemaphorePermit, Semaphore};

const CREDIT_QUANTUM_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ExportStage {
    Planned,
    Decoding,
    Rendering,
    Postprocessing,
    Encoding,
    Committing,
    Finalizing,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ExportWorkEstimate {
    pub source_bytes: u64,
    pub decoded_bytes: u64,
    pub transformed_bytes: u64,
    pub gpu_peak_bytes: u64,
    pub output_pixels: u64,
    pub encoder_peak_bytes: u64,
    pub cpu_weight: u32,
}

impl ExportWorkEstimate {
    pub fn host_peak_bytes(self) -> u64 {
        self.source_bytes
            .saturating_add(self.decoded_bytes)
            .saturating_add(self.transformed_bytes)
            .saturating_add(self.encoder_peak_bytes)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ExportResourceBudget {
    pub decode_queue_capacity: usize,
    pub render_queue_capacity: usize,
    pub encode_queue_capacity: usize,
    pub commit_queue_capacity: usize,
    pub cpu_slots: usize,
    pub encoder_slots: usize,
    pub gpu_slots: usize,
    pub host_memory_credits: u64,
    pub gpu_memory_credits: u64,
}

impl ExportResourceBudget {
    pub fn conservative(available_memory: u64, cores: usize) -> Self {
        let reserved = 2_u64 * 1024 * 1024 * 1024;
        let usable = available_memory.saturating_sub(reserved);
        let host = usable
            .saturating_mul(2)
            .saturating_div(5)
            .max(512 * 1024 * 1024);
        let cpu_slots = cores.clamp(1, 8);
        Self {
            decode_queue_capacity: cpu_slots.min(4),
            render_queue_capacity: 2,
            encode_queue_capacity: cpu_slots.min(4),
            commit_queue_capacity: 2,
            cpu_slots,
            encoder_slots: cpu_slots.div_ceil(2).max(1),
            gpu_slots: 1,
            host_memory_credits: host,
            gpu_memory_credits: 1024 * 1024 * 1024,
        }
    }
}

#[derive(Clone, Default)]
pub struct PipelineCancellation {
    cancelled: Arc<AtomicBool>,
    notify: Arc<Notify>,
}

impl PipelineCancellation {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    pub async fn cancelled(&self) {
        if self.is_cancelled() {
            return;
        }
        self.notify.notified().await;
    }
}

#[derive(Clone)]
pub struct WeightedCredits {
    semaphore: Arc<Semaphore>,
    capacity_units: u32,
    used_bytes: Arc<AtomicU64>,
    peak_bytes: Arc<AtomicU64>,
    oversized_count: Arc<AtomicUsize>,
}

pub struct WeightedPermit {
    _permit: OwnedSemaphorePermit,
    bytes: u64,
    used_bytes: Arc<AtomicU64>,
}

impl Drop for WeightedPermit {
    fn drop(&mut self) {
        self.used_bytes.fetch_sub(self.bytes, Ordering::SeqCst);
    }
}

impl WeightedCredits {
    pub fn new(capacity_bytes: u64) -> Self {
        let capacity_units = bytes_to_units(capacity_bytes).max(1);
        Self {
            semaphore: Arc::new(Semaphore::new(capacity_units as usize)),
            capacity_units,
            used_bytes: Arc::new(AtomicU64::new(0)),
            peak_bytes: Arc::new(AtomicU64::new(0)),
            oversized_count: Arc::new(AtomicUsize::new(0)),
        }
    }

    pub async fn acquire(
        &self,
        bytes: u64,
        cancellation: &PipelineCancellation,
    ) -> Result<WeightedPermit, String> {
        let requested = bytes_to_units(bytes).max(1);
        let oversized = requested > self.capacity_units;
        let units = requested.min(self.capacity_units);
        let permit = tokio::select! {
            permit = Arc::clone(&self.semaphore).acquire_many_owned(units) => {
                permit.map_err(|_| "export resource coordinator closed".to_string())?
            }
            () = cancellation.cancelled() => return Err("export_cancelled_waiting_for_credits".into()),
        };
        if oversized {
            self.oversized_count.fetch_add(1, Ordering::SeqCst);
        }
        let charged = u64::from(units).saturating_mul(CREDIT_QUANTUM_BYTES);
        let used = self.used_bytes.fetch_add(charged, Ordering::SeqCst) + charged;
        self.peak_bytes.fetch_max(used, Ordering::SeqCst);
        Ok(WeightedPermit {
            _permit: permit,
            bytes: charged,
            used_bytes: Arc::clone(&self.used_bytes),
        })
    }

    pub fn used_bytes(&self) -> u64 {
        self.used_bytes.load(Ordering::SeqCst)
    }

    pub fn peak_bytes(&self) -> u64 {
        self.peak_bytes.load(Ordering::SeqCst)
    }

    pub fn oversized_count(&self) -> usize {
        self.oversized_count.load(Ordering::SeqCst)
    }
}

fn bytes_to_units(bytes: u64) -> u32 {
    bytes
        .div_ceil(CREDIT_QUANTUM_BYTES)
        .min(u64::from(u32::MAX)) as u32
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchExportReport {
    pub planned: usize,
    pub completed: usize,
    pub failed: usize,
    pub cancelled: usize,
    pub current_stage: Option<ExportStage>,
    pub decode_queue_peak: usize,
    pub render_queue_peak: usize,
    pub encode_queue_peak: usize,
    pub commit_queue_peak: usize,
    pub host_credit_peak_bytes: u64,
    pub gpu_credit_peak_bytes: u64,
    pub oversized_item_mode_count: usize,
    pub cancellation_latency_ms: Option<u64>,
    pub gpu_wait_ms: u64,
    pub gpu_execution_ms: u64,
    pub interactive_preemptions: usize,
}

#[derive(Clone, Default)]
pub struct PipelineDiagnostics(Arc<Mutex<BatchExportReport>>);

impl PipelineDiagnostics {
    pub fn update(&self, update: impl FnOnce(&mut BatchExportReport)) {
        update(&mut self.0.lock().expect("pipeline diagnostics lock poisoned"));
    }

    pub fn snapshot(&self) -> BatchExportReport {
        self.0
            .lock()
            .expect("pipeline diagnostics lock poisoned")
            .clone()
    }
}

#[derive(Clone)]
pub struct CooperativeGpuLane {
    export_slots: Arc<Semaphore>,
    interactive_waiters: Arc<AtomicUsize>,
    diagnostics: PipelineDiagnostics,
}

impl Default for CooperativeGpuLane {
    fn default() -> Self {
        Self::new(1, PipelineDiagnostics::default())
    }
}

impl CooperativeGpuLane {
    pub fn new(slots: usize, diagnostics: PipelineDiagnostics) -> Self {
        Self {
            export_slots: Arc::new(Semaphore::new(slots.max(1))),
            interactive_waiters: Arc::new(AtomicUsize::new(0)),
            diagnostics,
        }
    }

    pub fn set_interactive_waiters(&self, waiters: usize) {
        self.interactive_waiters.store(waiters, Ordering::SeqCst);
    }

    pub async fn acquire_export(
        &self,
        cancellation: &PipelineCancellation,
    ) -> Result<OwnedSemaphorePermit, String> {
        let started = Instant::now();
        while self.interactive_waiters.load(Ordering::SeqCst) > 0 {
            self.diagnostics
                .update(|report| report.interactive_preemptions += 1);
            tokio::select! {
                () = tokio::time::sleep(Duration::from_millis(4)) => {}
                () = cancellation.cancelled() => return Err("export_cancelled_waiting_for_gpu".into()),
            }
        }
        let permit = tokio::select! {
            permit = Arc::clone(&self.export_slots).acquire_owned() => permit.map_err(|_| "export GPU lane closed".to_string())?,
            () = cancellation.cancelled() => return Err("export_cancelled_waiting_for_gpu".into()),
        };
        self.diagnostics.update(|report| {
            report.gpu_wait_ms = report
                .gpu_wait_ms
                .saturating_add(started.elapsed().as_millis() as u64);
        });
        Ok(permit)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn weighted_credits_reconcile_and_oversized_items_do_not_deadlock() {
        let credits = WeightedCredits::new(4 * CREDIT_QUANTUM_BYTES);
        let cancellation = PipelineCancellation::default();
        let permit = credits
            .acquire(20 * CREDIT_QUANTUM_BYTES, &cancellation)
            .await
            .expect("oversized permit");
        assert_eq!(credits.used_bytes(), 4 * CREDIT_QUANTUM_BYTES);
        assert_eq!(credits.oversized_count(), 1);
        drop(permit);
        assert_eq!(credits.used_bytes(), 0);
    }

    #[tokio::test]
    async fn cancellation_wakes_credit_waiters() {
        let credits = WeightedCredits::new(CREDIT_QUANTUM_BYTES);
        let cancellation = PipelineCancellation::default();
        let held = credits
            .acquire(CREDIT_QUANTUM_BYTES, &cancellation)
            .await
            .expect("held permit");
        let waiting_credits = credits.clone();
        let waiting_cancellation = cancellation.clone();
        let waiter = tokio::spawn(async move {
            waiting_credits
                .acquire(CREDIT_QUANTUM_BYTES, &waiting_cancellation)
                .await
        });
        cancellation.cancel();
        assert!(waiter.await.expect("waiter join").is_err());
        drop(held);
        assert_eq!(credits.used_bytes(), 0);
    }
}
