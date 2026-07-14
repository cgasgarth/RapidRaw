//! Narrow service capabilities used by the application composition root.
//!
//! New commands should receive one of these handles instead of reaching into
//! `AppState`'s legacy fields. The registry owns operation currentness and
//! cancellation so callers cannot publish stale results through an unrelated
//! singleton slot.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct OperationId(u64);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum OperationState {
    Running,
    Cancelled,
    Completed,
}

#[derive(Default)]
struct OperationRegistry {
    next_id: AtomicU64,
    states: Mutex<HashMap<OperationId, OperationState>>,
}

impl OperationRegistry {
    fn begin(&self) -> OperationId {
        let id = OperationId(self.next_id.fetch_add(1, Ordering::Relaxed) + 1);
        self.states
            .lock()
            .expect("operation registry poisoned")
            .insert(id, OperationState::Running);
        id
    }

    fn transition(&self, id: OperationId, state: OperationState) -> bool {
        let mut states = self.states.lock().expect("operation registry poisoned");
        let Some(current) = states.get_mut(&id) else {
            return false;
        };
        if *current != OperationState::Running {
            return false;
        }
        *current = state;
        true
    }

    fn is_current(&self, id: OperationId) -> bool {
        self.states
            .lock()
            .expect("operation registry poisoned")
            .get(&id)
            == Some(&OperationState::Running)
    }
}

#[derive(Clone, Default)]
pub struct EditorRuntimeService {
    operations: Arc<OperationRegistry>,
}

impl EditorRuntimeService {
    pub fn begin_operation(&self) -> OperationId {
        self.operations.begin()
    }
    pub fn cancel(&self, id: OperationId) -> bool {
        self.operations.transition(id, OperationState::Cancelled)
    }
    pub fn complete(&self, id: OperationId) -> bool {
        self.operations.transition(id, OperationState::Completed)
    }
    pub fn is_current(&self, id: OperationId) -> bool {
        self.operations.is_current(id)
    }
}

#[derive(Clone, Default)]
pub struct JobCoordinator {
    operations: Arc<OperationRegistry>,
}

impl JobCoordinator {
    pub fn begin(&self) -> OperationId {
        self.operations.begin()
    }
    pub fn cancel(&self, id: OperationId) -> bool {
        self.operations.transition(id, OperationState::Cancelled)
    }
    pub fn complete(&self, id: OperationId) -> bool {
        self.operations.transition(id, OperationState::Completed)
    }
    pub fn is_current(&self, id: OperationId) -> bool {
        self.operations.is_current(id)
    }
}

#[derive(Clone, Default)]
pub struct AppServices {
    pub editor: Arc<EditorRuntimeService>,
    pub(crate) focus_stack:
        Arc<crate::merge::focus_stack::planning_service::FocusStackPlanningService>,
    pub jobs: Arc<JobCoordinator>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn operation_handles_reject_stale_completion_and_cancellation() {
        let service = EditorRuntimeService::default();
        let first = service.begin_operation();
        let second = service.begin_operation();
        assert!(service.is_current(first));
        assert!(service.cancel(first));
        assert!(!service.is_current(first));
        assert!(!service.complete(first));
        assert!(service.complete(second));
        assert!(!service.complete(second));
    }

    #[test]
    fn registry_is_safe_for_concurrent_begin_and_cancel() {
        let service = Arc::new(JobCoordinator::default());
        let handles: Vec<_> = (0..8)
            .map(|_| {
                let service = Arc::clone(&service);
                thread::spawn(move || {
                    let id = service.begin();
                    assert!(service.cancel(id));
                    assert!(!service.is_current(id));
                })
            })
            .collect();
        for handle in handles {
            handle.join().unwrap();
        }
    }
}
