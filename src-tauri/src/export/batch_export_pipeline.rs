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
    pub fn from_parts(cancelled: Arc<AtomicBool>, notify: Arc<Notify>) -> Self {
        Self { cancelled, notify }
    }

    pub fn token(&self) -> &Arc<AtomicBool> {
        &self.cancelled
    }

    #[cfg(test)]
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    pub async fn cancelled(&self) {
        // Register the notification future before checking the flag.  Otherwise a
        // cancellation between the check and `notified()` can be missed, leaving a
        // credit/queue waiter asleep forever.
        let notified = self.notify.notified();
        if self.is_cancelled() {
            return;
        }
        notified.await;
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

impl WeightedPermit {
    #[cfg(test)]
    pub fn charged_bytes(&self) -> u64 {
        self.bytes
    }
}

/// Couples an in-memory representation to the credit that makes it admissible.
/// Moving the envelope through a channel transfers ownership; dropping it on
/// cancellation or error releases the credit without a separate cleanup path.
pub struct CreditedRepresentation<T> {
    value: T,
    permit: WeightedPermit,
}

impl<T> CreditedRepresentation<T> {
    pub fn new(value: T, permit: WeightedPermit) -> Self {
        Self { value, permit }
    }

    pub fn value(&self) -> &T {
        &self.value
    }

    /// Consume the envelope while retaining its credit permit for the caller's
    /// whole processing stage.  The permit is released when the returned value
    /// is dropped, so memory remains accounted for during blocking work.
    pub fn into_parts(self) -> (T, WeightedPermit) {
        (self.value, self.permit)
    }
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

    #[cfg(test)]
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
pub struct PipelineResources {
    host: WeightedCredits,
    gpu: WeightedCredits,
    encoder: WeightedCredits,
    diagnostics: PipelineDiagnostics,
}

impl PipelineResources {
    pub fn new(budget: ExportResourceBudget, diagnostics: PipelineDiagnostics) -> Self {
        Self {
            host: WeightedCredits::new(budget.host_memory_credits),
            gpu: WeightedCredits::new(budget.gpu_memory_credits),
            encoder: WeightedCredits::new(
                budget
                    .host_memory_credits
                    .saturating_div(3)
                    .max(CREDIT_QUANTUM_BYTES),
            ),
            diagnostics,
        }
    }

    pub async fn acquire_host(
        &self,
        bytes: u64,
        cancellation: &PipelineCancellation,
    ) -> Result<WeightedPermit, String> {
        let permit = self.host.acquire(bytes, cancellation).await?;
        self.refresh_diagnostics();
        Ok(permit)
    }

    pub async fn acquire_gpu(
        &self,
        bytes: u64,
        cancellation: &PipelineCancellation,
    ) -> Result<WeightedPermit, String> {
        let permit = self.gpu.acquire(bytes, cancellation).await?;
        self.refresh_diagnostics();
        Ok(permit)
    }

    pub async fn acquire_encoder(
        &self,
        bytes: u64,
        cancellation: &PipelineCancellation,
    ) -> Result<WeightedPermit, String> {
        self.encoder.acquire(bytes, cancellation).await
    }

    pub fn refresh_diagnostics(&self) {
        self.diagnostics.update(|report| {
            report.host_credit_peak_bytes = self.host.peak_bytes();
            report.gpu_credit_peak_bytes = self.gpu.peak_bytes();
            report.oversized_item_mode_count = self
                .host
                .oversized_count()
                .saturating_add(self.gpu.oversized_count());
        });
    }

    pub fn set_stage(&self, stage: ExportStage) {
        self.diagnostics
            .update(|report| report.current_stage = Some(stage));
    }

    pub fn observe_queue(&self, stage: ExportStage, depth: usize) {
        self.diagnostics.update(|report| {
            let peak = match stage {
                ExportStage::Decoding => &mut report.decode_queue_peak,
                ExportStage::Rendering | ExportStage::Postprocessing => {
                    &mut report.render_queue_peak
                }
                ExportStage::Encoding => &mut report.encode_queue_peak,
                ExportStage::Committing | ExportStage::Finalizing | ExportStage::Planned => {
                    &mut report.commit_queue_peak
                }
            };
            *peak = (*peak).max(depth);
        });
    }

    #[cfg(test)]
    pub fn host_used_bytes(&self) -> u64 {
        self.host.used_bytes()
    }

    #[cfg(test)]
    pub fn gpu_used_bytes(&self) -> u64 {
        self.gpu.used_bytes()
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

    #[allow(dead_code)]
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

    #[tokio::test]
    async fn representation_credits_are_owned_and_released_independently() {
        let budget = ExportResourceBudget {
            host_memory_credits: 8 * CREDIT_QUANTUM_BYTES,
            gpu_memory_credits: 4 * CREDIT_QUANTUM_BYTES,
            ..ExportResourceBudget::conservative(8 * 1024 * 1024 * 1024, 4)
        };
        let diagnostics = PipelineDiagnostics::default();
        let resources = PipelineResources::new(budget, diagnostics.clone());
        let cancellation = PipelineCancellation::default();

        let decoded = resources
            .acquire_host(3 * CREDIT_QUANTUM_BYTES, &cancellation)
            .await
            .expect("decoded representation credit");
        let texture = resources
            .acquire_gpu(2 * CREDIT_QUANTUM_BYTES, &cancellation)
            .await
            .expect("GPU representation credit");
        assert_eq!(decoded.charged_bytes(), 3 * CREDIT_QUANTUM_BYTES);
        assert_eq!(resources.host_used_bytes(), 3 * CREDIT_QUANTUM_BYTES);
        assert_eq!(resources.gpu_used_bytes(), 2 * CREDIT_QUANTUM_BYTES);

        drop(texture);
        assert_eq!(resources.gpu_used_bytes(), 0);
        assert_eq!(resources.host_used_bytes(), 3 * CREDIT_QUANTUM_BYTES);
        drop(decoded);
        assert_eq!(resources.host_used_bytes(), 0);

        let report = diagnostics.snapshot();
        assert_eq!(report.host_credit_peak_bytes, 3 * CREDIT_QUANTUM_BYTES);
        assert_eq!(report.gpu_credit_peak_bytes, 2 * CREDIT_QUANTUM_BYTES);
    }

    #[tokio::test]
    async fn channel_drop_releases_the_representation_credit() {
        let credits = WeightedCredits::new(2 * CREDIT_QUANTUM_BYTES);
        let cancellation = PipelineCancellation::default();
        let permit = credits
            .acquire(2 * CREDIT_QUANTUM_BYTES, &cancellation)
            .await
            .expect("representation permit");
        let (sender, receiver) = tokio::sync::mpsc::channel(1);
        sender
            .send(CreditedRepresentation::new(vec![0_u8; 16], permit))
            .await
            .expect("bounded channel send");
        drop(sender);
        assert_eq!(credits.used_bytes(), 2 * CREDIT_QUANTUM_BYTES);
        drop(receiver);
        assert_eq!(credits.used_bytes(), 0);
    }

    #[tokio::test]
    async fn bounded_credit_stress_reconciles_one_thousand_mixed_items() {
        let capacity = 8 * CREDIT_QUANTUM_BYTES;
        let credits = WeightedCredits::new(capacity);
        let cancellation = PipelineCancellation::default();
        let mut workers = Vec::with_capacity(1_000);
        for index in 0..1_000 {
            let credits = credits.clone();
            let cancellation = cancellation.clone();
            workers.push(tokio::spawn(async move {
                let requested = ((index % 13) as u64 + 1) * CREDIT_QUANTUM_BYTES;
                let permit = credits
                    .acquire(requested, &cancellation)
                    .await
                    .expect("mixed item should be admitted");
                tokio::task::yield_now().await;
                drop(permit);
            }));
        }
        for worker in workers {
            worker.await.expect("stress worker should finish");
        }
        assert_eq!(credits.used_bytes(), 0);
        assert!(credits.peak_bytes() <= capacity);
        assert_eq!(credits.oversized_count(), 384);
    }

    #[tokio::test]
    async fn oversized_admission_does_not_starve_waiting_small_work() {
        let credits = WeightedCredits::new(4 * CREDIT_QUANTUM_BYTES);
        let cancellation = PipelineCancellation::default();
        let oversized = credits
            .acquire(32 * CREDIT_QUANTUM_BYTES, &cancellation)
            .await
            .expect("oversized work should use bounded admission mode");
        let waiting_credits = credits.clone();
        let waiting_cancellation = cancellation.clone();
        let waiter = tokio::spawn(async move {
            waiting_credits
                .acquire(CREDIT_QUANTUM_BYTES, &waiting_cancellation)
                .await
        });
        tokio::task::yield_now().await;
        drop(oversized);
        let small = tokio::time::timeout(Duration::from_secs(1), waiter)
            .await
            .expect("small work should not remain queued")
            .expect("small worker should finish")
            .expect("small work should be admitted after oversized release");
        drop(small);
        assert_eq!(credits.used_bytes(), 0);
    }

    #[test]
    fn queue_peak_diagnostics_remain_bounded_for_large_batches() {
        let diagnostics = PipelineDiagnostics::default();
        let budget = ExportResourceBudget::conservative(16 * 1024 * 1024 * 1024, 12);
        let resources = PipelineResources::new(budget, diagnostics.clone());
        for index in 0..1_000 {
            resources.observe_queue(ExportStage::Decoding, index % budget.decode_queue_capacity);
            resources.observe_queue(ExportStage::Rendering, index % budget.render_queue_capacity);
            resources.observe_queue(ExportStage::Encoding, index % budget.encode_queue_capacity);
            resources.observe_queue(
                ExportStage::Committing,
                index % budget.commit_queue_capacity,
            );
        }
        let report = diagnostics.snapshot();
        assert!(report.decode_queue_peak < budget.decode_queue_capacity);
        assert!(report.render_queue_peak < budget.render_queue_capacity);
        assert!(report.encode_queue_peak < budget.encode_queue_capacity);
        assert!(report.commit_queue_peak < budget.commit_queue_capacity);
    }

    #[tokio::test]
    async fn interactive_gpu_preemption_is_observable_and_cancellation_wakes_waiter() {
        let diagnostics = PipelineDiagnostics::default();
        let lane = CooperativeGpuLane::new(1, diagnostics.clone());
        lane.set_interactive_waiters(1);
        let cancellation = PipelineCancellation::default();
        let waiting_lane = lane.clone();
        let waiting_cancellation = cancellation.clone();
        let waiter = tokio::spawn(async move {
            waiting_lane
                .acquire_export(&waiting_cancellation)
                .await
                .map(|_| ())
        });
        tokio::time::sleep(Duration::from_millis(12)).await;
        cancellation.cancel();
        assert!(
            tokio::time::timeout(Duration::from_secs(1), waiter)
                .await
                .expect("GPU waiter should wake")
                .expect("GPU waiter should join")
                .is_err()
        );
        assert!(diagnostics.snapshot().interactive_preemptions > 0);
    }

    #[tokio::test]
    async fn interactive_gpu_preemption_resumes_when_interactive_waiter_clears() {
        let diagnostics = PipelineDiagnostics::default();
        let lane = CooperativeGpuLane::new(1, diagnostics.clone());
        lane.set_interactive_waiters(1);
        let cancellation = PipelineCancellation::default();
        let waiting_lane = lane.clone();
        let waiting_cancellation = cancellation.clone();
        let waiter = tokio::spawn(async move {
            waiting_lane
                .acquire_export(&waiting_cancellation)
                .await
                .expect("GPU lane should resume")
        });
        tokio::time::sleep(Duration::from_millis(12)).await;
        lane.set_interactive_waiters(0);
        let permit = tokio::time::timeout(Duration::from_secs(1), waiter)
            .await
            .expect("GPU waiter should resume")
            .expect("GPU waiter should join");
        drop(permit);
        assert!(diagnostics.snapshot().interactive_preemptions > 0);
    }
}
