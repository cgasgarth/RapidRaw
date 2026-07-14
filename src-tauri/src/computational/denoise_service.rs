use std::path::Path;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use super::denoise_artifact::{
    EnhancedDenoiseArtifactStore, EnhancedDenoiseArtifactV1, EnhancedDenoiseBuildOutput,
    EnhancedDenoisePlanV1, PhysicalSourceRevision,
};

pub const STALE_DENOISE_OPERATION: &str = "denoise_operation_stale";
pub const DENOISE_OPERATION_ALREADY_EXECUTING: &str = "denoise_operation_already_executing";

#[derive(Clone, Debug, Eq, PartialEq)]
struct OperationIdentity {
    image_identity: Arc<str>,
    source_revision: PhysicalSourceRevision,
    plan_fingerprint: String,
    image_generation: u64,
    operation_generation: u64,
}

#[derive(Clone, Debug)]
pub struct DenoiseOperation {
    identity: OperationIdentity,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DenoiseOperationHandle {
    pub image_generation: u64,
    pub operation_generation: u64,
}

impl DenoiseOperation {
    pub fn handle(&self) -> DenoiseOperationHandle {
        DenoiseOperationHandle {
            image_generation: self.identity.image_generation,
            operation_generation: self.identity.operation_generation,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DenoiseCancelReceipt {
    pub cancelled: bool,
    pub image_generation: u64,
    pub operation_generation: Option<u64>,
}

#[derive(Clone)]
struct CurrentArtifact {
    identity: OperationIdentity,
    artifact: Arc<EnhancedDenoiseArtifactV1>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum OperationPhase {
    Prepared,
    Executing,
}

#[derive(Clone, Debug)]
struct ActiveOperation {
    identity: OperationIdentity,
    phase: OperationPhase,
}

#[derive(Default)]
struct RuntimeState {
    image_identity: Option<Arc<str>>,
    image_generation: u64,
    operation_generation: u64,
    active_operation: Option<ActiveOperation>,
    current_artifact: Option<CurrentArtifact>,
}

/// Owns Enhanced Denoise artifact/currentness state behind one narrow capability.
///
/// The runtime mutex is only held for short identity transitions. Artifact lookup,
/// disk I/O, decode, GPU work, event emission, and builders run outside this lock.
pub struct EnhancedDenoiseService {
    artifacts: EnhancedDenoiseArtifactStore,
    runtime: Mutex<RuntimeState>,
}

impl Default for EnhancedDenoiseService {
    fn default() -> Self {
        Self {
            artifacts: EnhancedDenoiseArtifactStore::default(),
            runtime: Mutex::new(RuntimeState::default()),
        }
    }
}

impl EnhancedDenoiseService {
    #[cfg(test)]
    fn with_store(artifacts: EnhancedDenoiseArtifactStore) -> Self {
        Self {
            artifacts,
            runtime: Mutex::new(RuntimeState::default()),
        }
    }

    /// Starts a new image generation and atomically cancels any prior operation/result.
    pub fn activate_image(&self, image_identity: &str) -> u64 {
        let mut runtime = self.runtime.lock().expect("denoise runtime poisoned");
        runtime.image_generation = runtime.image_generation.wrapping_add(1).max(1);
        runtime.image_identity = Some(Arc::from(image_identity));
        runtime.active_operation = None;
        runtime.current_artifact = None;
        runtime.image_generation
    }

    pub fn begin(
        &self,
        image_identity: &str,
        plan: &EnhancedDenoisePlanV1,
    ) -> Result<DenoiseOperation, String> {
        let plan_fingerprint = plan.fingerprint()?;
        let mut runtime = self.runtime.lock().expect("denoise runtime poisoned");
        if runtime.image_identity.as_deref() != Some(image_identity) {
            return Err("denoise_image_not_current".to_string());
        }
        runtime.operation_generation = runtime.operation_generation.wrapping_add(1).max(1);
        let identity = OperationIdentity {
            image_identity: Arc::from(image_identity),
            source_revision: plan.source_revision.clone(),
            plan_fingerprint,
            image_generation: runtime.image_generation,
            operation_generation: runtime.operation_generation,
        };
        runtime.active_operation = Some(ActiveOperation {
            identity: identity.clone(),
            phase: OperationPhase::Prepared,
        });
        runtime.current_artifact = None;
        Ok(DenoiseOperation { identity })
    }

    pub fn resume(
        &self,
        expected: DenoiseOperationHandle,
        image_identity: &str,
        plan: &EnhancedDenoisePlanV1,
    ) -> Result<DenoiseOperation, String> {
        let plan_fingerprint = plan.fingerprint()?;
        let mut runtime = self.runtime.lock().expect("denoise runtime poisoned");
        let active = runtime
            .active_operation
            .as_mut()
            .ok_or_else(|| STALE_DENOISE_OPERATION.to_string())?;
        if operation_handle(&active.identity) != expected
            || active.identity.image_identity.as_ref() != image_identity
            || active.identity.source_revision != plan.source_revision
            || active.identity.plan_fingerprint != plan_fingerprint
        {
            return Err(STALE_DENOISE_OPERATION.to_string());
        }
        if active.phase == OperationPhase::Executing {
            return Err(DENOISE_OPERATION_ALREADY_EXECUTING.to_string());
        }
        active.phase = OperationPhase::Executing;
        Ok(DenoiseOperation {
            identity: active.identity.clone(),
        })
    }

    pub fn build_current<F>(
        &self,
        operation: &DenoiseOperation,
        cache_root: &Path,
        plan: EnhancedDenoisePlanV1,
        build: F,
    ) -> Result<Arc<EnhancedDenoiseArtifactV1>, String>
    where
        F: FnOnce() -> Result<EnhancedDenoiseBuildOutput, String>,
    {
        if plan.source_revision != operation.identity.source_revision
            || plan.fingerprint()? != operation.identity.plan_fingerprint
            || !self.is_executing(operation)
        {
            return Err(STALE_DENOISE_OPERATION.to_string());
        }

        let artifact = match self.artifacts.get_or_build(cache_root, plan, build) {
            Ok(artifact) => artifact,
            Err(_) if !self.is_current(operation) => {
                return Err(STALE_DENOISE_OPERATION.to_string());
            }
            Err(error) => return Err(error),
        };
        let mut runtime = self.runtime.lock().expect("denoise runtime poisoned");
        if !runtime.active_operation.as_ref().is_some_and(|active| {
            active.identity == operation.identity && active.phase == OperationPhase::Executing
        }) || artifact.manifest.plan.source_revision != operation.identity.source_revision
            || artifact.manifest.plan_fingerprint != operation.identity.plan_fingerprint
        {
            return Err(STALE_DENOISE_OPERATION.to_string());
        }
        runtime.current_artifact = Some(CurrentArtifact {
            identity: operation.identity.clone(),
            artifact: Arc::clone(&artifact),
        });
        Ok(artifact)
    }

    /// Batch operations share the verified cache but never mutate editor-current state.
    pub fn get_or_build_cached<F>(
        &self,
        cache_root: &Path,
        plan: EnhancedDenoisePlanV1,
        build: F,
    ) -> Result<Arc<EnhancedDenoiseArtifactV1>, String>
    where
        F: FnOnce() -> Result<EnhancedDenoiseBuildOutput, String>,
    {
        self.artifacts.get_or_build(cache_root, plan, build)
    }

    pub fn current_artifact(
        &self,
        image_identity: &str,
        source_revision: &PhysicalSourceRevision,
    ) -> Option<Arc<EnhancedDenoiseArtifactV1>> {
        let runtime = self.runtime.lock().expect("denoise runtime poisoned");
        let current = runtime.current_artifact.as_ref()?;
        (runtime.image_identity.as_deref() == Some(image_identity)
            && current.identity.image_identity.as_ref() == image_identity
            && &current.identity.source_revision == source_revision)
            .then(|| Arc::clone(&current.artifact))
    }

    pub fn cancel(&self, expected: DenoiseOperationHandle) -> DenoiseCancelReceipt {
        let mut runtime = self.runtime.lock().expect("denoise runtime poisoned");
        let active_matches = runtime
            .active_operation
            .as_ref()
            .is_some_and(|operation| operation_handle(&operation.identity) == expected);
        let current_matches = runtime
            .current_artifact
            .as_ref()
            .is_some_and(|current| operation_handle(&current.identity) == expected);
        let cancelled = active_matches || current_matches;
        if active_matches {
            runtime.active_operation = None;
        }
        if current_matches {
            runtime.current_artifact = None;
        }
        DenoiseCancelReceipt {
            cancelled,
            image_generation: runtime.image_generation,
            operation_generation: cancelled.then_some(expected.operation_generation),
        }
    }

    pub fn finish(&self, operation: &DenoiseOperation) -> bool {
        let mut runtime = self.runtime.lock().expect("denoise runtime poisoned");
        if runtime
            .active_operation
            .as_ref()
            .map(|active| &active.identity)
            != Some(&operation.identity)
        {
            return false;
        }
        runtime.active_operation = None;
        true
    }

    pub(crate) fn is_current(&self, operation: &DenoiseOperation) -> bool {
        self.runtime
            .lock()
            .expect("denoise runtime poisoned")
            .active_operation
            .as_ref()
            .map(|active| &active.identity)
            == Some(&operation.identity)
    }

    fn is_executing(&self, operation: &DenoiseOperation) -> bool {
        self.runtime
            .lock()
            .expect("denoise runtime poisoned")
            .active_operation
            .as_ref()
            .is_some_and(|active| {
                active.identity == operation.identity && active.phase == OperationPhase::Executing
            })
    }
}

fn operation_handle(identity: &OperationIdentity) -> DenoiseOperationHandle {
    DenoiseOperationHandle {
        image_generation: identity.image_generation,
        operation_generation: identity.operation_generation,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, ImageBuffer, Rgb};
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Barrier, mpsc};
    use std::thread;
    use std::time::Duration;

    fn fixture_plan(root: &Path, intensity: f32) -> EnhancedDenoisePlanV1 {
        let source = root.join("source.raw");
        if !source.exists() {
            fs::write(&source, b"physical source").unwrap();
        }
        EnhancedDenoisePlanV1::legacy_adapter(&source, "bm3d", intensity).unwrap()
    }

    fn fixture_output(value: f32) -> EnhancedDenoiseBuildOutput {
        let image = DynamicImage::ImageRgb32F(ImageBuffer::from_pixel(
            3,
            2,
            Rgb([value, value + 0.1, value + 0.2]),
        ));
        EnhancedDenoiseBuildOutput {
            input_range: super::super::denoise_artifact::SceneRangeCounts::measure(
                &image.to_rgb32f(),
            ),
            image,
        }
    }

    #[test]
    fn newer_concurrent_operation_is_the_only_completion_that_becomes_current() {
        let temp = tempfile::tempdir().unwrap();
        let cache = temp.path().join("cache");
        let plan = fixture_plan(temp.path(), 0.4);
        let service = Arc::new(EnhancedDenoiseService::with_store(
            EnhancedDenoiseArtifactStore::new(1024 * 1024),
        ));
        service.activate_image("image-a?vc=one");
        let prepared = service.begin("image-a?vc=one", &plan).unwrap();
        let first = service
            .resume(prepared.handle(), "image-a?vc=one", &plan)
            .unwrap();
        let entered = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let builds = Arc::new(AtomicUsize::new(0));
        let first_thread = {
            let service = Arc::clone(&service);
            let plan = plan.clone();
            let cache = cache.clone();
            let entered = Arc::clone(&entered);
            let release = Arc::clone(&release);
            let builds = Arc::clone(&builds);
            thread::spawn(move || {
                service.build_current(&first, &cache, plan, || {
                    builds.fetch_add(1, Ordering::SeqCst);
                    entered.wait();
                    release.wait();
                    Ok(fixture_output(0.3))
                })
            })
        };
        entered.wait();
        let prepared = service.begin("image-a?vc=one", &plan).unwrap();
        let second = service
            .resume(prepared.handle(), "image-a?vc=one", &plan)
            .unwrap();
        let second_thread = {
            let service = Arc::clone(&service);
            let plan = plan.clone();
            thread::spawn(move || {
                service.build_current(&second, &cache, plan, || Ok(fixture_output(0.9)))
            })
        };
        release.wait();

        assert!(matches!(
            first_thread.join().unwrap(),
            Err(error) if error == STALE_DENOISE_OPERATION
        ));
        let current = second_thread.join().unwrap().unwrap();
        assert_eq!(builds.load(Ordering::SeqCst), 1);
        assert!(Arc::ptr_eq(
            &current,
            &service
                .current_artifact("image-a?vc=one", &plan.source_revision)
                .unwrap()
        ));
    }

    #[test]
    fn image_change_cancels_work_without_holding_runtime_lock_across_builder() {
        let temp = tempfile::tempdir().unwrap();
        let plan = fixture_plan(temp.path(), 0.4);
        let service = EnhancedDenoiseService::default();
        service.activate_image("image-a");
        let prepared = service.begin("image-a", &plan).unwrap();
        let operation = service.resume(prepared.handle(), "image-a", &plan).unwrap();
        let result =
            service.build_current(&operation, &temp.path().join("cache"), plan.clone(), || {
                service.activate_image("image-b");
                Ok(fixture_output(0.5))
            });
        assert!(matches!(
            result,
            Err(error) if error == STALE_DENOISE_OPERATION
        ));
        assert!(
            service
                .current_artifact("image-a", &plan.source_revision)
                .is_none()
        );
    }

    #[test]
    fn cancellation_unblocks_without_waiting_for_disk_or_decode_work() {
        let temp = tempfile::tempdir().unwrap();
        let plan = fixture_plan(temp.path(), 0.4);
        let service = Arc::new(EnhancedDenoiseService::default());
        service.activate_image("image-a");
        let prepared = service.begin("image-a", &plan).unwrap();
        let operation = service.resume(prepared.handle(), "image-a", &plan).unwrap();
        let operation_handle = operation.handle();
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let worker = {
            let service = Arc::clone(&service);
            let cache = temp.path().join("cache");
            let plan = plan.clone();
            thread::spawn(move || {
                service.build_current(&operation, &cache, plan, || {
                    entered_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                    Err("decode_failed_after_cancel".to_string())
                })
            })
        };
        entered_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        let receipt = service.cancel(operation_handle);
        assert!(receipt.cancelled);
        assert_eq!(receipt.operation_generation, Some(1));
        release_tx.send(()).unwrap();
        assert!(matches!(
            worker.join().unwrap(),
            Err(error) if error == STALE_DENOISE_OPERATION
        ));
        assert!(
            service
                .current_artifact("image-a", &plan.source_revision)
                .is_none()
        );

        let prepared = service.begin("image-a", &plan).unwrap();
        let next = service.resume(prepared.handle(), "image-a", &plan).unwrap();
        let artifact = service
            .build_current(&next, &temp.path().join("cache"), plan.clone(), || {
                Ok(fixture_output(0.7))
            })
            .unwrap();
        assert!(
            service
                .current_artifact("image-a", &plan.source_revision)
                .is_some()
        );
        assert_eq!(artifact.image.to_rgb32f().get_pixel(0, 0)[0], 0.7);
    }

    #[test]
    fn delayed_cancel_for_old_handle_cannot_cancel_successor() {
        let temp = tempfile::tempdir().unwrap();
        let plan = fixture_plan(temp.path(), 0.4);
        let service = EnhancedDenoiseService::default();
        service.activate_image("image-a");
        let first = service.begin("image-a", &plan).unwrap().handle();
        assert!(service.cancel(first).cancelled);
        let second = service.begin("image-a", &plan).unwrap().handle();

        assert!(!service.cancel(first).cancelled);
        let operation = service.resume(second, "image-a", &plan).unwrap();
        service
            .build_current(&operation, &temp.path().join("cache"), plan.clone(), || {
                Ok(fixture_output(0.8))
            })
            .unwrap();
        assert!(
            service
                .current_artifact("image-a", &plan.source_revision)
                .is_some()
        );
    }

    #[test]
    fn prepared_handle_cannot_build_and_failed_execute_cleanup_allows_successor() {
        let temp = tempfile::tempdir().unwrap();
        let plan = fixture_plan(temp.path(), 0.4);
        let service = EnhancedDenoiseService::default();
        service.activate_image("image-a");
        let prepared = service.begin("image-a", &plan).unwrap();
        let builds = AtomicUsize::new(0);
        assert!(matches!(
            service.build_current(
                &prepared,
                &temp.path().join("cache"),
                plan.clone(),
                || {
                    builds.fetch_add(1, Ordering::SeqCst);
                    Ok(fixture_output(0.2))
                },
            ),
            Err(error) if error == STALE_DENOISE_OPERATION
        ));
        assert_eq!(builds.load(Ordering::SeqCst), 0);
        assert!(service.cancel(prepared.handle()).cancelled);
        assert!(
            service
                .current_artifact("image-a", &plan.source_revision)
                .is_none()
        );

        let successor = service.begin("image-a", &plan).unwrap();
        let successor = service
            .resume(successor.handle(), "image-a", &plan)
            .unwrap();
        service
            .build_current(&successor, &temp.path().join("cache"), plan.clone(), || {
                Ok(fixture_output(0.9))
            })
            .unwrap();
        assert!(
            service
                .current_artifact("image-a", &plan.source_revision)
                .is_some()
        );
    }

    #[test]
    fn cancel_between_artifact_build_and_completion_event_revokes_save_authority() {
        let temp = tempfile::tempdir().unwrap();
        let plan = fixture_plan(temp.path(), 0.4);
        let service = EnhancedDenoiseService::default();
        service.activate_image("image-a");
        let prepared = service.begin("image-a", &plan).unwrap();
        let handle = prepared.handle();
        let operation = service.resume(handle, "image-a", &plan).unwrap();
        service
            .build_current(&operation, &temp.path().join("cache"), plan.clone(), || {
                Ok(fixture_output(0.4))
            })
            .unwrap();
        assert!(
            service
                .current_artifact("image-a", &plan.source_revision)
                .is_some()
        );

        assert!(service.cancel(handle).cancelled);
        assert!(!service.finish(&operation));
        assert!(
            service
                .current_artifact("image-a", &plan.source_revision)
                .is_none()
        );
    }

    #[test]
    fn verified_artifact_reopens_through_a_fresh_service_and_exact_identity() {
        let temp = tempfile::tempdir().unwrap();
        let cache = temp.path().join("cache");
        let plan = fixture_plan(temp.path(), 0.4);
        let first = EnhancedDenoiseService::with_store(EnhancedDenoiseArtifactStore::new(1));
        first.activate_image("image-a?vc=one");
        let prepared = first.begin("image-a?vc=one", &plan).unwrap();
        let operation = first
            .resume(prepared.handle(), "image-a?vc=one", &plan)
            .unwrap();
        first
            .build_current(&operation, &cache, plan.clone(), || Ok(fixture_output(0.5)))
            .unwrap();

        let reopened = EnhancedDenoiseService::default();
        reopened.activate_image("image-a?vc=one");
        let prepared = reopened.begin("image-a?vc=one", &plan).unwrap();
        let operation = reopened
            .resume(prepared.handle(), "image-a?vc=one", &plan)
            .unwrap();
        let builds = AtomicUsize::new(0);
        let artifact = reopened
            .build_current(&operation, &cache, plan.clone(), || {
                builds.fetch_add(1, Ordering::SeqCst);
                Ok(fixture_output(0.9))
            })
            .unwrap();
        assert_eq!(builds.load(Ordering::SeqCst), 0);
        assert!(
            reopened
                .current_artifact("image-a?vc=two", &plan.source_revision)
                .is_none()
        );
        assert_eq!(artifact.image.to_rgb32f().get_pixel(0, 0)[0], 0.5);
    }

    #[test]
    fn concurrent_duplicate_execute_claim_runs_exactly_one_builder() {
        let temp = tempfile::tempdir().unwrap();
        let cache = temp.path().join("cache");
        let plan = fixture_plan(temp.path(), 0.4);
        let service = Arc::new(EnhancedDenoiseService::default());
        service.activate_image("image-a");
        let handle = service.begin("image-a", &plan).unwrap().handle();
        let start = Arc::new(Barrier::new(3));
        let build_release = Arc::new(Barrier::new(2));
        let builds = Arc::new(AtomicUsize::new(0));
        let (result_tx, result_rx) = mpsc::channel();
        let workers: Vec<_> = (0..2)
            .map(|_| {
                let service = Arc::clone(&service);
                let plan = plan.clone();
                let cache = cache.clone();
                let start = Arc::clone(&start);
                let build_release = Arc::clone(&build_release);
                let builds = Arc::clone(&builds);
                let result_tx = result_tx.clone();
                thread::spawn(move || {
                    start.wait();
                    match service.resume(handle, "image-a", &plan) {
                        Ok(operation) => {
                            result_tx.send("claimed".to_string()).unwrap();
                            build_release.wait();
                            service
                                .build_current(&operation, &cache, plan, || {
                                    builds.fetch_add(1, Ordering::SeqCst);
                                    Ok(fixture_output(0.6))
                                })
                                .unwrap();
                        }
                        Err(error) => result_tx.send(error).unwrap(),
                    }
                })
            })
            .collect();
        drop(result_tx);
        start.wait();
        let first = result_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        let second = result_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!(
            [first.as_str(), second.as_str()]
                .into_iter()
                .filter(|value| *value == "claimed")
                .count(),
            1
        );
        assert!([first.as_str(), second.as_str()].contains(&DENOISE_OPERATION_ALREADY_EXECUTING));
        build_release.wait();
        for worker in workers {
            worker.join().unwrap();
        }
        assert_eq!(builds.load(Ordering::SeqCst), 1);
    }
}
