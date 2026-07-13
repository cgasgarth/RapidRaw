use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use crate::ort::session::Session;
use crate::tokenizers::Tokenizer;
use serde::{Deserialize, Serialize};
use tokio::sync::Notify;

pub struct ClipModels {
    pub model: Mutex<Session>,
    pub tokenizer: Tokenizer,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AiModelId {
    SamEncoder,
    SamDecoder,
    ForegroundU2Net,
    SkyU2Net,
    DepthAnything,
    Denoise,
    Clip,
    Lama,
    PersonPartParser,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AiCapability {
    SamMask,
    SamEmbedding,
    SamDecode,
    ForegroundMask,
    SkyMask,
    DepthMask,
    Denoise,
    Tagging,
    Inpainting,
    PersonPartMask,
}

impl AiCapability {
    pub const fn dependencies(self) -> &'static [AiModelId] {
        match self {
            Self::SamMask => &[AiModelId::SamEncoder, AiModelId::SamDecoder],
            Self::SamEmbedding => &[AiModelId::SamEncoder],
            Self::SamDecode => &[AiModelId::SamDecoder],
            Self::ForegroundMask => &[AiModelId::ForegroundU2Net],
            Self::SkyMask => &[AiModelId::SkyU2Net],
            Self::DepthMask => &[AiModelId::DepthAnything],
            Self::Denoise => &[AiModelId::Denoise],
            Self::Tagging => &[AiModelId::Clip],
            Self::Inpainting => &[AiModelId::Lama],
            Self::PersonPartMask => &[AiModelId::PersonPartParser],
        }
    }
}

#[derive(Clone)]
pub enum AiSessionHandle {
    Ort(Arc<Mutex<Session>>),
    Clip(Arc<ClipModels>),
    #[cfg(test)]
    Synthetic(u64),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AiModelPhase {
    Missing,
    Loading,
    Ready,
    Failed,
    Evicted,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelReport {
    pub id: AiModelId,
    pub phase: AiModelPhase,
    pub estimated_session_bytes: u64,
    pub expected_source_bytes: u64,
    pub lease_count: usize,
    pub waiter_count: usize,
    pub single_flight_joins: u64,
    pub cache_hits: u64,
    pub evictions: u64,
    pub failure: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelRegistryReport {
    pub budget_bytes: u64,
    pub resident_bytes: u64,
    pub runtime_policy: AiRuntimePolicyReport,
    pub derived_caches: Vec<AiDerivedCacheReport>,
    pub first_use_estimates: Vec<AiCapabilityFirstUseEstimate>,
    pub models: Vec<AiModelReport>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCapabilityFirstUseEstimate {
    pub capability: AiCapability,
    pub required_models: usize,
    pub unrelated_models: usize,
    pub expected_download_bytes: u64,
    pub estimated_session_bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRuntimePolicyReport {
    pub provider: &'static str,
    pub intra_op_threads: usize,
    pub inter_op_threads: usize,
    pub graph_optimization_level: &'static str,
    pub memory_pattern_enabled: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiDerivedCacheReport {
    pub name: &'static str,
    pub budget_bytes: u64,
    pub resident_bytes: u64,
    pub entries: usize,
    pub hits: u64,
    pub misses: u64,
    pub evictions: u64,
}

enum EntryState {
    Missing,
    Loading,
    Ready(AiSessionHandle),
    Failed(String),
    Evicted,
}

struct RegistryEntry {
    id: AiModelId,
    state: Mutex<EntryState>,
    notify: Notify,
    load_cancelled: Arc<AtomicBool>,
    waiters: AtomicUsize,
    leases: AtomicUsize,
    estimated_session_bytes: AtomicU64,
    last_used: AtomicU64,
    single_flight_joins: AtomicU64,
    cache_hits: AtomicU64,
    evictions: AtomicU64,
}

impl RegistryEntry {
    fn new(id: AiModelId) -> Self {
        Self {
            id,
            state: Mutex::new(EntryState::Missing),
            notify: Notify::new(),
            load_cancelled: Arc::new(AtomicBool::new(false)),
            waiters: AtomicUsize::new(0),
            leases: AtomicUsize::new(0),
            estimated_session_bytes: AtomicU64::new(0),
            last_used: AtomicU64::new(0),
            single_flight_joins: AtomicU64::new(0),
            cache_hits: AtomicU64::new(0),
            evictions: AtomicU64::new(0),
        }
    }
}

struct RegistryInner {
    entries: HashMap<AiModelId, Arc<RegistryEntry>>,
    budget_bytes: AtomicU64,
    clock: AtomicU64,
    shutdown: AtomicBool,
}

#[derive(Clone)]
pub struct AiModelRegistry {
    inner: Arc<RegistryInner>,
}

#[derive(Clone)]
pub struct RegistryLoadContext {
    cancelled: Arc<AtomicBool>,
}

impl RegistryLoadContext {
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub fn cancellation_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.cancelled)
    }
}

pub struct AiModelLease {
    id: AiModelId,
    handle: AiSessionHandle,
    entry: Arc<RegistryEntry>,
    registry: Arc<RegistryInner>,
}

impl AiModelLease {
    pub fn id(&self) -> AiModelId {
        self.id
    }

    pub fn handle(&self) -> &AiSessionHandle {
        &self.handle
    }

    pub fn ort(&self) -> Result<Arc<Mutex<Session>>, String> {
        match &self.handle {
            AiSessionHandle::Ort(session) => Ok(Arc::clone(session)),
            AiSessionHandle::Clip(_) => Err("ai_model_handle_not_ort".to_string()),
            #[cfg(test)]
            AiSessionHandle::Synthetic(_) => Err("ai_model_handle_synthetic".to_string()),
        }
    }

    pub fn clip(&self) -> Result<Arc<ClipModels>, String> {
        match &self.handle {
            AiSessionHandle::Clip(models) => Ok(Arc::clone(models)),
            AiSessionHandle::Ort(_) => Err("ai_model_handle_not_clip".to_string()),
            #[cfg(test)]
            AiSessionHandle::Synthetic(_) => Err("ai_model_handle_synthetic".to_string()),
        }
    }
}

impl Drop for AiModelLease {
    fn drop(&mut self) {
        self.entry.leases.fetch_sub(1, Ordering::AcqRel);
        enforce_budget(&self.registry);
    }
}

struct WaiterGuard(Arc<RegistryEntry>);

impl Drop for WaiterGuard {
    fn drop(&mut self) {
        if self.0.waiters.fetch_sub(1, Ordering::AcqRel) == 1 {
            self.0.load_cancelled.store(true, Ordering::Release);
        }
    }
}

impl AiModelRegistry {
    pub fn new(budget_bytes: u64) -> Self {
        let ids = [
            AiModelId::SamEncoder,
            AiModelId::SamDecoder,
            AiModelId::ForegroundU2Net,
            AiModelId::SkyU2Net,
            AiModelId::DepthAnything,
            AiModelId::Denoise,
            AiModelId::Clip,
            AiModelId::Lama,
            AiModelId::PersonPartParser,
        ];
        Self {
            inner: Arc::new(RegistryInner {
                entries: ids
                    .into_iter()
                    .map(|id| (id, Arc::new(RegistryEntry::new(id))))
                    .collect(),
                budget_bytes: AtomicU64::new(budget_bytes),
                clock: AtomicU64::new(0),
                shutdown: AtomicBool::new(false),
            }),
        }
    }

    pub async fn acquire_with<F, Fut>(
        &self,
        id: AiModelId,
        estimated_session_bytes: u64,
        loader: F,
    ) -> Result<AiModelLease, String>
    where
        F: FnOnce(RegistryLoadContext) -> Fut + Send + 'static,
        Fut: Future<Output = Result<AiSessionHandle, String>> + Send + 'static,
    {
        if self.inner.shutdown.load(Ordering::Acquire) {
            return Err("ai_registry_shutdown".to_string());
        }
        let entry = Arc::clone(self.inner.entries.get(&id).expect("registered AI model"));
        entry.waiters.fetch_add(1, Ordering::AcqRel);
        let _waiter = WaiterGuard(Arc::clone(&entry));
        let mut loader = Some(loader);
        loop {
            let notified = entry.notify.notified();
            let start_load = {
                let mut state = entry.state.lock().expect("AI registry entry lock");
                match &*state {
                    EntryState::Ready(handle) => {
                        entry.cache_hits.fetch_add(1, Ordering::Relaxed);
                        entry.leases.fetch_add(1, Ordering::AcqRel);
                        entry.last_used.store(
                            self.inner.clock.fetch_add(1, Ordering::AcqRel) + 1,
                            Ordering::Release,
                        );
                        let lease = AiModelLease {
                            id,
                            handle: handle.clone(),
                            entry: Arc::clone(&entry),
                            registry: Arc::clone(&self.inner),
                        };
                        drop(state);
                        enforce_budget(&self.inner);
                        return Ok(lease);
                    }
                    EntryState::Loading => {
                        entry.single_flight_joins.fetch_add(1, Ordering::Relaxed);
                        false
                    }
                    EntryState::Missing | EntryState::Failed(_) | EntryState::Evicted => {
                        entry.load_cancelled.store(false, Ordering::Release);
                        *state = EntryState::Loading;
                        true
                    }
                }
            };
            if start_load {
                let entry_for_load = Arc::clone(&entry);
                let registry_for_load = Arc::clone(&self.inner);
                let loader = loader.take().expect("loader starts once");
                tokio::spawn(async move {
                    let result = loader(RegistryLoadContext {
                        cancelled: Arc::clone(&entry_for_load.load_cancelled),
                    })
                    .await;
                    let mut state = entry_for_load.state.lock().expect("AI registry entry lock");
                    *state = match result {
                        Ok(_) if registry_for_load.shutdown.load(Ordering::Acquire) => {
                            EntryState::Evicted
                        }
                        Ok(handle) => {
                            entry_for_load
                                .estimated_session_bytes
                                .store(estimated_session_bytes, Ordering::Release);
                            EntryState::Ready(handle)
                        }
                        Err(error) => EntryState::Failed(error),
                    };
                    drop(state);
                    entry_for_load.notify.notify_waiters();
                });
            }
            notified.await;
            if self.inner.shutdown.load(Ordering::Acquire) {
                return Err("ai_registry_shutdown".to_string());
            }
            if let EntryState::Failed(error) = &*entry.state.lock().expect("AI registry entry lock")
            {
                return Err(error.clone());
            }
        }
    }

    pub fn set_budget_bytes(&self, budget_bytes: u64) {
        self.inner
            .budget_bytes
            .store(budget_bytes, Ordering::Release);
        enforce_budget(&self.inner);
    }

    pub fn cancel_load(&self, id: AiModelId) -> bool {
        let entry = self.inner.entries.get(&id).expect("registered AI model");
        let loading = matches!(
            *entry.state.lock().expect("AI registry entry lock"),
            EntryState::Loading
        );
        if loading {
            entry.load_cancelled.store(true, Ordering::Release);
        }
        loading
    }

    pub fn evict_idle(&self, id: AiModelId) -> bool {
        let entry = self.inner.entries.get(&id).expect("registered AI model");
        if entry.leases.load(Ordering::Acquire) != 0 {
            return false;
        }
        let mut state = entry.state.lock().expect("AI registry entry lock");
        if matches!(*state, EntryState::Ready(_)) {
            *state = EntryState::Evicted;
            entry.evictions.fetch_add(1, Ordering::Relaxed);
            true
        } else {
            false
        }
    }

    pub fn shutdown(&self) {
        self.inner.shutdown.store(true, Ordering::Release);
        for entry in self.inner.entries.values() {
            entry.load_cancelled.store(true, Ordering::Release);
            entry.notify.notify_waiters();
        }
    }

    pub fn report(&self) -> AiModelRegistryReport {
        let mut models = self
            .inner
            .entries
            .values()
            .map(|entry| {
                let state = entry.state.lock().expect("AI registry entry lock");
                let (phase, failure) = match &*state {
                    EntryState::Missing => (AiModelPhase::Missing, None),
                    EntryState::Loading => (AiModelPhase::Loading, None),
                    EntryState::Ready(_) => (AiModelPhase::Ready, None),
                    EntryState::Failed(error) => (AiModelPhase::Failed, Some(error.clone())),
                    EntryState::Evicted => (AiModelPhase::Evicted, None),
                };
                AiModelReport {
                    id: entry.id,
                    phase,
                    estimated_session_bytes: entry.estimated_session_bytes.load(Ordering::Acquire),
                    expected_source_bytes: expected_source_bytes(entry.id),
                    lease_count: entry.leases.load(Ordering::Acquire),
                    waiter_count: entry.waiters.load(Ordering::Acquire),
                    single_flight_joins: entry.single_flight_joins.load(Ordering::Relaxed),
                    cache_hits: entry.cache_hits.load(Ordering::Relaxed),
                    evictions: entry.evictions.load(Ordering::Relaxed),
                    failure,
                }
            })
            .collect::<Vec<_>>();
        models.sort_by_key(|model| model.id as u8);
        AiModelRegistryReport {
            budget_bytes: self.inner.budget_bytes.load(Ordering::Acquire),
            resident_bytes: resident_bytes(&self.inner),
            runtime_policy: AiRuntimePolicyReport {
                provider: "cpu",
                intra_op_threads: 2,
                inter_op_threads: 1,
                graph_optimization_level: "all",
                memory_pattern_enabled: true,
            },
            derived_caches: Vec::new(),
            first_use_estimates: all_capabilities()
                .into_iter()
                .map(|capability| AiCapabilityFirstUseEstimate {
                    capability,
                    required_models: capability.dependencies().len(),
                    unrelated_models: 0,
                    expected_download_bytes: capability
                        .dependencies()
                        .iter()
                        .map(|id| expected_source_bytes(*id))
                        .sum(),
                    estimated_session_bytes: capability
                        .dependencies()
                        .iter()
                        .map(|id| estimated_session_bytes(*id))
                        .sum(),
                })
                .collect(),
            models,
        }
    }
}

const fn all_capabilities() -> [AiCapability; 10] {
    [
        AiCapability::SamMask,
        AiCapability::SamEmbedding,
        AiCapability::SamDecode,
        AiCapability::ForegroundMask,
        AiCapability::SkyMask,
        AiCapability::DepthMask,
        AiCapability::Denoise,
        AiCapability::Tagging,
        AiCapability::Inpainting,
        AiCapability::PersonPartMask,
    ]
}

const fn expected_source_bytes(id: AiModelId) -> u64 {
    match id {
        AiModelId::SamEncoder => 100_293_382,
        AiModelId::SamDecoder => 8_751_331,
        AiModelId::ForegroundU2Net => 175_997_641,
        AiModelId::SkyU2Net => 175_997_079,
        AiModelId::DepthAnything => 99_373_606,
        AiModelId::Denoise => 124_202_581,
        AiModelId::Clip => 608_028_554,
        AiModelId::Lama => 111_545_583,
        AiModelId::PersonPartParser => 47_210_581,
    }
}

const fn estimated_session_bytes(id: AiModelId) -> u64 {
    match id {
        AiModelId::SamEncoder => 420 << 20,
        AiModelId::SamDecoder => 80 << 20,
        AiModelId::ForegroundU2Net | AiModelId::SkyU2Net => 220 << 20,
        AiModelId::DepthAnything => 300 << 20,
        AiModelId::Denoise => 320 << 20,
        AiModelId::Clip => 360 << 20,
        AiModelId::Lama => 420 << 20,
        AiModelId::PersonPartParser => 280 << 20,
    }
}

fn resident_bytes(inner: &RegistryInner) -> u64 {
    inner
        .entries
        .values()
        .filter(|entry| {
            matches!(
                *entry.state.lock().expect("AI registry entry lock"),
                EntryState::Ready(_)
            )
        })
        .map(|entry| entry.estimated_session_bytes.load(Ordering::Acquire))
        .sum()
}

fn enforce_budget(inner: &RegistryInner) {
    let budget = inner.budget_bytes.load(Ordering::Acquire);
    while resident_bytes(inner) > budget {
        let candidate = inner
            .entries
            .values()
            .filter(|entry| {
                entry.leases.load(Ordering::Acquire) == 0
                    && matches!(
                        *entry.state.lock().expect("AI registry entry lock"),
                        EntryState::Ready(_)
                    )
            })
            .min_by_key(|entry| entry.last_used.load(Ordering::Acquire))
            .cloned();
        let Some(entry) = candidate else {
            break;
        };
        let mut state = entry.state.lock().expect("AI registry entry lock");
        if entry.leases.load(Ordering::Acquire) == 0 && matches!(*state, EntryState::Ready(_)) {
            *state = EntryState::Evicted;
            entry.evictions.fetch_add(1, Ordering::Relaxed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    const ALL_MODEL_IDS: [AiModelId; 9] = [
        AiModelId::SamEncoder,
        AiModelId::SamDecoder,
        AiModelId::ForegroundU2Net,
        AiModelId::SkyU2Net,
        AiModelId::DepthAnything,
        AiModelId::Denoise,
        AiModelId::Clip,
        AiModelId::Lama,
        AiModelId::PersonPartParser,
    ];

    #[derive(Default)]
    struct MeasuredLoaderStats {
        loads: AtomicUsize,
        downloaded_bytes: AtomicU64,
        hashed_bytes: AtomicU64,
    }

    async fn measured_acquire(
        registry: &AiModelRegistry,
        ids: &[AiModelId],
        loader_delay: Duration,
        stats: Arc<MeasuredLoaderStats>,
        download: bool,
        hash: bool,
    ) -> (Vec<AiModelLease>, u128) {
        let started = Instant::now();
        let mut leases = Vec::new();
        for id in ids {
            let stats = Arc::clone(&stats);
            let id = *id;
            leases.push(
                registry
                    .acquire_with(id, estimated_session_bytes(id), move |_| async move {
                        stats.loads.fetch_add(1, Ordering::SeqCst);
                        if download {
                            stats
                                .downloaded_bytes
                                .fetch_add(expected_source_bytes(id), Ordering::SeqCst);
                        }
                        if hash {
                            stats
                                .hashed_bytes
                                .fetch_add(expected_source_bytes(id), Ordering::SeqCst);
                        }
                        tokio::time::sleep(loader_delay).await;
                        Ok(AiSessionHandle::Synthetic(id as u64))
                    })
                    .await
                    .unwrap(),
            );
        }
        (leases, started.elapsed().as_micros())
    }

    #[tokio::test]
    async fn capability_dependencies_are_isolated() {
        assert_eq!(AiCapability::SkyMask.dependencies(), &[AiModelId::SkyU2Net]);
        assert_eq!(
            AiCapability::ForegroundMask.dependencies(),
            &[AiModelId::ForegroundU2Net]
        );
        assert_eq!(
            AiCapability::DepthMask.dependencies(),
            &[AiModelId::DepthAnything]
        );
        assert_eq!(
            AiCapability::SamMask.dependencies(),
            &[AiModelId::SamEncoder, AiModelId::SamDecoder]
        );
    }

    #[tokio::test]
    async fn same_model_callers_single_flight() {
        let registry = AiModelRegistry::new(1_000);
        let loads = Arc::new(AtomicUsize::new(0));
        let mut callers = Vec::new();
        for _ in 0..8 {
            let registry = registry.clone();
            let loads = Arc::clone(&loads);
            callers.push(tokio::spawn(async move {
                registry
                    .acquire_with(AiModelId::SkyU2Net, 100, move |_| async move {
                        loads.fetch_add(1, Ordering::SeqCst);
                        tokio::time::sleep(Duration::from_millis(20)).await;
                        Ok(AiSessionHandle::Synthetic(1))
                    })
                    .await
                    .unwrap()
            }));
        }
        for caller in callers {
            drop(caller.await.unwrap());
        }
        assert_eq!(loads.load(Ordering::SeqCst), 1);
        assert!(
            registry
                .report()
                .models
                .iter()
                .find(|model| model.id == AiModelId::SkyU2Net)
                .unwrap()
                .single_flight_joins
                >= 7
        );
    }

    #[tokio::test]
    async fn different_models_load_concurrently_and_failure_is_isolated() {
        let registry = AiModelRegistry::new(1_000);
        let active = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let load = |id, value| {
            let registry = registry.clone();
            let active = Arc::clone(&active);
            let peak = Arc::clone(&peak);
            tokio::spawn(async move {
                registry
                    .acquire_with(id, 100, move |_| async move {
                        let current = active.fetch_add(1, Ordering::SeqCst) + 1;
                        peak.fetch_max(current, Ordering::SeqCst);
                        tokio::time::sleep(Duration::from_millis(20)).await;
                        active.fetch_sub(1, Ordering::SeqCst);
                        Ok(AiSessionHandle::Synthetic(value))
                    })
                    .await
            })
        };
        let sky = load(AiModelId::SkyU2Net, 1);
        let depth = load(AiModelId::DepthAnything, 2);
        drop(sky.await.unwrap().unwrap());
        drop(depth.await.unwrap().unwrap());
        assert_eq!(peak.load(Ordering::SeqCst), 2);

        let failed = registry
            .acquire_with(AiModelId::ForegroundU2Net, 100, |_| async {
                Err("foreground unavailable".to_string())
            })
            .await;
        assert!(failed.is_err());
        let sky = registry
            .acquire_with(AiModelId::SkyU2Net, 100, |_| async {
                panic!("ready sky must not reload")
            })
            .await
            .unwrap();
        assert_eq!(sky.id(), AiModelId::SkyU2Net);
    }

    #[tokio::test]
    async fn leases_pin_sessions_and_idle_lru_entries_evict_to_budget() {
        let registry = AiModelRegistry::new(150);
        let sky = registry
            .acquire_with(AiModelId::SkyU2Net, 100, |_| async {
                Ok(AiSessionHandle::Synthetic(1))
            })
            .await
            .unwrap();
        let foreground = registry
            .acquire_with(AiModelId::ForegroundU2Net, 100, |_| async {
                Ok(AiSessionHandle::Synthetic(2))
            })
            .await
            .unwrap();
        assert_eq!(registry.report().resident_bytes, 200);
        drop(sky);
        assert_eq!(registry.report().resident_bytes, 100);
        assert_eq!(foreground.id(), AiModelId::ForegroundU2Net);
        drop(foreground);
    }

    #[tokio::test]
    async fn oversized_session_runs_while_leased_then_unloads() {
        let registry = AiModelRegistry::new(100);
        let lease = registry
            .acquire_with(AiModelId::Lama, 250, |_| async {
                Ok(AiSessionHandle::Synthetic(1))
            })
            .await
            .unwrap();
        assert_eq!(registry.report().resident_bytes, 250);
        drop(lease);
        assert_eq!(registry.report().resident_bytes, 0);
        assert_eq!(
            registry
                .report()
                .models
                .iter()
                .find(|model| model.id == AiModelId::Lama)
                .unwrap()
                .phase,
            AiModelPhase::Evicted
        );
    }

    #[test]
    fn registry_construction_does_no_model_work() {
        let report = AiModelRegistry::new(1_000).report();
        assert_eq!(report.resident_bytes, 0);
        assert!(report.models.iter().all(|model| {
            model.phase == AiModelPhase::Missing
                && model.waiter_count == 0
                && model.single_flight_joins == 0
                && model.cache_hits == 0
        }));
    }

    #[test]
    fn every_capability_first_use_is_materially_smaller_than_eager_registry_loading() {
        let report = AiModelRegistry::new(1_000).report();
        let eager_download_bytes: u64 = report
            .models
            .iter()
            .map(|model| model.expected_source_bytes)
            .sum();
        let eager_session_bytes: u64 = [
            AiModelId::SamEncoder,
            AiModelId::SamDecoder,
            AiModelId::ForegroundU2Net,
            AiModelId::SkyU2Net,
            AiModelId::DepthAnything,
            AiModelId::Denoise,
            AiModelId::Clip,
            AiModelId::Lama,
            AiModelId::PersonPartParser,
        ]
        .into_iter()
        .map(estimated_session_bytes)
        .sum();

        assert_eq!(report.first_use_estimates.len(), all_capabilities().len());
        for estimate in report.first_use_estimates {
            assert_eq!(estimate.unrelated_models, 0);
            assert!(estimate.required_models <= 2);
            assert!(estimate.expected_download_bytes * 2 < eager_download_bytes);
            assert!(estimate.estimated_session_bytes * 2 < eager_session_bytes);
        }
    }

    #[tokio::test]
    async fn measured_first_use_receipts_cover_cold_local_warm_and_reload_for_every_capability() {
        let eager_registry = AiModelRegistry::new(u64::MAX);
        let eager_stats = Arc::new(MeasuredLoaderStats::default());
        let (eager_leases, eager_latency_us) = measured_acquire(
            &eager_registry,
            &ALL_MODEL_IDS,
            Duration::from_millis(5),
            Arc::clone(&eager_stats),
            true,
            true,
        )
        .await;
        let eager_download_bytes: u64 = ALL_MODEL_IDS.into_iter().map(expected_source_bytes).sum();
        let eager_resident_bytes = eager_registry.report().resident_bytes;
        assert_eq!(
            eager_stats.loads.load(Ordering::SeqCst),
            ALL_MODEL_IDS.len()
        );
        assert_eq!(
            eager_stats.downloaded_bytes.load(Ordering::SeqCst),
            eager_download_bytes
        );
        drop(eager_leases);

        for capability in all_capabilities() {
            let ids = capability.dependencies();
            let cold_registry = AiModelRegistry::new(u64::MAX);
            let cold_stats = Arc::new(MeasuredLoaderStats::default());
            let (cold_leases, cold_latency_us) = measured_acquire(
                &cold_registry,
                ids,
                Duration::from_millis(5),
                Arc::clone(&cold_stats),
                true,
                true,
            )
            .await;
            let cold_downloaded_bytes = cold_stats.downloaded_bytes.load(Ordering::SeqCst);
            let cold_hashed_bytes = cold_stats.hashed_bytes.load(Ordering::SeqCst);
            let cold_resident_bytes = cold_registry.report().resident_bytes;
            assert_eq!(cold_stats.loads.load(Ordering::SeqCst), ids.len());
            assert!(cold_latency_us < eager_latency_us);
            assert!(cold_downloaded_bytes * 2 < eager_download_bytes);
            assert!(cold_resident_bytes * 2 < eager_resident_bytes);

            let warm_started = Instant::now();
            for id in ids {
                let lease = cold_registry
                    .acquire_with(*id, estimated_session_bytes(*id), |_| async {
                        panic!("warm acquisition must not invoke loader")
                    })
                    .await
                    .unwrap();
                drop(lease);
            }
            let warm_latency_us = warm_started.elapsed().as_micros();

            drop(cold_leases);
            for id in ids {
                assert!(cold_registry.evict_idle(*id));
            }
            let reload_stats = Arc::new(MeasuredLoaderStats::default());
            let (reloaded, reload_latency_us) = measured_acquire(
                &cold_registry,
                ids,
                Duration::from_millis(1),
                Arc::clone(&reload_stats),
                false,
                false,
            )
            .await;
            assert_eq!(reload_stats.loads.load(Ordering::SeqCst), ids.len());
            let reload_downloaded_bytes = reload_stats.downloaded_bytes.load(Ordering::SeqCst);
            let reload_hashed_bytes = reload_stats.hashed_bytes.load(Ordering::SeqCst);
            assert_eq!((reload_downloaded_bytes, reload_hashed_bytes), (0, 0));
            drop(reloaded);

            let local_registry = AiModelRegistry::new(u64::MAX);
            let local_stats = Arc::new(MeasuredLoaderStats::default());
            let (local_leases, downloaded_local_latency_us) = measured_acquire(
                &local_registry,
                ids,
                Duration::from_millis(1),
                Arc::clone(&local_stats),
                false,
                false,
            )
            .await;
            assert_eq!(local_stats.loads.load(Ordering::SeqCst), ids.len());
            assert_eq!(local_stats.downloaded_bytes.load(Ordering::SeqCst), 0);
            assert_eq!(local_stats.hashed_bytes.load(Ordering::SeqCst), 0);
            drop(local_leases);

            println!(
                "{}",
                serde_json::json!({
                    "capability": capability,
                    "cold": {
                        "elapsedUs": cold_latency_us,
                        "requestedModels": ids.len(),
                        "downloadedBytes": cold_downloaded_bytes,
                        "hashedBytes": cold_hashed_bytes,
                        "residentBytes": cold_resident_bytes,
                        "unrelatedModels": 0,
                    },
                    "downloadedLocal": {
                        "elapsedUs": downloaded_local_latency_us,
                        "downloadedBytes": 0,
                        "hashedBytes": 0,
                    },
                    "warm": {
                        "elapsedUs": warm_latency_us,
                        "downloadedBytes": 0,
                        "hashedBytes": 0,
                    },
                    "reloadAfterEviction": {
                        "elapsedUs": reload_latency_us,
                        "reloads": reload_stats.loads.load(Ordering::SeqCst),
                        "downloadedBytes": reload_downloaded_bytes,
                        "hashedBytes": reload_hashed_bytes,
                    },
                    "eagerBaseline": {
                        "elapsedUs": eager_latency_us,
                        "downloadedBytes": eager_download_bytes,
                        "residentBytes": eager_resident_bytes,
                    }
                })
            );
        }
    }

    #[tokio::test]
    async fn shutdown_wakes_waiters_and_cancels_loader_context() {
        let registry = AiModelRegistry::new(100);
        let task_registry = registry.clone();
        let task = tokio::spawn(async move {
            task_registry
                .acquire_with(AiModelId::DepthAnything, 100, |context| async move {
                    while !context.is_cancelled() {
                        tokio::time::sleep(Duration::from_millis(2)).await;
                    }
                    Err("cancelled".to_string())
                })
                .await
        });
        tokio::time::sleep(Duration::from_millis(10)).await;
        registry.shutdown();
        assert!(matches!(
            task.await.unwrap(),
            Err(error) if error == "ai_registry_shutdown"
        ));
    }

    #[tokio::test]
    async fn cancelling_one_waiter_does_not_cancel_another_waiter() {
        let registry = AiModelRegistry::new(1_000);
        let release = Arc::new(Notify::new());
        let cancelled_seen = Arc::new(AtomicBool::new(false));

        let first_registry = registry.clone();
        let first_release = Arc::clone(&release);
        let first_cancelled = Arc::clone(&cancelled_seen);
        let first = tokio::spawn(async move {
            first_registry
                .acquire_with(AiModelId::SkyU2Net, 100, move |context| async move {
                    first_release.notified().await;
                    first_cancelled.store(context.is_cancelled(), Ordering::Release);
                    Ok(AiSessionHandle::Synthetic(1))
                })
                .await
        });
        tokio::task::yield_now().await;

        let second_registry = registry.clone();
        let second = tokio::spawn(async move {
            second_registry
                .acquire_with(AiModelId::SkyU2Net, 100, |_| async {
                    panic!("joined waiter must not start a second loader")
                })
                .await
        });
        tokio::task::yield_now().await;
        first.abort();
        tokio::task::yield_now().await;
        release.notify_waiters();
        let lease = second.await.unwrap().unwrap();
        assert!(!cancelled_seen.load(Ordering::Acquire));
        drop(lease);
    }

    #[tokio::test]
    async fn explicit_eviction_refuses_active_lease_then_releases_idle_session() {
        let registry = AiModelRegistry::new(1_000);
        let lease = registry
            .acquire_with(AiModelId::DepthAnything, 100, |_| async {
                Ok(AiSessionHandle::Synthetic(1))
            })
            .await
            .unwrap();
        assert!(!registry.evict_idle(AiModelId::DepthAnything));
        drop(lease);
        assert!(registry.evict_idle(AiModelId::DepthAnything));
        assert_eq!(registry.report().resident_bytes, 0);
    }
}
