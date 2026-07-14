use std::sync::{
    Arc, Mutex, Weak,
    atomic::{AtomicBool, Ordering},
};

#[derive(Clone, Debug, Eq, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportJobAuthority {
    pub generation: u64,
    pub job_id: String,
}

pub(crate) struct ImportJobStart {
    pub authority: ImportJobAuthority,
    pub cancellation: Arc<AtomicBool>,
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportJobStatus {
    pub authority: ImportJobAuthority,
    pub cancelled: bool,
}

pub(crate) struct ImportResumeReservation {
    authority: ImportJobAuthority,
    service: Weak<ImportJobService>,
    consumed: bool,
}

impl ImportResumeReservation {
    pub(crate) fn start(mut self) -> Result<ImportJobStart, &'static str> {
        let result = self
            .service
            .upgrade()
            .ok_or("import_job_state_unavailable")?
            .start_reserved_resume(&self.authority);
        self.consumed = result.is_ok();
        result
    }
}

impl Drop for ImportResumeReservation {
    fn drop(&mut self) {
        if self.consumed {
            return;
        }
        if let Some(service) = self.service.upgrade() {
            service.release_resume_reservation(&self.authority);
        }
    }
}

struct ActiveImportJob {
    authority: ImportJobAuthority,
    cancelled: bool,
    cancellation: Arc<AtomicBool>,
}

#[derive(Default)]
struct ImportJobState {
    active: Option<ActiveImportJob>,
    generation: u64,
    resume_reservation: Option<ImportJobAuthority>,
}

#[derive(Default)]
pub(crate) struct ImportJobService {
    state: Mutex<ImportJobState>,
}

impl ImportJobService {
    pub(crate) fn begin_new(&self, job_id: String) -> Result<ImportJobStart, &'static str> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "import_job_state_unavailable")?;
        if let Some(previous) = state.active.take() {
            previous.cancellation.store(true, Ordering::Release);
        }
        state.resume_reservation = None;
        let authority = next_authority(&mut state, job_id)?;
        Ok(install(&mut state, authority))
    }

    pub(crate) fn reserve_resume(
        self: &Arc<Self>,
        job_id: String,
    ) -> Result<ImportResumeReservation, &'static str> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "import_job_state_unavailable")?;
        if state.active.is_some() {
            return Err("import_resume_blocked_by_active_job");
        }
        if state.resume_reservation.is_some() {
            return Err("import_resume_validation_already_in_progress");
        }
        let authority = next_authority(&mut state, job_id)?;
        state.resume_reservation = Some(authority.clone());
        Ok(ImportResumeReservation {
            authority,
            service: Arc::downgrade(self),
            consumed: false,
        })
    }

    fn start_reserved_resume(
        &self,
        authority: &ImportJobAuthority,
    ) -> Result<ImportJobStart, &'static str> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "import_job_state_unavailable")?;
        if state.active.is_some() || state.resume_reservation.as_ref() != Some(authority) {
            return Err("import_resume_stale_reservation");
        }
        state.resume_reservation = None;
        Ok(install(&mut state, authority.clone()))
    }

    fn release_resume_reservation(&self, authority: &ImportJobAuthority) {
        if let Ok(mut state) = self.state.lock()
            && state.resume_reservation.as_ref() == Some(authority)
        {
            state.resume_reservation = None;
        }
    }

    pub(crate) fn ensure_resume_available(&self) -> Result<(), &'static str> {
        let state = self
            .state
            .lock()
            .map_err(|_| "import_job_state_unavailable")?;
        if state.active.is_some() {
            return Err("import_resume_blocked_by_active_job");
        }
        if state.resume_reservation.is_some() {
            return Err("import_resume_validation_already_in_progress");
        }
        Ok(())
    }

    pub(crate) fn cancel(&self, authority: &ImportJobAuthority) -> Result<bool, &'static str> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "import_job_state_unavailable")?;
        let Some(active) = state
            .active
            .as_mut()
            .filter(|active| active.authority == *authority)
        else {
            return Ok(false);
        };
        active.cancelled = true;
        active.cancellation.store(true, Ordering::Release);
        Ok(true)
    }

    pub(crate) fn complete(&self, authority: &ImportJobAuthority) -> bool {
        let Ok(mut state) = self.state.lock() else {
            return false;
        };
        if !state
            .active
            .as_ref()
            .is_some_and(|active| active.authority == *authority)
        {
            return false;
        }
        state.active = None;
        true
    }

    pub(crate) fn status(&self) -> Option<ImportJobStatus> {
        self.state
            .lock()
            .ok()?
            .active
            .as_ref()
            .map(|active| ImportJobStatus {
                authority: active.authority.clone(),
                cancelled: active.cancelled,
            })
    }
}

