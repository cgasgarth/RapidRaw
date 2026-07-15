//! Ownership and currentness for reusable GPU render resources.
//!
//! The service lock is used only to clone or publish `Arc` snapshots. Expensive
//! processor construction, texture upload, command encoding, submission, and
//! readback happen after the lock has been released.

use std::sync::{Arc, Condvar, Mutex};

use crate::gpu_processing::{GpuInputCacheCounters, GpuProcessor, PreGpuImageIdentity};

pub(crate) struct GpuImageCache {
    pub(crate) _texture: wgpu::Texture,
    pub(crate) texture_view: wgpu::TextureView,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) pre_gpu_identity: PreGpuImageIdentity,
    pub(crate) device_generation: u64,
}

pub(crate) struct GpuProcessorState {
    pub(crate) processor: GpuProcessor,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct GpuRenderLease {
    epoch: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ProcessorPublication {
    epoch: u64,
    generation: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct InputPublication {
    epoch: u64,
    generation: u64,
}

struct ResourceSlot<T> {
    generation: u64,
    value: Option<Arc<T>>,
}

impl<T> Default for ResourceSlot<T> {
    fn default() -> Self {
        Self {
            generation: 0,
            value: None,
        }
    }
}

struct GpuProcessingState<P, I> {
    epoch: u64,
    processor: ResourceSlot<P>,
    input: ResourceSlot<I>,
}

impl<P, I> Default for GpuProcessingState<P, I> {
    fn default() -> Self {
        Self {
            epoch: 0,
            processor: ResourceSlot::default(),
            input: ResourceSlot::default(),
        }
    }
}

struct GpuProcessingServiceCore<P, I> {
    state: Mutex<GpuProcessingState<P, I>>,
}

impl<P, I> Default for GpuProcessingServiceCore<P, I> {
    fn default() -> Self {
        Self {
            state: Mutex::new(GpuProcessingState::default()),
        }
    }
}

impl<P, I> GpuProcessingServiceCore<P, I> {
    fn begin_render(&self) -> GpuRenderLease {
        let state = self.state.lock().expect("GPU processing state poisoned");
        GpuRenderLease { epoch: state.epoch }
    }

    fn is_current(&self, lease: GpuRenderLease) -> bool {
        self.state
            .lock()
            .expect("GPU processing state poisoned")
            .epoch
            == lease.epoch
    }

    fn processor_snapshot(&self, lease: GpuRenderLease) -> Option<Arc<P>> {
        let state = self.state.lock().expect("GPU processing state poisoned");
        (state.epoch == lease.epoch)
            .then(|| state.processor.value.clone())
            .flatten()
    }

    #[cfg(any(feature = "tauri-test", feature = "validation-harness"))]
    fn current_processor_snapshot(&self) -> Option<Arc<P>> {
        self.state
            .lock()
            .expect("GPU processing state poisoned")
            .processor
            .value
            .clone()
    }

    fn begin_processor_publication(&self, lease: GpuRenderLease) -> Option<ProcessorPublication> {
        let mut state = self.state.lock().expect("GPU processing state poisoned");
        if state.epoch != lease.epoch {
            return None;
        }
        state.processor.generation = next_generation(state.processor.generation);
        Some(ProcessorPublication {
            epoch: state.epoch,
            generation: state.processor.generation,
        })
    }

    fn publish_processor(&self, token: ProcessorPublication, value: Arc<P>) -> bool {
        let mut state = self.state.lock().expect("GPU processing state poisoned");
        if state.epoch != token.epoch || state.processor.generation != token.generation {
            return false;
        }
        state.processor.value = Some(value);
        true
    }

    fn input_snapshot(&self, lease: GpuRenderLease) -> Option<Arc<I>> {
        let state = self.state.lock().expect("GPU processing state poisoned");
        (state.epoch == lease.epoch)
            .then(|| state.input.value.clone())
            .flatten()
    }

    fn begin_input_publication(&self, lease: GpuRenderLease) -> Option<InputPublication> {
        let mut state = self.state.lock().expect("GPU processing state poisoned");
        if state.epoch != lease.epoch {
            return None;
        }
        state.input.generation = next_generation(state.input.generation);
        Some(InputPublication {
            epoch: state.epoch,
            generation: state.input.generation,
        })
    }

    fn publish_input(&self, token: InputPublication, value: Arc<I>) -> bool {
        let mut state = self.state.lock().expect("GPU processing state poisoned");
        if state.epoch != token.epoch || state.input.generation != token.generation {
            return false;
        }
        state.input.value = Some(value);
        true
    }

    fn clear_input(&self) {
        let mut state = self.state.lock().expect("GPU processing state poisoned");
        state.epoch = next_generation(state.epoch);
        state.input.generation = next_generation(state.input.generation);
        state.input.value = None;
    }

    #[cfg(feature = "tauri-test")]
    fn clear_processor(&self) {
        let mut state = self.state.lock().expect("GPU processing state poisoned");
        state.epoch = next_generation(state.epoch);
        state.processor.generation = next_generation(state.processor.generation);
        state.processor.value = None;
    }

    #[cfg(test)]
    fn clear_all(&self) {
        let mut state = self.state.lock().expect("GPU processing state poisoned");
        state.epoch = next_generation(state.epoch);
        state.processor.generation = next_generation(state.processor.generation);
        state.processor.value = None;
        state.input.generation = next_generation(state.input.generation);
        state.input.value = None;
    }
}

fn next_generation(current: u64) -> u64 {
    current
        .checked_add(1)
        .expect("GPU processing generation exhausted")
}

pub(crate) struct GpuProcessingService {
    core: GpuProcessingServiceCore<GpuProcessorState, GpuImageCache>,
    counters: Mutex<GpuInputCacheCounters>,
    execution_active: Mutex<bool>,
    execution_ready: Condvar,
}

impl Default for GpuProcessingService {
    fn default() -> Self {
        Self {
            core: GpuProcessingServiceCore::default(),
            counters: Mutex::new(GpuInputCacheCounters::default()),
            execution_active: Mutex::new(false),
            execution_ready: Condvar::new(),
        }
    }
}

pub(crate) struct GpuRenderPermit<'a> {
    service: &'a GpuProcessingService,
    lease: GpuRenderLease,
}

impl GpuRenderPermit<'_> {
    pub(crate) fn lease(&self) -> GpuRenderLease {
        self.lease
    }
}

impl Drop for GpuRenderPermit<'_> {
    fn drop(&mut self) {
        let mut active = self
            .service
            .execution_active
            .lock()
            .expect("GPU execution gate poisoned");
        *active = false;
        self.service.execution_ready.notify_one();
    }
}

