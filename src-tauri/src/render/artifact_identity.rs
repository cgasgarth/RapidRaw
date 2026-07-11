use std::hash::{Hash, Hasher};

use crate::source_revision::{DecodedImageKey, SourceRevision};

pub const RENDER_ARTIFACT_ABI_VERSION: u32 = 2;
pub const CPU_RENDER_BACKEND_VERSION: u32 = 1;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct SourceArtifactIdentity {
    /// Includes virtual-copy identity. Two edits of one file may share only explicitly
    /// source-domain artifacts.
    pub canonical_identity: String,
    pub physical_identity: String,
    pub revision: SourceRevision,
    pub decode_contract: u64,
}

impl SourceArtifactIdentity {
    pub fn from_decoded_key(canonical_identity: String, key: &DecodedImageKey) -> Self {
        let physical_identity = key
            .source_revision
            .canonical_path
            .to_string_lossy()
            .into_owned();
        Self {
            canonical_identity,
            physical_identity,
            revision: key.source_revision.clone(),
            decode_contract: stable_hash(&key.processing_profile),
        }
    }

    pub fn source_fingerprint(&self) -> u64 {
        stable_hash(self)
    }

    pub fn decode_fingerprint(&self) -> u64 {
        stable_hash(&(
            &self.physical_identity,
            &self.revision,
            self.decode_contract,
        ))
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum ArtifactColorDomain {
    SourceDecoded,
    SceneLinear,
    ViewEncoded,
    DisplayEncoded,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum ArtifactScope {
    FullFrame,
    Roi {
        x: u32,
        y: u32,
        width: u32,
        height: u32,
    },
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum PreviewQualityIdentity {
    Settled,
    Interactive { divisor_bits: u32 },
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct RenderArtifactIdentity {
    pub source: SourceArtifactIdentity,
    pub image_session: u64,
    pub adjustment_revision: u64,
    pub plan_revision: u64,
    pub source_stage: u64,
    pub geometry_stage: u64,
    pub masks_stage: u64,
    pub retouch_stage: u64,
    pub detail_stage: u64,
    pub color_stage: u64,
    pub output_stage: u64,
    pub color_domain: ArtifactColorDomain,
    pub completed_stage: &'static str,
    pub width: u32,
    pub height: u32,
    pub scope: ArtifactScope,
    pub quality: PreviewQualityIdentity,
    pub resampling_version: u32,
    pub encoding_contract: &'static str,
    pub display_snapshot: Option<u64>,
    pub backend_generation: u64,
    pub implementation_version: u32,
}

impl RenderArtifactIdentity {
    pub fn source_geometry(
        source: &SourceArtifactIdentity,
        image_session: u64,
        adjustment_revision: u64,
        source_stage: u64,
        geometry_stage: u64,
        width: u32,
        height: u32,
    ) -> Self {
        Self {
            source: source.clone(),
            image_session,
            adjustment_revision,
            plan_revision: adjustment_revision,
            source_stage,
            geometry_stage,
            masks_stage: 0,
            retouch_stage: 0,
            detail_stage: 0,
            color_stage: 0,
            output_stage: 0,
            color_domain: ArtifactColorDomain::SceneLinear,
            completed_stage: "geometry",
            width,
            height,
            scope: ArtifactScope::FullFrame,
            quality: PreviewQualityIdentity::Settled,
            resampling_version: crate::render::resample::RESAMPLE_KERNEL_VERSION,
            encoding_contract: "native-f32",
            display_snapshot: None,
            backend_generation: u64::from(CPU_RENDER_BACKEND_VERSION),
            implementation_version: RENDER_ARTIFACT_ABI_VERSION,
        }
    }

    pub fn fingerprint(&self) -> u64 {
        stable_hash(self)
    }
}

pub fn stable_hash(value: &impl Hash) -> u64 {
    // DefaultHasher is deterministic for a single binary and keys are in-memory only.
    // Persisted artifacts store explicit versioned manifest fields instead.
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    value.hash(&mut hasher);
    hasher.finish()
}

pub fn source_fingerprint_for_path(identity: &str) -> u64 {
    let (source_path, _) = crate::file_management::parse_virtual_path(identity);
    SourceRevision::from_path(&source_path)
        .map(|revision| stable_hash(&(identity, revision)))
        .unwrap_or_else(|_| stable_hash(&identity))
}

#[cfg(test)]
pub(crate) mod tests_support {
    use super::*;
    use std::sync::Arc;

    pub fn source(path: &str) -> SourceArtifactIdentity {
        SourceArtifactIdentity {
            canonical_identity: path.into(),
            physical_identity: path.into(),
            revision: SourceRevision {
                canonical_path: Arc::new(path.into()),
                file_id: None,
                byte_len: 1,
                modified_ns: 1,
                created_ns: None,
                policy: "test",
            },
            decode_contract: 1,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source_revision::{RawProcessingProfileKey, SourceRevision};
    use std::sync::Arc;

    fn source(path: &str, modified_ns: u128) -> SourceArtifactIdentity {
        SourceArtifactIdentity {
            canonical_identity: path.into(),
            physical_identity: path.into(),
            revision: SourceRevision {
                canonical_path: Arc::new(path.into()),
                file_id: None,
                byte_len: 100,
                modified_ns,
                created_ns: None,
                policy: "test",
            },
            decode_contract: 7,
        }
    }

    #[test]
    fn identical_edits_on_two_sources_cannot_alias() {
        let a = RenderArtifactIdentity::source_geometry(&source("a.raw", 1), 1, 9, 2, 3, 100, 80);
        let b = RenderArtifactIdentity::source_geometry(&source("b.raw", 1), 1, 9, 2, 3, 100, 80);
        assert_ne!(a, b);
        assert_ne!(a.fingerprint(), b.fingerprint());
    }

    #[test]
    fn source_revision_session_and_reset_revision_each_invalidate() {
        let base =
            RenderArtifactIdentity::source_geometry(&source("a.raw", 1), 1, 9, 2, 3, 100, 80);
        let changed_source =
            RenderArtifactIdentity::source_geometry(&source("a.raw", 2), 1, 9, 2, 3, 100, 80);
        let reopened =
            RenderArtifactIdentity::source_geometry(&source("a.raw", 1), 2, 9, 2, 3, 100, 80);
        let reset =
            RenderArtifactIdentity::source_geometry(&source("a.raw", 1), 1, 10, 2, 3, 100, 80);
        assert_ne!(base, changed_source);
        assert_ne!(base, reopened);
        assert_ne!(base, reset);
    }

    #[test]
    fn display_identity_is_domain_specific() {
        let scene =
            RenderArtifactIdentity::source_geometry(&source("a.raw", 1), 1, 9, 2, 3, 100, 80);
        let mut display_a = scene.clone();
        display_a.color_domain = ArtifactColorDomain::DisplayEncoded;
        display_a.display_snapshot = Some(11);
        let mut display_b = display_a.clone();
        display_b.display_snapshot = Some(12);
        assert_ne!(display_a, display_b);
        assert_eq!(scene.display_snapshot, None);
    }

    #[test]
    fn decode_contract_is_part_of_source_identity() {
        let profile = |input_transform_version| RawProcessingProfileKey {
            mode: "balanced",
            linear_raw_mode: "off".into(),
            highlight_compression_bits: 0,
            color_nr_bits: 0,
            sharpening_bits: [0; 4],
            camera_profile_resolver_version: "1",
            reconstruction_version: "1",
            demosaic_plan_version: "1",
            decoder_version: "1",
            input_transform_version,
            xyz_to_ap1_version: "1",
            numeric_policy_version: "1",
        };
        assert_ne!(stable_hash(&profile("old")), stable_hash(&profile("new")));
    }

    #[test]
    fn virtual_copies_share_decode_identity_but_not_render_identity() {
        let original = source("a.raw", 1);
        let mut copy = original.clone();
        copy.canonical_identity = "a.raw::copy-2".into();
        assert_eq!(original.decode_fingerprint(), copy.decode_fingerprint());
        assert_ne!(original.source_fingerprint(), copy.source_fingerprint());
    }

    #[test]
    fn request_contract_differences_cannot_alias() {
        let base =
            RenderArtifactIdentity::source_geometry(&source("a.raw", 1), 1, 9, 2, 3, 100, 80);
        let mut changed = base.clone();
        changed.scope = ArtifactScope::Roi {
            x: 1,
            y: 2,
            width: 20,
            height: 10,
        };
        assert_ne!(base, changed);
        changed = base.clone();
        changed.quality = PreviewQualityIdentity::Interactive {
            divisor_bits: 1.5_f32.to_bits(),
        };
        assert_ne!(base, changed);
        changed = base.clone();
        changed.backend_generation += 1;
        assert_ne!(base, changed);
        changed = base.clone();
        changed.implementation_version += 1;
        assert_ne!(base, changed);
        changed = base.clone();
        changed.width += 1;
        assert_ne!(base, changed);
        changed = base.clone();
        changed.resampling_version += 1;
        assert_ne!(base, changed);
    }
}
