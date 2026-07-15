use std::sync::Arc;

use tokio::task::JoinHandle;

use super::job_registry::{
    ExportCancellationAck, ExportJobHandle, ExportJobRegistry, ExportJobSnapshot,
};

#[derive(Clone, Default)]
pub(crate) struct ExportRuntimeServices {
    jobs: Arc<ExportJobRegistry>,
}

impl ExportRuntimeServices {
    pub(crate) fn admit(&self) -> Result<ExportJobHandle, String> {
        self.jobs.admit()
    }

    pub(crate) fn attach_task(&self, handle: &ExportJobHandle, task: JoinHandle<()>) -> bool {
        self.jobs.attach_task(handle, task)
    }

    pub(crate) fn request_cancellation(&self) -> Result<ExportCancellationAck, String> {
        self.jobs.request_cancellation()
    }

    pub(crate) fn snapshot(&self) -> Option<ExportJobSnapshot> {
        self.jobs.snapshot()
    }

    pub(crate) fn complete(&self, handle: &ExportJobHandle) -> bool {
        self.jobs.complete(handle)
    }

    pub(crate) fn publish_result<T>(
        &self,
        handle: &ExportJobHandle,
        publish: impl FnOnce() -> T,
    ) -> Option<T> {
        if !self.jobs.claim_terminal_publication(handle) {
            return None;
        }
        let publication = TerminalPublication {
            handle: handle.clone(),
            jobs: Arc::clone(&self.jobs),
        };
        let result = publish();
        drop(publication);
        Some(result)
    }
}

struct TerminalPublication {
    handle: ExportJobHandle,
    jobs: Arc<ExportJobRegistry>,
}

impl Drop for TerminalPublication {
    fn drop(&mut self) {
        let _ = self.jobs.complete(&self.handle);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Barrier};
    use std::thread;

    use super::*;

    #[test]
    fn forced_concurrent_terminal_publication_runs_once_and_releases_exact_generation() {
        let runtime = Arc::new(ExportRuntimeServices::default());
        let handle = runtime.admit().unwrap();
        let publications = Arc::new(AtomicUsize::new(0));
        let barrier = Arc::new(Barrier::new(17));
        let workers = (0..16)
            .map(|_| {
                let barrier = Arc::clone(&barrier);
                let handle = handle.clone();
                let publications = Arc::clone(&publications);
                let runtime = Arc::clone(&runtime);
                thread::spawn(move || {
                    barrier.wait();
                    runtime.publish_result(&handle, || {
                        publications.fetch_add(1, Ordering::SeqCst);
                        "sha256:verified-output"
                    })
                })
            })
            .collect::<Vec<_>>();
        barrier.wait();

        let published = workers
            .into_iter()
            .filter_map(|worker| worker.join().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(published, ["sha256:verified-output"]);
        assert_eq!(publications.load(Ordering::SeqCst), 1);
        assert!(runtime.snapshot().is_none());

        let successor = runtime.admit().unwrap();
        assert!(!runtime.complete(&handle));
        assert_eq!(runtime.snapshot().unwrap().job_id, successor.job_id());
        assert!(runtime.complete(&successor));
    }

    #[test]
    fn terminal_publication_runs_without_registry_lock_and_releases_on_unwind() {
        let runtime = ExportRuntimeServices::default();
        let handle = runtime.admit().unwrap();

        let panic = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            runtime.publish_result(&handle, || {
                assert_eq!(runtime.snapshot().unwrap().job_id, handle.job_id());
                assert!(runtime.admit().is_err());
                assert!(runtime.request_cancellation().is_err());
                panic!("forced terminal publisher unwind");
            });
        }));

        assert!(panic.is_err());
        assert!(runtime.snapshot().is_none());
        let successor = runtime.admit().unwrap();
        assert!(runtime.complete(&successor));
    }

    #[test]
    fn forced_cancel_vs_terminal_publication_has_one_coherent_outcome_and_isolates_successor() {
        let runtime = Arc::new(ExportRuntimeServices::default());
        let handle = runtime.admit().unwrap();
        let barrier = Arc::new(Barrier::new(3));

        let cancel_runtime = Arc::clone(&runtime);
        let cancel_barrier = Arc::clone(&barrier);
        let cancel = thread::spawn(move || {
            cancel_barrier.wait();
            cancel_runtime.request_cancellation()
        });
        let publish_runtime = Arc::clone(&runtime);
        let publish_barrier = Arc::clone(&barrier);
        let publish_handle = handle.clone();
        let publish = thread::spawn(move || {
            publish_barrier.wait();
            publish_runtime.publish_result(&publish_handle, || {
                if publish_handle.cancellation().is_cancelled() {
                    "cancelled"
                } else {
                    "completed"
                }
            })
        });
        barrier.wait();

        let cancellation = cancel.join().unwrap();
        let terminal_status = publish.join().unwrap().unwrap();
        assert!(
            matches!((&cancellation, terminal_status), (Ok(_), "cancelled"))
                || matches!((&cancellation, terminal_status), (Err(_), "completed")),
            "cancel must either linearize before publication or lose to its terminal claim"
        );
        assert!(runtime.snapshot().is_none());

        let successor = runtime.admit().unwrap();
        assert!(runtime.publish_result(&handle, || "stale").is_none());
        assert!(!runtime.complete(&handle));
        assert_eq!(runtime.snapshot().unwrap().job_id, successor.job_id());
        assert!(runtime.complete(&successor));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn task_completion_before_attachment_is_harmless_and_releases_generation() {
        let runtime = Arc::new(ExportRuntimeServices::default());
        let handle = runtime.admit().unwrap();
        let task_runtime = Arc::clone(&runtime);
        let task_handle = handle.clone();
        let task = tokio::spawn(async move {
            assert_eq!(
                task_runtime.publish_result(&task_handle, || "completed"),
                Some("completed")
            );
        });
        while !task.is_finished() {
            tokio::task::yield_now().await;
        }

        assert!(!runtime.attach_task(&handle, task));
        assert!(runtime.snapshot().is_none());
        let successor = runtime.admit().unwrap();
        assert_eq!(runtime.snapshot().unwrap().job_id, successor.job_id());
        assert!(runtime.complete(&successor));
    }
}