impl GpuProcessingService {
    pub(crate) fn acquire_render(&self) -> GpuRenderPermit<'_> {
        let active = self
            .execution_active
            .lock()
            .expect("GPU execution gate poisoned");
        let mut active = self
            .execution_ready
            .wait_while(active, |active| *active)
            .expect("GPU execution gate poisoned");
        *active = true;
        drop(active);
        GpuRenderPermit {
            service: self,
            lease: self.core.begin_render(),
        }
    }

    pub(crate) fn is_current(&self, lease: GpuRenderLease) -> bool {
        self.core.is_current(lease)
    }

    pub(crate) fn processor_snapshot(
        &self,
        lease: GpuRenderLease,
    ) -> Option<Arc<GpuProcessorState>> {
        self.core.processor_snapshot(lease)
    }

    #[cfg(any(feature = "tauri-test", feature = "validation-harness"))]
    pub(crate) fn current_processor_snapshot(&self) -> Option<Arc<GpuProcessorState>> {
        self.core.current_processor_snapshot()
    }

    pub(crate) fn begin_processor_publication(
        &self,
        lease: GpuRenderLease,
    ) -> Option<ProcessorPublication> {
        self.core.begin_processor_publication(lease)
    }

    pub(crate) fn publish_processor(
        &self,
        token: ProcessorPublication,
        value: Arc<GpuProcessorState>,
    ) -> bool {
        self.core.publish_processor(token, value)
    }

    pub(crate) fn input_snapshot(&self, lease: GpuRenderLease) -> Option<Arc<GpuImageCache>> {
        self.core.input_snapshot(lease)
    }

    pub(crate) fn begin_input_publication(
        &self,
        lease: GpuRenderLease,
    ) -> Option<InputPublication> {
        self.core.begin_input_publication(lease)
    }

    pub(crate) fn publish_input(&self, token: InputPublication, value: Arc<GpuImageCache>) -> bool {
        self.core.publish_input(token, value)
    }

    #[cfg(test)]
    pub(crate) fn counters(&self) -> GpuInputCacheCounters {
        *self.counters.lock().expect("GPU input counters poisoned")
    }

    pub(crate) fn update_counters(&self, update: impl FnOnce(&mut GpuInputCacheCounters)) {
        update(&mut self.counters.lock().expect("GPU input counters poisoned"));
    }

    pub(crate) fn clear_input(&self) {
        self.core.clear_input();
    }

    #[cfg(feature = "tauri-test")]
    pub(crate) fn clear_processor(&self) {
        self.core.clear_processor();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Barrier, mpsc};
    use std::thread;
    use std::time::Duration;

    #[test]
    fn reset_rejects_late_processor_and_successor_wins() {
        let service = Arc::new(GpuProcessingServiceCore::<String, String>::default());
        let stale_lease = service.begin_render();
        let stale_token = service.begin_processor_publication(stale_lease).unwrap();
        let barrier = Arc::new(Barrier::new(2));
        let late_service = Arc::clone(&service);
        let late_barrier = Arc::clone(&barrier);
        let late = thread::spawn(move || {
            late_barrier.wait();
            late_service.publish_processor(stale_token, Arc::new("stale".into()))
        });

        service.clear_all();
        let current_lease = service.begin_render();
        let current_token = service.begin_processor_publication(current_lease).unwrap();
        assert!(service.publish_processor(current_token, Arc::new("current".into())));
        barrier.wait();
        assert!(!late.join().unwrap());
        assert_eq!(
            service.processor_snapshot(current_lease).unwrap().as_str(),
            "current"
        );
        assert!(!service.is_current(stale_lease));
    }

    #[test]
    fn input_clear_does_not_hold_service_lock_across_candidate_work() {
        let service = Arc::new(GpuProcessingServiceCore::<String, String>::default());
        let lease = service.begin_render();
        let token = service.begin_input_publication(lease).unwrap();
        let (cleared_tx, cleared_rx) = mpsc::channel();
        let clear_service = Arc::clone(&service);
        let clear = thread::spawn(move || {
            clear_service.clear_input();
            cleared_tx.send(()).unwrap();
        });

        cleared_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("clear proceeds while candidate work is outside the service lock");
        assert!(!service.publish_input(token, Arc::new("stale input".into())));
        assert!(!service.is_current(lease));
        clear.join().unwrap();
    }

    #[test]
    fn reset_proceeds_while_execution_permit_is_held() {
        let service = Arc::new(GpuProcessingService::default());
        let permit = service.acquire_render();
        let lease = permit.lease();
        let (cleared_tx, cleared_rx) = mpsc::channel();
        let reset_service = Arc::clone(&service);
        let reset = thread::spawn(move || {
            reset_service.clear_input();
            cleared_tx.send(()).unwrap();
        });

        cleared_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("reset does not wait for GPU execution to release a mutex guard");
        assert!(!service.is_current(lease));
        drop(permit);
        reset.join().unwrap();
    }
}
