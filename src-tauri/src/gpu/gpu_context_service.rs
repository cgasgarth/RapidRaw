//! Atomic ownership for the process GPU context and display-target coordinator.
//!
//! Adapter/device discovery and pipeline cache setup happen outside the service
//! mutex. Epoch-scoped publication prevents reset from being followed by a late
//! context install.

use std::sync::{Arc, Condvar, Mutex};

use crate::app::display_target::DisplayTargetCoordinator;
use crate::image_processing::GpuContext;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ContextPublication {
    epoch: u64,
    generation: u64,
}

struct ContextState<C, D> {
    epoch: u64,
    publication_generation: u64,
    context: Option<C>,
    coordinator: Option<Arc<D>>,
}

impl<C, D> Default for ContextState<C, D> {
    fn default() -> Self {
        Self {
            epoch: 0,
            publication_generation: 0,
            context: None,
            coordinator: None,
        }
    }
}

struct GpuContextServiceCore<C, D> {
    state: Mutex<ContextState<C, D>>,
}

impl<C, D> Default for GpuContextServiceCore<C, D> {
    fn default() -> Self {
        Self {
            state: Mutex::new(ContextState::default()),
        }
    }
}

impl<C: Clone, D> GpuContextServiceCore<C, D> {
    fn context_snapshot(&self) -> Option<C> {
        self.state
            .lock()
            .expect("GPU context state poisoned")
            .context
            .clone()
    }

    fn coordinator_snapshot(&self) -> Option<Arc<D>> {
        self.state
            .lock()
            .expect("GPU context state poisoned")
            .coordinator
            .clone()
    }

    fn begin_context_publication(&self) -> ContextPublication {
        let mut state = self.state.lock().expect("GPU context state poisoned");
        state.publication_generation = next_generation(state.publication_generation);
        ContextPublication {
            epoch: state.epoch,
            generation: state.publication_generation,
        }
    }

    fn publish_context(&self, token: ContextPublication, context: C) -> Option<Option<Arc<D>>> {
        let mut state = self.state.lock().expect("GPU context state poisoned");
        if state.epoch != token.epoch || state.publication_generation != token.generation {
            return None;
        }
        state.context = Some(context);
        Some(state.coordinator.clone())
    }

    #[cfg(any(test, target_os = "macos", feature = "validation-harness"))]
    fn install_coordinator(&self, coordinator: Arc<D>) -> Option<C> {
        let mut state = self.state.lock().expect("GPU context state poisoned");
        state.coordinator = Some(coordinator);
        state.context.clone()
    }

    #[cfg(test)]
    fn reset_context(&self) {
        let mut state = self.state.lock().expect("GPU context state poisoned");
        state.epoch = next_generation(state.epoch);
        state.publication_generation = next_generation(state.publication_generation);
        state.context = None;
    }
}

fn next_generation(current: u64) -> u64 {
    current
        .checked_add(1)
        .expect("GPU context generation exhausted")
}

pub(crate) struct GpuContextService {
    core: GpuContextServiceCore<GpuContext, DisplayTargetCoordinator>,
    initialization_active: Mutex<bool>,
    initialization_ready: Condvar,
}

impl Default for GpuContextService {
    fn default() -> Self {
        Self {
            core: GpuContextServiceCore::default(),
            initialization_active: Mutex::new(false),
            initialization_ready: Condvar::new(),
        }
    }
}

pub(crate) struct ContextInitializationPermit<'a> {
    service: &'a GpuContextService,
}

impl Drop for ContextInitializationPermit<'_> {
    fn drop(&mut self) {
        let mut active = self
            .service
            .initialization_active
            .lock()
            .expect("GPU context initialization gate poisoned");
        *active = false;
        self.service.initialization_ready.notify_all();
    }
}

impl GpuContextService {
    pub(crate) fn context_snapshot(&self) -> Option<GpuContext> {
        self.core.context_snapshot()
    }

    pub(crate) fn coordinator_snapshot(&self) -> Option<Arc<DisplayTargetCoordinator>> {
        self.core.coordinator_snapshot()
    }

    pub(crate) fn acquire_initialization(&self) -> ContextInitializationPermit<'_> {
        let active = self
            .initialization_active
            .lock()
            .expect("GPU context initialization gate poisoned");
        let mut active = self
            .initialization_ready
            .wait_while(active, |active| *active)
            .expect("GPU context initialization gate poisoned");
        *active = true;
        drop(active);
        ContextInitializationPermit { service: self }
    }

    pub(crate) fn begin_context_publication(&self) -> ContextPublication {
        self.core.begin_context_publication()
    }

    pub(crate) fn publish_context(
        &self,
        token: ContextPublication,
        context: GpuContext,
    ) -> Option<Option<Arc<DisplayTargetCoordinator>>> {
        self.core.publish_context(token, context)
    }

    #[cfg(any(target_os = "macos", feature = "validation-harness"))]
    pub(crate) fn install_coordinator(
        &self,
        coordinator: Arc<DisplayTargetCoordinator>,
    ) -> Option<GpuContext> {
        self.core.install_coordinator(coordinator)
    }

    #[cfg(test)]
    pub(crate) fn reset_context(&self) {
        self.core.reset_context();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Barrier, mpsc};
    use std::thread;
    use std::time::Duration;

    #[test]
    fn reset_rejects_late_context_and_successor_wins() {
        let service = Arc::new(GpuContextServiceCore::<String, String>::default());
        let stale = service.begin_context_publication();
        let barrier = Arc::new(Barrier::new(2));
        let late_service = Arc::clone(&service);
        let late_barrier = Arc::clone(&barrier);
        let late = thread::spawn(move || {
            late_barrier.wait();
            late_service
                .publish_context(stale, "stale".into())
                .is_some()
        });

        service.reset_context();
        let current = service.begin_context_publication();
        assert!(service.publish_context(current, "current".into()).is_some());
        barrier.wait();
        assert!(!late.join().unwrap());
        assert_eq!(service.context_snapshot().as_deref(), Some("current"));
    }

    #[test]
    fn coordinator_install_and_context_publication_observe_each_other() {
        let service = GpuContextServiceCore::<u64, String>::default();
        let coordinator = Arc::new("display".to_string());
        assert!(
            service
                .install_coordinator(Arc::clone(&coordinator))
                .is_none()
        );
        let token = service.begin_context_publication();
        let published_coordinator = service.publish_context(token, 42).unwrap().unwrap();
        assert!(Arc::ptr_eq(&coordinator, &published_coordinator));
        assert_eq!(
            service.install_coordinator(Arc::new("successor".into())),
            Some(42)
        );
    }

    #[test]
    fn reset_proceeds_while_initialization_permit_is_held() {
        let service = Arc::new(GpuContextService::default());
        let permit = service.acquire_initialization();
        let (reset_tx, reset_rx) = mpsc::channel();
        let reset_service = Arc::clone(&service);
        let reset = thread::spawn(move || {
            reset_service.reset_context();
            reset_tx.send(()).unwrap();
        });

        reset_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("reset does not wait on the initialization coordination mutex");
        assert!(service.context_snapshot().is_none());
        drop(permit);
        reset.join().unwrap();
    }
}
