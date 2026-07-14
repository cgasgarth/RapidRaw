//! Typed device-generation boundary for GPU execution.
//!
//! The processor remains the implementation of the existing kernels, while this module owns
//! the small orchestration contract that every device-owned service must use: capabilities are
//! checked before preparation and a lease carries the exact runtime/source identity through
//! execution. A lease from a prior device generation can never be published as current.

use std::fmt;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct GpuRuntimeIdentity {
    pub device_generation: u64,
    pub processor_generation: u64,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct GpuRuntimeCapabilities {
    pub max_texture_dimension_2d: u32,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct GpuFrameIdentity {
    pub source_revision: u64,
    pub stage_revision: u64,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct GpuExecutionLease {
    runtime: GpuRuntimeIdentity,
    frame: GpuFrameIdentity,
}

impl GpuExecutionLease {
    pub fn is_current(self, runtime: GpuRuntimeIdentity, frame: GpuFrameIdentity) -> bool {
        self.runtime == runtime && self.frame == frame
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GpuRuntimeError {
    ImageExceedsDeviceLimit {
        width: u32,
        height: u32,
        max_texture_dimension_2d: u32,
    },
    EmptyImage,
}

impl fmt::Display for GpuRuntimeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ImageExceedsDeviceLimit {
                width,
                height,
                max_texture_dimension_2d,
            } => write!(
                formatter,
                "GPU frame {}x{} exceeds device texture limit {}",
                width, height, max_texture_dimension_2d
            ),
            Self::EmptyImage => formatter.write_str("GPU frame dimensions must be non-zero"),
        }
    }
}

pub struct GpuExecutionOrchestrator {
    runtime: GpuRuntimeIdentity,
    capabilities: GpuRuntimeCapabilities,
}

impl GpuExecutionOrchestrator {
    pub fn new(runtime: GpuRuntimeIdentity, capabilities: GpuRuntimeCapabilities) -> Self {
        Self {
            runtime,
            capabilities,
        }
    }

    pub fn runtime(&self) -> GpuRuntimeIdentity {
        self.runtime
    }

    pub fn begin(&mut self, frame: GpuFrameIdentity) -> Result<GpuExecutionLease, GpuRuntimeError> {
        if frame.width == 0 || frame.height == 0 {
            return Err(GpuRuntimeError::EmptyImage);
        }
        if frame.width > self.capabilities.max_texture_dimension_2d
            || frame.height > self.capabilities.max_texture_dimension_2d
        {
            return Err(GpuRuntimeError::ImageExceedsDeviceLimit {
                width: frame.width,
                height: frame.height,
                max_texture_dimension_2d: self.capabilities.max_texture_dimension_2d,
            });
        }
        Ok(GpuExecutionLease {
            runtime: self.runtime,
            frame,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RUNTIME: GpuRuntimeIdentity = GpuRuntimeIdentity {
        device_generation: 7,
        processor_generation: 3,
    };
    const FRAME: GpuFrameIdentity = GpuFrameIdentity {
        source_revision: 11,
        stage_revision: 13,
        width: 64,
        height: 32,
    };

    #[test]
    fn lease_rejects_device_or_source_replacement() {
        let mut orchestrator = GpuExecutionOrchestrator::new(
            RUNTIME,
            GpuRuntimeCapabilities {
                max_texture_dimension_2d: 1024,
            },
        );
        let lease = orchestrator.begin(FRAME).unwrap();
        assert!(lease.is_current(RUNTIME, FRAME));
        assert!(!lease.is_current(
            GpuRuntimeIdentity {
                device_generation: 8,
                ..RUNTIME
            },
            FRAME
        ));
        assert!(!lease.is_current(
            RUNTIME,
            GpuFrameIdentity {
                source_revision: 12,
                ..FRAME
            }
        ));
    }

    #[test]
    fn capability_boundary_fails_closed() {
        let mut orchestrator = GpuExecutionOrchestrator::new(
            RUNTIME,
            GpuRuntimeCapabilities {
                max_texture_dimension_2d: 16,
            },
        );
        assert_eq!(
            orchestrator.begin(FRAME),
            Err(GpuRuntimeError::ImageExceedsDeviceLimit {
                width: 64,
                height: 32,
                max_texture_dimension_2d: 16,
            })
        );
    }
}
