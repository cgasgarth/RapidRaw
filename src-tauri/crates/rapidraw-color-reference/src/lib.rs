//! Auditable, dependency-free f64 color-science reference equations.
//!
//! This crate is deliberately independent from RapidRaw's production CPU and GPU implementations.
//! It favors direct published equations over optimized approximations.

#![forbid(unsafe_code)]

pub mod adaptation;
pub mod artistic;
pub mod baseline;
pub mod dcp;
pub mod difference;
pub mod fixtures;
pub mod harness;
pub mod hdr;
pub mod lab;
pub mod matrix;
pub mod metrics;
pub mod output;
pub mod perceptual;
pub mod transfer;
pub mod types;

pub const REFERENCE_CONTRACT_ID: &str = "rapidraw.color-reference.v1";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReferenceError {
    NonFiniteInput,
    SingularMatrix,
    ZeroChromaticityY,
    ZeroConeResponse,
    NonPositiveWhitePoint,
    NegativeLuminance,
    NegativeSignal,
    UndefinedTransferDomain,
    CoincidentIlluminants,
    InvalidTableDimensions,
    InvalidTableLength,
    NegativeScale,
    OutOfDomain,
    InsufficientSamples,
    NonIncreasingInput,
    InvalidMetricCondition,
    MismatchedSampleLength,
    UnsupportedImplementation,
    UnsupportedVersion,
    StageDomainMismatch,
    EmptyBatch,
    MismatchedSampleKind,
    MismatchedOutputLength,
}

pub(crate) fn finite(values: &[f64]) -> Result<(), ReferenceError> {
    if values.iter().all(|value| value.is_finite()) {
        Ok(())
    } else {
        Err(ReferenceError::NonFiniteInput)
    }
}
