use std::sync::{Arc, RwLock};

use super::lens_correction::LensDatabase;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct LensDatabaseLoadToken(u64);

#[derive(Default)]
struct LensDatabaseState {
    active_load: u64,
    database: Option<Arc<LensDatabase>>,
}

#[derive(Default)]
pub(crate) struct LensDatabaseService {
    state: RwLock<LensDatabaseState>,
}

impl LensDatabaseService {
    pub(crate) fn begin_load(&self) -> LensDatabaseLoadToken {
        let mut state = self.state.write().expect("lens database poisoned");
        state.active_load = state.active_load.wrapping_add(1);
        LensDatabaseLoadToken(state.active_load)
    }

    pub(crate) fn publish(&self, token: LensDatabaseLoadToken, database: LensDatabase) -> bool {
        let mut state = self.state.write().expect("lens database poisoned");
        if state.active_load != token.0 {
            return false;
        }
        state.database = Some(Arc::new(database));
        true
    }

    pub(crate) fn snapshot(&self) -> Option<Arc<LensDatabase>> {
        self.state
            .read()
            .expect("lens database poisoned")
            .database
            .clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lens_correction::Camera;
    use std::sync::{Arc, Barrier};
    use std::thread;

    fn database(marker: &str) -> LensDatabase {
        LensDatabase {
            cameras: vec![Camera {
                maker: Vec::new(),
                model: Vec::new(),
                mount: marker.to_string(),
                cropfactor: 1.0,
            }],
            lenses: Vec::new(),
        }
    }

    #[test]
    fn stale_a_load_cannot_replace_b_or_a_successor() {
        let service = LensDatabaseService::default();
        let old_a = service.begin_load();
        let _b = service.begin_load();
        let successor_a = service.begin_load();

        assert!(!service.publish(old_a, database("old-a")));
        assert!(service.publish(successor_a, database("successor-a")));
        assert_eq!(service.snapshot().unwrap().cameras[0].mount, "successor-a");
    }

    #[test]
    fn concurrent_old_reload_cannot_replace_current_database() {
        let service = Arc::new(LensDatabaseService::default());
        let old = service.begin_load();
        let release = Arc::new(Barrier::new(2));
        let worker = {
            let release = Arc::clone(&release);
            let service = Arc::clone(&service);
            thread::spawn(move || {
                release.wait();
                service.publish(old, database("old"))
            })
        };

        let current = service.begin_load();
        assert!(service.publish(current, database("current")));
        release.wait();
        assert!(!worker.join().unwrap());
        assert_eq!(service.snapshot().unwrap().cameras[0].mount, "current");
    }
}
