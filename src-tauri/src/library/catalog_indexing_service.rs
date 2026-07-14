use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};

use serde::{Deserialize, Serialize};
use tokio::task::AbortHandle;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CatalogIndexingAuthority {
    pub generation: u64,
    pub operation_id: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CatalogIndexingTerminalStatus {
    Cancelled,
    Completed,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CatalogIndexingSnapshot {
    pub authority: CatalogIndexingAuthority,
    pub current: usize,
    pub folder_path: String,
    pub terminal_status: Option<CatalogIndexingTerminalStatus>,
    pub total: usize,
}

pub(crate) struct CatalogIndexingStart {
    pub authority: CatalogIndexingAuthority,
    pub cancellation: Arc<AtomicBool>,
    pub cancelled_predecessor: Option<CatalogIndexingSnapshot>,
}

struct ActiveCatalogIndexing {
    abort: Option<AbortHandle>,
    authority: CatalogIndexingAuthority,
    cancellation: Arc<AtomicBool>,
    current: usize,
    folder_path: String,
    terminal_status: Option<CatalogIndexingTerminalStatus>,
    total: usize,
}

impl ActiveCatalogIndexing {
    fn snapshot(&self) -> CatalogIndexingSnapshot {
        CatalogIndexingSnapshot {
            authority: self.authority,
            current: self.current,
            folder_path: self.folder_path.clone(),
            terminal_status: self.terminal_status,
            total: self.total,
        }
    }
}

#[derive(Default)]
struct CatalogIndexingState {
    active: Option<ActiveCatalogIndexing>,
    generation: u64,
    operation_id: u64,
}

#[derive(Default)]
pub(crate) struct CatalogIndexingService {
    state: Mutex<CatalogIndexingState>,
}

impl CatalogIndexingService {
    pub(crate) fn begin(&self, folder_path: String) -> Result<CatalogIndexingStart, &'static str> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "catalog_indexing_state_unavailable")?;
        let cancelled_predecessor = state.active.take().map(|mut predecessor| {
            predecessor.cancellation.store(true, Ordering::Release);
            if let Some(abort) = predecessor.abort.take() {
                abort.abort();
            }
            predecessor.terminal_status = Some(CatalogIndexingTerminalStatus::Cancelled);
            predecessor.snapshot()
        });
        state.generation = state
            .generation
            .checked_add(1)
            .ok_or("catalog_indexing_generation_exhausted")?;
        state.operation_id = state
            .operation_id
            .checked_add(1)
            .ok_or("catalog_indexing_operation_id_exhausted")?;
        let authority = CatalogIndexingAuthority {
            generation: state.generation,
            operation_id: state.operation_id,
        };
        let cancellation = Arc::new(AtomicBool::new(false));
        state.active = Some(ActiveCatalogIndexing {
            abort: None,
            authority,
            cancellation: Arc::clone(&cancellation),
            current: 0,
            folder_path,
            terminal_status: None,
            total: 0,
        });
        Ok(CatalogIndexingStart {
            authority,
            cancellation,
            cancelled_predecessor,
        })
    }

    pub(crate) fn attach_task(
        &self,
        authority: CatalogIndexingAuthority,
        abort: AbortHandle,
    ) -> bool {
        let Ok(mut state) = self.state.lock() else {
            abort.abort();
            return false;
        };
        let Some(active) = state
            .active
            .as_mut()
            .filter(|active| active.authority == authority && active.terminal_status.is_none())
        else {
            abort.abort();
            return false;
        };
        active.abort = Some(abort);
        true
    }

    pub(crate) fn set_total(
        &self,
        authority: CatalogIndexingAuthority,
        total: usize,
    ) -> Option<CatalogIndexingSnapshot> {
        self.update_running(authority, |active| active.total = total)
    }

    pub(crate) fn record_completed(
        &self,
        authority: CatalogIndexingAuthority,
    ) -> Option<CatalogIndexingSnapshot> {
        self.update_running(authority, |active| {
            active.current = active.current.saturating_add(1).min(active.total);
        })
    }

    pub(crate) fn cancel(
        &self,
        authority: CatalogIndexingAuthority,
    ) -> Option<CatalogIndexingSnapshot> {
        self.finish(authority, CatalogIndexingTerminalStatus::Cancelled)
    }

    pub(crate) fn complete(
        &self,
        authority: CatalogIndexingAuthority,
    ) -> Option<CatalogIndexingSnapshot> {
        self.finish(authority, CatalogIndexingTerminalStatus::Completed)
    }

    pub(crate) fn fail(
        &self,
        authority: CatalogIndexingAuthority,
    ) -> Option<CatalogIndexingSnapshot> {
        self.finish(authority, CatalogIndexingTerminalStatus::Failed)
    }

    pub(crate) fn is_current(&self, authority: CatalogIndexingAuthority) -> bool {
        self.state.lock().is_ok_and(|state| {
            state.active.as_ref().is_some_and(|active| {
                active.authority == authority
                    && active.terminal_status.is_none()
                    && !active.cancellation.load(Ordering::Acquire)
            })
        })
    }

    fn update_running(
        &self,
        authority: CatalogIndexingAuthority,
        update: impl FnOnce(&mut ActiveCatalogIndexing),
    ) -> Option<CatalogIndexingSnapshot> {
        let mut state = self.state.lock().ok()?;
        let active = state.active.as_mut().filter(|active| {
            active.authority == authority
                && active.terminal_status.is_none()
                && !active.cancellation.load(Ordering::Acquire)
        })?;
        update(active);
        Some(active.snapshot())
    }

    fn finish(
        &self,
        authority: CatalogIndexingAuthority,
        terminal_status: CatalogIndexingTerminalStatus,
    ) -> Option<CatalogIndexingSnapshot> {
        let mut state = self.state.lock().ok()?;
        if !state
            .active
            .as_ref()
            .is_some_and(|active| active.authority == authority && active.terminal_status.is_none())
        {
            return None;
        }
        let mut active = state.active.take()?;
        if terminal_status == CatalogIndexingTerminalStatus::Cancelled {
            active.cancellation.store(true, Ordering::Release);
            if let Some(abort) = active.abort.take() {
                abort.abort();
            }
        } else {
            active.abort = None;
        }
        active.terminal_status = Some(terminal_status);
        Some(active.snapshot())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Barrier};
    use std::thread;

    use super::*;

    #[test]
    fn stale_predecessor_cannot_cancel_or_publish_successor() {
        let service = CatalogIndexingService::default();
        let first = service.begin("first".into()).unwrap();
        let second = service.begin("second".into()).unwrap();

        assert!(first.cancellation.load(Ordering::Acquire));
        assert!(service.cancel(first.authority).is_none());
        assert!(service.record_completed(first.authority).is_none());
        assert!(service.is_current(second.authority));
    }

    #[test]
    fn concurrent_stale_cancel_cannot_touch_exact_successor() {
        let service = Arc::new(CatalogIndexingService::default());
        let first = service.begin("first".into()).unwrap();
        let barrier = Arc::new(Barrier::new(2));
        let worker = {
            let service = Arc::clone(&service);
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                barrier.wait();
                service.cancel(first.authority)
            })
        };
        let successor = service.begin("second".into()).unwrap();
        barrier.wait();

        assert!(worker.join().unwrap().is_none());
        assert!(service.is_current(successor.authority));
    }

    #[test]
    fn progress_is_monotonic_and_terminal_is_exact() {
        let service = CatalogIndexingService::default();
        let start = service.begin("catalog".into()).unwrap();
        assert_eq!(service.set_total(start.authority, 2).unwrap().total, 2);
        assert_eq!(
            service.record_completed(start.authority).unwrap().current,
            1
        );
        assert_eq!(
            service.record_completed(start.authority).unwrap().current,
            2
        );
        let terminal = service.complete(start.authority).unwrap();
        assert_eq!(
            terminal.terminal_status,
            Some(CatalogIndexingTerminalStatus::Completed)
        );
        assert!(service.record_completed(start.authority).is_none());
        assert!(service.complete(start.authority).is_none());
    }

    #[cfg(feature = "tauri-test")]
    #[tauri::command]
    fn cancel_catalog_indexing_boundary(
        authority: CatalogIndexingAuthority,
        state: tauri::State<'_, crate::AppState>,
    ) -> bool {
        state.services.catalog_indexing.cancel(authority).is_some()
    }

    #[cfg(feature = "tauri-test")]
    #[test]
    fn cancel_ipc_requires_exact_catalog_generation_and_operation() {
        use tauri::Manager;

        let app = tauri::test::mock_builder()
            .manage(crate::AppState::new())
            .invoke_handler(tauri::generate_handler![cancel_catalog_indexing_boundary])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let service = Arc::clone(&app.state::<crate::AppState>().services.catalog_indexing);
        let predecessor = service.begin("old".into()).unwrap();
        let successor = service.begin("current".into()).unwrap();

        for (authority, expected) in [(predecessor.authority, false), (successor.authority, true)] {
            let response = tauri::test::get_ipc_response(
                &webview,
                tauri::webview::InvokeRequest {
                    cmd: "cancel_catalog_indexing_boundary".into(),
                    callback: tauri::ipc::CallbackFn(0),
                    error: tauri::ipc::CallbackFn(1),
                    url: "tauri://localhost".parse().unwrap(),
                    body: tauri::ipc::InvokeBody::Json(serde_json::json!({
                        "authority": authority,
                    })),
                    headers: Default::default(),
                    invoke_key: tauri::test::INVOKE_KEY.to_string(),
                },
            )
            .expect("catalog indexing cancel IPC response");
            assert_eq!(response.deserialize::<bool>().unwrap(), expected);
            if authority == predecessor.authority {
                assert!(service.is_current(successor.authority));
            }
        }
        assert!(!service.is_current(successor.authority));
    }
}
