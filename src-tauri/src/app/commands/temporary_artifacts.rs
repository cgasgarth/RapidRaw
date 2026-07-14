//! Commands for short-lived native artifacts handed to the frontend.

use std::io::Write;

use tempfile::NamedTempFile;

fn persist_temp_file(bytes: &[u8]) -> Result<String, String> {
    let mut temp_file = NamedTempFile::new().map_err(|error| error.to_string())?;
    temp_file
        .write_all(bytes)
        .map_err(|error| error.to_string())?;
    let (_file, path) = temp_file.keep().map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub(crate) async fn save_temp_file(bytes: Vec<u8>) -> Result<String, String> {
    persist_temp_file(&bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::thread;

    #[test]
    fn temporary_artifact_path_is_a_real_readable_file() {
        let path = persist_temp_file(b"rapidraw-command-proof").expect("temporary artifact");
        assert_eq!(
            fs::read(&path).expect("temporary artifact contents"),
            b"rapidraw-command-proof"
        );
        fs::remove_file(path).expect("temporary artifact cleanup");
    }

    #[test]
    fn temporary_artifact_writes_are_isolated_under_concurrency() {
        let workers = (0..8)
            .map(|index| {
                thread::spawn(move || {
                    let contents = format!("artifact-{index}");
                    let path = persist_temp_file(contents.as_bytes()).expect("temporary artifact");
                    let observed = fs::read_to_string(&path).expect("temporary artifact readback");
                    fs::remove_file(path).expect("temporary artifact cleanup");
                    observed
                })
            })
            .collect::<Vec<_>>();
        for (index, worker) in workers.into_iter().enumerate() {
            assert_eq!(
                worker.join().expect("artifact worker"),
                format!("artifact-{index}")
            );
        }
    }
}
