use std::sync::Mutex;

#[derive(Default)]
struct StartupFileHandoffState {
    frontend_ready: bool,
    pending_path: Option<String>,
}

#[derive(Default)]
pub(crate) struct StartupFileHandoffService {
    state: Mutex<StartupFileHandoffState>,
}

impl StartupFileHandoffService {
    /// Publishes an open request. A returned path is ready for immediate event
    /// delivery; `None` means the request is retained until frontend startup.
    pub(crate) fn publish(&self, path: String) -> Option<String> {
        let mut state = self.state.lock().expect("startup file handoff poisoned");
        if state.frontend_ready {
            return Some(path);
        }
        state.pending_path = Some(path);
        None
    }

    /// Atomically activates event delivery and takes the last request queued
    /// before the frontend installed its listener.
    pub(crate) fn activate_frontend(&self) -> Option<String> {
        let mut state = self.state.lock().expect("startup file handoff poisoned");
        state.frontend_ready = true;
        state.pending_path.take()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};
    use std::thread;

    #[test]
    fn queued_request_is_delivered_once_when_frontend_activates() {
        let service = StartupFileHandoffService::default();
        assert_eq!(service.publish("first.raw".into()), None);
        assert_eq!(service.publish("latest.raw".into()), None);
        assert_eq!(service.activate_frontend().as_deref(), Some("latest.raw"));
        assert_eq!(service.activate_frontend(), None);
        assert_eq!(
            service.publish("late.raw".into()).as_deref(),
            Some("late.raw")
        );
    }

    #[test]
    fn concurrent_publish_and_activation_cannot_lose_or_duplicate_request() {
        let service = Arc::new(StartupFileHandoffService::default());
        let release = Arc::new(Barrier::new(3));
        let publisher = {
            let release = Arc::clone(&release);
            let service = Arc::clone(&service);
            thread::spawn(move || {
                release.wait();
                service.publish("race.raw".into())
            })
        };
        let activator = {
            let release = Arc::clone(&release);
            let service = Arc::clone(&service);
            thread::spawn(move || {
                release.wait();
                service.activate_frontend()
            })
        };

        release.wait();
        let immediate = publisher.join().unwrap();
        let queued = activator.join().unwrap();
        assert_eq!(
            usize::from(immediate.is_some()) + usize::from(queued.is_some()),
            1
        );
        assert_eq!(immediate.or(queued).as_deref(), Some("race.raw"));
    }
}
