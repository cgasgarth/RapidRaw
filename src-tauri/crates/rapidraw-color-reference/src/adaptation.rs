use crate::{
    ReferenceError,
    matrix::Matrix3,
    types::{CieXyz, WhitePointXyz},
};

/// Bradford cone-response matrix from ICC.1:2022 Annex E.
pub const BRADFORD: Matrix3 = Matrix3([
    [0.8951, 0.2664, -0.1614],
    [-0.7502, 1.7135, 0.0367],
    [0.0389, -0.0685, 1.0296],
]);

/// CAT16 cone-response matrix from Li et al. (2017), DOI 10.1002/col.22131.
pub const CAT16: Matrix3 = Matrix3([
    [0.401_288, 0.650_173, -0.051_461],
    [-0.250_268, 1.204_414, 0.045_854],
    [-0.002_079, 0.048_952, 0.953_127],
]);

/// Computes the full von Kries/Bradford source-XYZ to destination-XYZ adaptation matrix.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ChromaticAdaptationMatrix(Matrix3);

impl ChromaticAdaptationMatrix {
    pub fn adapt(self, xyz: CieXyz) -> Result<CieXyz, ReferenceError> {
        let [x, y, z] = self.0.transform(xyz.components());
        CieXyz::new(x, y, z)
    }

    #[must_use]
    pub const fn matrix(self) -> Matrix3 {
        self.0
    }
}

pub fn bradford_adaptation(
    source: WhitePointXyz,
    destination: WhitePointXyz,
) -> Result<ChromaticAdaptationMatrix, ReferenceError> {
    full_von_kries_adaptation(BRADFORD, source, destination)
}

/// Full-adaptation (`D = 1`) CAT16 source-XYZ to destination-XYZ matrix.
pub fn cat16_adaptation(
    source: WhitePointXyz,
    destination: WhitePointXyz,
) -> Result<ChromaticAdaptationMatrix, ReferenceError> {
    full_von_kries_adaptation(CAT16, source, destination)
}

fn full_von_kries_adaptation(
    cone_matrix: Matrix3,
    source: WhitePointXyz,
    destination: WhitePointXyz,
) -> Result<ChromaticAdaptationMatrix, ReferenceError> {
    let source_cones = cone_matrix.transform(source.xyz().components());
    let destination_cones = cone_matrix.transform(destination.xyz().components());
    if source_cones.contains(&0.0) {
        return Err(ReferenceError::ZeroConeResponse);
    }
    let scale = Matrix3([
        [destination_cones[0] / source_cones[0], 0.0, 0.0],
        [0.0, destination_cones[1] / source_cones[1], 0.0],
        [0.0, 0.0, destination_cones[2] / source_cones[2]],
    ]);
    Ok(ChromaticAdaptationMatrix(
        cone_matrix.inverse()?.multiply(scale).multiply(cone_matrix),
    ))
}
