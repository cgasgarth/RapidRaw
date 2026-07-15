use std::sync::Arc;

use crate::ai::ai_processing::{
    AiCapabilityLeaseSet, CachedDepthMap, ImageEmbeddings, acquire_capability, acquire_clip_model,
    acquire_ort_model,
};
use crate::ai::model_registry::{
    AiCapability, AiDerivedCacheReport, AiModelId, AiModelLease, AiModelRegistry,
    AiModelRegistryReport,
};
use crate::render::native_cache::{CacheBudgetCoordinator, CachePolicy, MemoryLruCache};

pub(crate) struct AiRuntimeService {
    registry: AiModelRegistry,
    embeddings: MemoryLruCache<String, ImageEmbeddings>,
    depth_maps: MemoryLruCache<String, CachedDepthMap>,
}

impl AiRuntimeService {
    pub(crate) fn new(cache_budget: Arc<CacheBudgetCoordinator>) -> Self {
        const MIB: u64 = 1024 * 1024;
        Self {
            registry: AiModelRegistry::new(1536 * MIB),
            embeddings: MemoryLruCache::new(
                CachePolicy {
                    name: "ai_embeddings",
                    soft_limit_bytes: 256 * MIB,
                    hard_limit_bytes: 384 * MIB,
                    max_entries: Some(4),
                },
                Arc::clone(&cache_budget),
            ),
            depth_maps: MemoryLruCache::new(
                CachePolicy {
                    name: "ai_depth_maps",
                    soft_limit_bytes: 128 * MIB,
                    hard_limit_bytes: 192 * MIB,
                    max_entries: Some(4),
                },
                cache_budget,
            ),
        }
    }

    pub(crate) fn report(&self) -> AiModelRegistryReport {
        let mut report = self.registry.report();
        report.derived_caches = [self.embeddings.stats(), self.depth_maps.stats()]
            .map(|stats| AiDerivedCacheReport {
                name: stats.name,
                budget_bytes: stats.soft_limit_bytes,
                resident_bytes: stats.bytes,
                entries: stats.entries,
                hits: stats.hits,
                misses: stats.misses,
                evictions: stats.evictions,
            })
            .to_vec();
        report
    }

    pub(crate) fn cancel_model_load(&self, id: AiModelId) -> bool {
        self.registry.cancel_load(id)
    }

    pub(crate) fn evict_model_session(&self, id: AiModelId) -> bool {
        self.registry.evict_idle(id)
    }

    pub(crate) async fn acquire_capability(
        &self,
        app_handle: &tauri::AppHandle,
        capability: AiCapability,
    ) -> anyhow::Result<AiCapabilityLeaseSet> {
        acquire_capability(app_handle, &self.registry, capability).await
    }

    pub(crate) async fn acquire_ort_model(
        &self,
        app_handle: &tauri::AppHandle,
        id: AiModelId,
    ) -> anyhow::Result<AiModelLease> {
        acquire_ort_model(app_handle, &self.registry, id).await
    }

    pub(crate) async fn acquire_clip_model(
        &self,
        app_handle: &tauri::AppHandle,
    ) -> anyhow::Result<AiModelLease> {
        acquire_clip_model(app_handle, &self.registry).await
    }

    pub(crate) fn embedding(&self, key: &String) -> Option<Arc<ImageEmbeddings>> {
        self.embeddings.get(key)
    }

    pub(crate) fn cache_embedding(
        &self,
        key: String,
        value: Arc<ImageEmbeddings>,
        retained_bytes: u64,
    ) {
        self.embeddings.insert(key, value, retained_bytes);
    }

    pub(crate) fn depth_map(&self, key: &String) -> Option<Arc<CachedDepthMap>> {
        self.depth_maps.get(key)
    }

    pub(crate) fn cache_depth_map(
        &self,
        key: String,
        value: Arc<CachedDepthMap>,
        retained_bytes: u64,
    ) {
        self.depth_maps.insert(key, value, retained_bytes);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render::native_cache::CacheBudgetCoordinator;
    use image::GrayImage;
    use ndarray::{Array, IxDyn};
    use std::sync::Barrier;
    use std::thread;
    use tokio::sync::Notify;

    fn service() -> Arc<AiRuntimeService> {
        Arc::new(AiRuntimeService::new(CacheBudgetCoordinator::new(
            768 * 1024 * 1024,
            1024 * 1024 * 1024,
        )))
    }

    fn embeddings(key: &str) -> Arc<ImageEmbeddings> {
        Arc::new(ImageEmbeddings {
            path_hash: key.to_string(),
            embeddings: Array::zeros(IxDyn(&[1, 1])),
            original_size: (1, 1),
        })
    }

    #[test]
    fn concurrent_cache_access_preserves_one_authoritative_entry_and_report() {
        let service = service();
        let barrier = Arc::new(Barrier::new(9));
        let workers: Vec<_> = (0..8)
            .map(|_| {
                let service = Arc::clone(&service);
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    barrier.wait();
                    service.cache_embedding("source".into(), embeddings("source"), 4);
                    assert_eq!(
                        service.embedding(&"source".to_string()).unwrap().path_hash,
                        "source"
                    );
                    assert_eq!(service.report().derived_caches.len(), 2);
                })
            })
            .collect();
        barrier.wait();
        for worker in workers {
            worker.join().unwrap();
        }

        service.cache_depth_map(
            "depth".into(),
            Arc::new(CachedDepthMap {
                depth_image: GrayImage::new(1, 1),
                original_size: (1, 1),
            }),
            1,
        );
        assert_eq!(
            service
                .depth_map(&"depth".to_string())
                .unwrap()
                .original_size,
            (1, 1)
        );
        let report = service.report();
        assert_eq!(report.derived_caches.len(), 2);
        assert_eq!(report.derived_caches[0].entries, 1);
        assert_eq!(report.derived_caches[1].entries, 1);
    }

    #[tokio::test]
    async fn cancellation_is_owned_by_the_runtime_service() {
        let service = service();
        let loading = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let registry = service.registry.clone();
        let loading_task = Arc::clone(&loading);
        let release_task = Arc::clone(&release);
        let waiter = tokio::spawn(async move {
            registry
                .acquire_with(AiModelId::Denoise, 1, move |context| async move {
                    loading_task.notify_one();
                    release_task.notified().await;
                    Err(if context.is_cancelled() {
                        "cancelled".to_string()
                    } else {
                        "not_cancelled".to_string()
                    })
                })
                .await
        });
        loading.notified().await;
        assert!(service.cancel_model_load(AiModelId::Denoise));
        release.notify_one();
        match waiter.await.unwrap() {
            Err(error) => assert_eq!(error, "cancelled"),
            Ok(_) => panic!("cancelled model load must not publish a session"),
        }
        assert!(!service.evict_model_session(AiModelId::Denoise));
    }
}
