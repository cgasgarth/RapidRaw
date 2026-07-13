use crate::types::{CieXyz, LinearRgb};
use crate::{ReferenceError, finite};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Matrix3(pub [[f64; 3]; 3]);

impl Matrix3 {
    pub fn new(values: [[f64; 3]; 3]) -> Result<Self, ReferenceError> {
        finite(&values.into_iter().flatten().collect::<Vec<_>>())?;
        Ok(Self(values))
    }

    #[must_use]
    pub const fn identity() -> Self {
        Self([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]])
    }

    #[must_use]
    pub fn transform(self, value: [f64; 3]) -> [f64; 3] {
        self.0
            .map(|row| row[0].mul_add(value[0], row[1].mul_add(value[1], row[2] * value[2])))
    }

    #[must_use]
    pub fn multiply(self, right: Self) -> Self {
        Self(std::array::from_fn(|row| {
            std::array::from_fn(|column| {
                (0..3)
                    .map(|index| self.0[row][index] * right.0[index][column])
                    .sum()
            })
        }))
    }

    #[must_use]
    pub fn determinant(self) -> f64 {
        let m = self.0;
        m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
            - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
            + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
    }

    pub fn inverse(self) -> Result<Self, ReferenceError> {
        let m = self.0;
        let determinant = self.determinant();
        if determinant == 0.0 {
            return Err(ReferenceError::SingularMatrix);
        }
        let inverse = [
            [
                m[1][1] * m[2][2] - m[1][2] * m[2][1],
                m[0][2] * m[2][1] - m[0][1] * m[2][2],
                m[0][1] * m[1][2] - m[0][2] * m[1][1],
            ],
            [
                m[1][2] * m[2][0] - m[1][0] * m[2][2],
                m[0][0] * m[2][2] - m[0][2] * m[2][0],
                m[0][2] * m[1][0] - m[0][0] * m[1][2],
            ],
            [
                m[1][0] * m[2][1] - m[1][1] * m[2][0],
                m[0][1] * m[2][0] - m[0][0] * m[2][1],
                m[0][0] * m[1][1] - m[0][1] * m[1][0],
            ],
        ];
        Ok(Self(
            inverse.map(|row| row.map(|value| value / determinant)),
        ))
    }
}

/// A matrix whose declared contract maps linear-light RGB to CIE XYZ.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LinearRgbToXyzMatrix(Matrix3);

impl LinearRgbToXyzMatrix {
    pub fn new(values: [[f64; 3]; 3]) -> Result<Self, ReferenceError> {
        Ok(Self(Matrix3::new(values)?))
    }

    pub fn transform(self, rgb: LinearRgb) -> Result<CieXyz, ReferenceError> {
        let [x, y, z] = self.0.transform(rgb.components());
        CieXyz::new(x, y, z)
    }

    #[must_use]
    pub const fn matrix(self) -> Matrix3 {
        self.0
    }
}