fn next_authority(
    state: &mut ImportJobState,
    job_id: String,
) -> Result<ImportJobAuthority, &'static str> {
    state.generation = state
        .generation
        .checked_add(1)
        .ok_or("import_job_generation_exhausted")?;
    Ok(ImportJobAuthority {
        generation: state.generation,
        job_id,
    })
}

fn install(state: &mut ImportJobState, authority: ImportJobAuthority) -> ImportJobStart {
    let cancellation = Arc::new(AtomicBool::new(false));
    state.active = Some(ActiveImportJob {
        authority: authority.clone(),
        cancelled: false,
        cancellation: Arc::clone(&cancellation),
    });
    ImportJobStart {
        authority,
        cancellation,
    }
}

#[cfg(test)]
mod tests {
    use std::{
        sync::{Arc, Barrier},
        thread,
    };

    use super::*;

    #[cfg(feature = "tauri-test")]
    use tauri::{Manager, ipc::InvokeBody, webview::InvokeRequest};

    #[test]
    fn delayed_predecessor_cancel_cannot_touch_successor() {
        let service = ImportJobService::default();
        let first = service.begin_new("import-1".into()).unwrap();
        let second = service.begin_new("import-2".into()).unwrap();

        assert!(first.cancellation.load(Ordering::Acquire));
        assert_eq!(service.cancel(&first.authority), Ok(false));
        assert!(!second.cancellation.load(Ordering::Acquire));
        assert_eq!(service.cancel(&second.authority), Ok(true));
    }

    #[test]
    fn same_job_predecessor_generation_cannot_cancel_resumed_successor() {
        let service = Arc::new(ImportJobService::default());
        let first = service.begin_new("import-1".into()).unwrap();
        assert!(service.complete(&first.authority));
        let second = service
            .reserve_resume("import-1".into())
            .unwrap()
            .start()
            .unwrap();

        assert_ne!(first.authority.generation, second.authority.generation);
        assert_eq!(service.cancel(&first.authority), Ok(false));
        assert_eq!(service.cancel(&second.authority), Ok(true));
    }

    #[test]
    fn resume_reservation_losing_to_new_job_is_stale_without_displacing_successor() {
        let service = Arc::new(ImportJobService::default());
        let delayed_resume = service.reserve_resume("import-a".into()).unwrap();
        let successor = service.begin_new("import-b".into()).unwrap();

        assert_eq!(
            delayed_resume.start().err(),
            Some("import_resume_stale_reservation")
        );
        assert_eq!(service.cancel(&successor.authority), Ok(true));
        assert_eq!(service.status().unwrap().authority, successor.authority);
    }

    #[test]
    fn concurrent_exact_cancel_is_idempotent() {
        let service = Arc::new(ImportJobService::default());
        let active = service.begin_new("import-1".into()).unwrap();
        let barrier = Arc::new(Barrier::new(9));
        let workers = (0..8)
            .map(|_| {
                let service = Arc::clone(&service);
                let authority = active.authority.clone();
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    barrier.wait();
                    service.cancel(&authority)
                })
            })
            .collect::<Vec<_>>();

        barrier.wait();
        for worker in workers {
            assert_eq!(worker.join().unwrap(), Ok(true));
        }
        assert!(active.cancellation.load(Ordering::Acquire));
        assert!(service.status().unwrap().cancelled);
    }

    #[cfg(feature = "tauri-test")]
    #[test]
    fn cancel_import_ipc_carries_exact_job_generation_authority() {
        let app = tauri::test::mock_builder()
            .manage(crate::AppState::new())
            .invoke_handler(tauri::generate_handler![
                crate::file_management::cancel_import,
                crate::file_management::get_active_import_job_status
            ])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let state = app.state::<crate::AppState>();
        let first = state
            .services
            .import_jobs
            .begin_new("import-ipc-a".into())
            .unwrap();
        let successor = state
            .services
            .import_jobs
            .begin_new("import-ipc-b".into())
            .unwrap();

        tauri::test::get_ipc_response(
            &webview,
            InvokeRequest {
                cmd: "cancel_import".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: InvokeBody::Json(serde_json::json!({
                    "generation": first.authority.generation,
                    "jobId": first.authority.job_id,
                })),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        )
        .expect("stale cancel import IPC response");

        assert!(!successor.cancellation.load(Ordering::Acquire));
        assert_eq!(
            state.services.import_jobs.status().unwrap().authority,
            successor.authority
        );
    }
}
