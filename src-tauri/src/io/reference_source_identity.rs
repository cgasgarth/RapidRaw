use serde::Serialize;
use std::io::ErrorKind;
use std::path::Path;

use super::source_revision::{SourceRevision, SourceRevisionError};

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReferenceSourceIdentity {
    pub available: bool,
    pub source_revision: Option<String>,
}

pub(crate) fn resolve_reference_source_identity(
    path: &Path,
) -> Result<ReferenceSourceIdentity, String> {
    match SourceRevision::from_path(path) {
        Ok(revision) => Ok(ReferenceSourceIdentity {
            available: true,
            source_revision: Some(revision.identity()),
        }),
        Err(SourceRevisionError::Metadata { source, .. })
            if source.kind() == ErrorKind::NotFound =>
        {
            Ok(ReferenceSourceIdentity {
                available: false,
                source_revision: None,
            })
        }
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replacement_at_the_same_path_changes_identity_and_deletion_is_missing() {
        let root = tempfile::tempdir().expect("tempdir");
        let path = root.path().join("reference.raw");
        std::fs::write(&path, b"first").expect("write first source");
        let first = resolve_reference_source_identity(&path).expect("first identity");

        std::fs::remove_file(&path).expect("remove first source");
        std::fs::write(&path, b"replacement-with-different-length").expect("write replacement");
        let replacement = resolve_reference_source_identity(&path).expect("replacement identity");

        assert!(first.available);
        assert!(replacement.available);
        assert_ne!(first.source_revision, replacement.source_revision);

        std::fs::remove_file(&path).expect("remove replacement");
        assert_eq!(
            resolve_reference_source_identity(&path).expect("missing identity"),
            ReferenceSourceIdentity {
                available: false,
                source_revision: None,
            }
        );
    }
}
