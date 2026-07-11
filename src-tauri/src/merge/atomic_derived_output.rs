use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

const READY_MARKER: &str = "COMMIT_READY";
const REGISTRATION_RECEIPT: &str = "REGISTRATION.json";
static PUBLISH_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AtomicOutputFault {
    Write,
    Flush,
    HashValidation,
    Marker,
    Rename,
    Registration,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DerivedOutputManifest {
    pub schema_version: u32,
    pub family: String,
    pub width: u64,
    pub height: u64,
    pub payload_path: String,
    pub preview_paths: Vec<String>,
    pub map_paths: Vec<String>,
    pub source_immutability_hashes: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DerivedOutputInventoryEntry {
    pub path: String,
    pub content_hash: String,
    pub bytes: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AtomicDerivedOutputReceipt {
    pub schema_version: u32,
    pub staging_identity: String,
    pub final_package_path: String,
    pub manifest_hash: String,
    pub inventory_hash: String,
    pub payload_hash: String,
    pub map_hashes: Vec<String>,
    pub commit_status: String,
    pub recovery_action: Option<String>,
}

pub struct AtomicDerivedOutputTransaction {
    staging_path: PathBuf,
    parent: PathBuf,
    requested_stem: String,
    inventory: BTreeMap<String, DerivedOutputInventoryEntry>,
    fault: Option<AtomicOutputFault>,
    published: bool,
}

impl AtomicDerivedOutputTransaction {
    pub fn begin(final_parent: &Path, requested_stem: &str) -> Result<Self, String> {
        fs::create_dir_all(final_parent).map_err(io_error("atomic_output_create_parent_failed"))?;
        let staging_identity = format!(".{}.staging-{}", requested_stem, Uuid::new_v4());
        let staging_path = final_parent.join(staging_identity);
        fs::create_dir(&staging_path).map_err(io_error("atomic_output_create_staging_failed"))?;
        Ok(Self {
            staging_path,
            parent: final_parent.to_path_buf(),
            requested_stem: requested_stem.to_string(),
            inventory: BTreeMap::new(),
            fault: None,
            published: false,
        })
    }

    #[cfg(test)]
    pub fn inject_fault(&mut self, fault: AtomicOutputFault) {
        self.fault = Some(fault);
    }
    pub fn write_file(&mut self, relative_path: &str, bytes: &[u8]) -> Result<String, String> {
        self.fail_if(
            AtomicOutputFault::Write,
            "atomic_output_injected_write_failure",
        )?;
        validate_relative(relative_path)?;
        let path = self.staging_path.join(relative_path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(io_error("atomic_output_create_directory_failed"))?;
        }
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(io_error("atomic_output_create_new_failed"))?;
        file.write_all(bytes)
            .map_err(io_error("atomic_output_write_failed"))?;
        self.fail_if(
            AtomicOutputFault::Flush,
            "atomic_output_injected_flush_failure",
        )?;
        file.sync_all()
            .map_err(io_error("atomic_output_fsync_failed"))?;
        let hash = format!("blake3:{}", blake3::hash(bytes).to_hex());
        self.inventory.insert(
            relative_path.to_string(),
            DerivedOutputInventoryEntry {
                path: relative_path.to_string(),
                content_hash: hash.clone(),
                bytes: bytes.len() as u64,
            },
        );
        Ok(hash)
    }

    pub fn stage_manifest(&mut self, manifest: &DerivedOutputManifest) -> Result<String, String> {
        if manifest.schema_version != 1 || manifest.width == 0 || manifest.height == 0 {
            return Err("atomic_output_manifest_invalid".to_string());
        }
        let bytes = serde_json::to_vec(manifest)
            .map_err(|e| format!("atomic_output_manifest_serialize_failed:{e}"))?;
        self.write_file("manifest.json", &bytes)
    }

    fn validate(&self, manifest: &DerivedOutputManifest) -> Result<(), String> {
        self.fail_if(
            AtomicOutputFault::HashValidation,
            "atomic_output_injected_hash_validation_failure",
        )?;
        let mut required = vec![manifest.payload_path.as_str(), "manifest.json"];
        required.extend(manifest.preview_paths.iter().map(String::as_str));
        required.extend(manifest.map_paths.iter().map(String::as_str));
        for relative in required {
            let expected = self
                .inventory
                .get(relative)
                .ok_or_else(|| format!("atomic_output_required_entry_missing:{relative}"))?;
            let mut bytes = Vec::new();
            File::open(self.staging_path.join(relative))
                .and_then(|mut f| f.read_to_end(&mut bytes))
                .map_err(io_error("atomic_output_validation_read_failed"))?;
            let actual = format!("blake3:{}", blake3::hash(&bytes).to_hex());
            if actual != expected.content_hash {
                return Err(format!("atomic_output_hash_mismatch:{relative}"));
            }
        }
        Ok(())
    }

    pub fn commit<F>(
        mut self,
        manifest: &DerivedOutputManifest,
        register: F,
    ) -> Result<AtomicDerivedOutputReceipt, String>
    where
        F: FnOnce(&Path) -> Result<(), String>,
    {
        self.validate(manifest)?;
        let inventory_bytes = serde_json::to_vec(&self.inventory.values().collect::<Vec<_>>())
            .map_err(|e| format!("atomic_output_inventory_serialize_failed:{e}"))?;
        let inventory_hash = self.write_file("inventory.json", &inventory_bytes)?;
        self.fail_if(
            AtomicOutputFault::Marker,
            "atomic_output_injected_marker_failure",
        )?;
        self.write_file(READY_MARKER, inventory_hash.as_bytes())?;
        sync_directory(&self.staging_path)?;
        self.fail_if(
            AtomicOutputFault::Rename,
            "atomic_output_injected_rename_failure",
        )?;
        let _guard = PUBLISH_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .map_err(|_| "atomic_output_publish_lock_unavailable".to_string())?;
        let final_path = collision_safe_path(&self.parent, &self.requested_stem);
        fs::rename(&self.staging_path, &final_path)
            .map_err(io_error("atomic_output_publish_failed"))?;
        self.published = true;
        sync_directory(&self.parent)?;
        let manifest_hash = self.inventory["manifest.json"].content_hash.clone();
        let payload_hash = self
            .inventory
            .get(&manifest.payload_path)
            .map(|e| e.content_hash.clone())
            .ok_or_else(|| "atomic_output_payload_missing".to_string())?;
        let map_hashes = manifest
            .map_paths
            .iter()
            .map(|path| self.inventory[path].content_hash.clone())
            .collect();
        let staging_identity = self
            .staging_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let registration_result = if self.fault == Some(AtomicOutputFault::Registration) {
            Err("atomic_output_injected_registration_failure".to_string())
        } else {
            register(&final_path)
        };
        let (commit_status, recovery_action) = match registration_result {
            Ok(()) => ("committed".to_string(), None),
            Err(_) => (
                "unregistered".to_string(),
                Some("retry_derived_source_registration".to_string()),
            ),
        };
        let receipt = AtomicDerivedOutputReceipt {
            schema_version: 1,
            staging_identity,
            final_package_path: final_path.to_string_lossy().into_owned(),
            manifest_hash,
            inventory_hash,
            payload_hash,
            map_hashes,
            commit_status,
            recovery_action,
        };
        let receipt_bytes = serde_json::to_vec(&receipt)
            .map_err(|e| format!("atomic_output_receipt_serialize_failed:{e}"))?;
        let mut receipt_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(final_path.join(REGISTRATION_RECEIPT))
            .map_err(io_error("atomic_output_receipt_create_failed"))?;
        receipt_file
            .write_all(&receipt_bytes)
            .map_err(io_error("atomic_output_receipt_write_failed"))?;
        receipt_file
            .sync_all()
            .map_err(io_error("atomic_output_receipt_fsync_failed"))?;
        sync_directory(&final_path)?;
        Ok(receipt)
    }

    fn fail_if(&self, fault: AtomicOutputFault, error: &str) -> Result<(), String> {
        if self.fault == Some(fault) {
            Err(error.to_string())
        } else {
            Ok(())
        }
    }
}

impl Drop for AtomicDerivedOutputTransaction {
    fn drop(&mut self) {
        if !self.published {
            let _ = fs::remove_dir_all(&self.staging_path);
        }
    }
}

pub fn recover_atomic_derived_outputs(parent: &Path) -> Result<Vec<PathBuf>, String> {
    let mut recoverable = Vec::new();
    for entry in fs::read_dir(parent).map_err(io_error("atomic_output_recovery_read_failed"))? {
        let path = entry
            .map_err(io_error("atomic_output_recovery_entry_failed"))?
            .path();
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        if name.contains(".staging-") {
            if path.join(READY_MARKER).exists() {
                recoverable.push(path);
            } else {
                fs::remove_dir_all(path)
                    .map_err(io_error("atomic_output_recovery_cleanup_failed"))?;
            }
        } else if path.join(READY_MARKER).exists() {
            let registered = fs::read(path.join(REGISTRATION_RECEIPT))
                .ok()
                .and_then(|bytes| serde_json::from_slice::<AtomicDerivedOutputReceipt>(&bytes).ok())
                .is_some_and(|r| r.commit_status == "committed");
            if !registered {
                recoverable.push(path);
            }
        }
    }
    recoverable.sort();
    Ok(recoverable)
}

fn collision_safe_path(parent: &Path, stem: &str) -> PathBuf {
    let first = parent.join(stem);
    if !first.exists() {
        return first;
    }
    for suffix in 2u64.. {
        let candidate = parent.join(format!("{stem}-{suffix}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!()
}
fn validate_relative(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if path.is_empty()
        || p.is_absolute()
        || p.components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        Err("atomic_output_invalid_relative_path".to_string())
    } else {
        Ok(())
    }
}
fn sync_directory(path: &Path) -> Result<(), String> {
    File::open(path)
        .and_then(|f| f.sync_all())
        .map_err(io_error("atomic_output_directory_fsync_failed"))
}
fn io_error(prefix: &'static str) -> impl FnOnce(std::io::Error) -> String {
    move |e| format!("{prefix}:{e}")
}

#[cfg(test)]
mod atomic_derived_output_tests {
    use super::*;
    use std::sync::{Arc, Barrier};
    use std::thread;
    fn manifest() -> DerivedOutputManifest {
        DerivedOutputManifest {
            schema_version: 1,
            family: "focus_stack".into(),
            width: 65,
            height: 33,
            payload_path: "payload.bin".into(),
            preview_paths: vec!["preview.bin".into()],
            map_paths: vec!["maps/mask.bin".into()],
            source_immutability_hashes: vec!["blake3:source".into()],
        }
    }
    fn staged(root: &Path) -> AtomicDerivedOutputTransaction {
        let mut tx = AtomicDerivedOutputTransaction::begin(root, "result.rrmerge").unwrap();
        tx.write_file("payload.bin", b"row-major-payload").unwrap();
        tx.write_file("preview.bin", b"preview").unwrap();
        tx.write_file("maps/mask.bin", b"map").unwrap();
        tx.stage_manifest(&manifest()).unwrap();
        tx
    }
    #[test]
    fn synthetic_multitile_package_commits_and_reopens() {
        let root = tempfile::tempdir().unwrap();
        let receipt = staged(root.path()).commit(&manifest(), |_| Ok(())).unwrap();
        assert_eq!(receipt.commit_status, "committed");
        let reopened: DerivedOutputManifest = serde_json::from_slice(
            &fs::read(Path::new(&receipt.final_package_path).join("manifest.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(reopened.width, 65);
    }
    #[test]
    fn registration_failure_is_recoverable() {
        let root = tempfile::tempdir().unwrap();
        let receipt = staged(root.path())
            .commit(&manifest(), |_| Err("catalog_down".into()))
            .unwrap();
        assert_eq!(receipt.commit_status, "unregistered");
        assert_eq!(
            recover_atomic_derived_outputs(root.path()).unwrap().len(),
            1
        );
    }
    #[test]
    fn injected_registration_failure_is_recoverable() {
        let root = tempfile::tempdir().unwrap();
        let mut tx = staged(root.path());
        tx.inject_fault(AtomicOutputFault::Registration);
        let receipt = tx.commit(&manifest(), |_| Ok(())).unwrap();
        assert_eq!(receipt.commit_status, "unregistered");
        assert_eq!(
            receipt.recovery_action.as_deref(),
            Some("retry_derived_source_registration")
        );
    }
    #[test]
    fn concurrent_names_never_overwrite() {
        let root = tempfile::tempdir().unwrap();
        let barrier = Arc::new(Barrier::new(3));
        let handles: Vec<_> = (0..2)
            .map(|_| {
                let root = root.path().to_path_buf();
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    let tx = staged(&root);
                    barrier.wait();
                    tx.commit(&manifest(), |_| Ok(())).unwrap()
                })
            })
            .collect();
        barrier.wait();
        let mut receipts: Vec<_> = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect();
        receipts.sort_by(|a, b| a.final_package_path.cmp(&b.final_package_path));
        let [a, b] = receipts.as_slice() else {
            panic!("expected two receipts")
        };
        assert_ne!(a.final_package_path, b.final_package_path);
        assert!(b.final_package_path.ends_with("-2"));
    }
    #[test]
    fn every_pre_publish_fault_cleans_staging() {
        for fault in [
            AtomicOutputFault::HashValidation,
            AtomicOutputFault::Marker,
            AtomicOutputFault::Rename,
        ] {
            let root = tempfile::tempdir().unwrap();
            let mut tx = staged(root.path());
            tx.inject_fault(fault);
            assert!(tx.commit(&manifest(), |_| Ok(())).is_err());
            assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
        }
    }
    #[test]
    fn write_and_flush_faults_are_cleaned() {
        for fault in [AtomicOutputFault::Write, AtomicOutputFault::Flush] {
            let root = tempfile::tempdir().unwrap();
            {
                let mut tx = AtomicDerivedOutputTransaction::begin(root.path(), "x").unwrap();
                tx.inject_fault(fault);
                assert!(tx.write_file("x", b"x").is_err());
            }
            assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
        }
    }
    #[test]
    fn ready_and_abandoned_staging_recover_differently() {
        let root = tempfile::tempdir().unwrap();
        let abandoned = AtomicDerivedOutputTransaction::begin(root.path(), "a").unwrap();
        std::mem::forget(abandoned);
        let mut ready = AtomicDerivedOutputTransaction::begin(root.path(), "b").unwrap();
        ready.write_file(READY_MARKER, b"ready").unwrap();
        std::mem::forget(ready);
        let recovered = recover_atomic_derived_outputs(root.path()).unwrap();
        assert_eq!(recovered.len(), 1);
    }
}
