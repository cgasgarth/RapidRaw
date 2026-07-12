use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::source_revision::SourceRevision;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTransferProgress {
    pub bytes_current: u64,
    pub bytes_total: Option<u64>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum VerificationOutcome {
    Cached,
    Hashed,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct VerificationManifest {
    schema_version: u8,
    expected_sha256: String,
    actual_sha256: String,
    source_revision: String,
}

pub async fn download_verified_atomic(
    client: &reqwest::Client,
    url: &str,
    destination: &Path,
    expected_sha256: &str,
    cancelled: &AtomicBool,
    mut progress: impl FnMut(AiTransferProgress),
) -> Result<()> {
    let mut response = client.get(url).send().await?.error_for_status()?;
    let total = response.content_length();
    let temp_path = download_temp_path(destination);
    if let Some(parent) = destination.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let mut file = tokio::fs::File::create(&temp_path).await?;
    let mut hasher = Sha256::new();
    let mut current = 0_u64;
    let mut last_reported = 0_u64;
    const PROGRESS_INTERVAL_BYTES: u64 = 256 * 1024;
    while let Some(chunk) = response.chunk().await? {
        if cancelled.load(Ordering::Acquire) {
            drop(file);
            let _ = tokio::fs::remove_file(&temp_path).await;
            return Err(anyhow!("ai_model_download_cancelled"));
        }
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk).await?;
        hasher.update(&chunk);
        current = current.saturating_add(chunk.len() as u64);
        if current.saturating_sub(last_reported) >= PROGRESS_INTERVAL_BYTES
            || total.is_some_and(|total| current >= total)
        {
            progress(AiTransferProgress {
                bytes_current: current,
                bytes_total: total,
            });
            last_reported = current;
        }
    }
    if current != last_reported {
        progress(AiTransferProgress {
            bytes_current: current,
            bytes_total: total,
        });
    }
    tokio::io::AsyncWriteExt::flush(&mut file).await?;
    file.sync_all().await?;
    drop(file);
    let actual = hex::encode(hasher.finalize());
    if actual != expected_sha256 {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err(anyhow!("ai_model_digest_mismatch:{actual}"));
    }
    tokio::fs::rename(&temp_path, destination).await?;
    Ok(())
}

pub fn verify_model_file_cached(
    model_path: &Path,
    expected_sha256: &str,
    cache_path: &Path,
) -> Result<VerificationOutcome> {
    let revision = SourceRevision::from_path(model_path).map_err(anyhow::Error::new)?;
    if let Ok(bytes) = std::fs::read(cache_path)
        && let Ok(cached) = serde_json::from_slice::<VerificationManifest>(&bytes)
        && cached.schema_version == 1
        && cached.expected_sha256 == expected_sha256
        && cached.actual_sha256 == expected_sha256
        && cached.source_revision == revision.identity()
    {
        return Ok(VerificationOutcome::Cached);
    }
    let actual = sha256_file(model_path)?;
    if actual != expected_sha256 {
        return Err(anyhow!("ai_model_digest_mismatch:{actual}"));
    }
    let manifest = VerificationManifest {
        schema_version: 1,
        expected_sha256: expected_sha256.to_string(),
        actual_sha256: actual,
        source_revision: revision.identity(),
    };
    write_json_atomic(cache_path, &manifest)?;
    Ok(VerificationOutcome::Hashed)
}

pub fn cleanup_stale_download(model_path: &Path) -> Result<()> {
    let temp = download_temp_path(model_path);
    if temp.exists() {
        std::fs::remove_file(temp)?;
    }
    Ok(())
}

fn sha256_file(path: &Path) -> Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn write_json_atomic(path: &Path, value: &impl Serialize) -> Result<()> {
    let parent = path.parent().context("verification cache parent missing")?;
    std::fs::create_dir_all(parent)?;
    let temp = path.with_extension("tmp");
    let mut file = std::fs::File::create(&temp)?;
    file.write_all(&serde_json::to_vec(value)?)?;
    file.sync_all()?;
    std::fs::rename(temp, path)?;
    Ok(())
}

fn download_temp_path(destination: &Path) -> PathBuf {
    destination.with_extension(format!(
        "{}.part",
        destination
            .extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or("model")
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::sync::Arc;
    use std::thread;
    use std::time::Duration;

    fn serve_once(body: Vec<u8>) -> String {
        serve_once_in_chunks(body, usize::MAX, Duration::ZERO)
    }

    fn serve_once_in_chunks(body: Vec<u8>, chunk_bytes: usize, delay: Duration) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request);
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            )
            .unwrap();
            for chunk in body.chunks(chunk_bytes) {
                if stream.write_all(chunk).is_err() {
                    break;
                }
                thread::sleep(delay);
            }
        });
        format!("http://{address}/model")
    }

    #[test]
    fn verification_cache_skips_unchanged_file_and_rehashes_replacement() {
        let directory = tempfile::tempdir().unwrap();
        let model = directory.path().join("model.onnx");
        let cache = directory.path().join("model.verify.json");
        std::fs::write(&model, b"verified model").unwrap();
        let expected = hex::encode(Sha256::digest(b"verified model"));
        assert_eq!(
            verify_model_file_cached(&model, &expected, &cache).unwrap(),
            VerificationOutcome::Hashed
        );
        assert_eq!(
            verify_model_file_cached(&model, &expected, &cache).unwrap(),
            VerificationOutcome::Cached
        );
        std::fs::write(&model, b"replacement").unwrap();
        assert!(verify_model_file_cached(&model, &expected, &cache).is_err());
    }

    #[test]
    fn stale_partial_cleanup_never_removes_final_model() {
        let directory = tempfile::tempdir().unwrap();
        let model = directory.path().join("model.onnx");
        let partial = download_temp_path(&model);
        std::fs::write(&model, b"final").unwrap();
        std::fs::write(&partial, b"partial").unwrap();
        cleanup_stale_download(&model).unwrap();
        assert!(model.exists());
        assert!(!partial.exists());
    }

    #[tokio::test]
    async fn streamed_download_commits_only_verified_final_artifact() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("model.onnx");
        let body = vec![37_u8; 128 * 1024];
        let expected = hex::encode(Sha256::digest(&body));
        let progress = std::sync::Mutex::new(Vec::new());
        download_verified_atomic(
            &reqwest::Client::new(),
            &serve_once(body.clone()),
            &destination,
            &expected,
            &AtomicBool::new(false),
            |update| progress.lock().unwrap().push(update.bytes_current),
        )
        .await
        .unwrap();
        assert_eq!(std::fs::read(&destination).unwrap(), body);
        assert!(!download_temp_path(&destination).exists());
        let updates = progress.into_inner().unwrap();
        assert_eq!(updates.last().copied(), Some(128 * 1024));
        assert!(updates.windows(2).all(|pair| pair[0] < pair[1]));
    }

    #[tokio::test]
    async fn digest_mismatch_and_cancellation_leave_no_final_or_partial_file() {
        for cancelled in [false, true] {
            let directory = tempfile::tempdir().unwrap();
            let destination = directory.path().join("model.onnx");
            let cancellation = AtomicBool::new(cancelled);
            let result = download_verified_atomic(
                &reqwest::Client::new(),
                &serve_once(vec![11_u8; 32 * 1024]),
                &destination,
                "not-the-real-digest",
                &cancellation,
                |_| {},
            )
            .await;
            assert!(result.is_err());
            assert!(!destination.exists());
            assert!(!download_temp_path(&destination).exists());
        }
    }

    #[tokio::test]
    async fn cancellation_during_stream_removes_partial_and_stops_before_full_body() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("model.onnx");
        let body = vec![29_u8; 2 * 1024 * 1024];
        let expected = hex::encode(Sha256::digest(&body));
        let cancellation = Arc::new(AtomicBool::new(false));
        let progress_bytes = Arc::new(std::sync::Mutex::new(Vec::new()));
        let progress_for_callback = Arc::clone(&progress_bytes);
        let cancel_for_callback = Arc::clone(&cancellation);
        let result = download_verified_atomic(
            &reqwest::Client::new(),
            &serve_once_in_chunks(body.clone(), 32 * 1024, Duration::from_millis(2)),
            &destination,
            &expected,
            cancellation.as_ref(),
            move |update| {
                progress_for_callback
                    .lock()
                    .unwrap()
                    .push(update.bytes_current);
                cancel_for_callback.store(true, Ordering::Release);
            },
        )
        .await;
        assert!(matches!(result, Err(error) if error.to_string().contains("cancelled")));
        assert!(!destination.exists());
        assert!(!download_temp_path(&destination).exists());
        let observed = progress_bytes.lock().unwrap();
        assert!(!observed.is_empty());
        assert!(observed.last().copied().unwrap() < body.len() as u64);
    }
}
