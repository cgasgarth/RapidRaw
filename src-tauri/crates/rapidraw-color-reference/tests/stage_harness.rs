use rapidraw_color_reference::{
    ReferenceError,
    harness::{
        REFERENCE_IMPLEMENTATION_VERSION, ReferenceOperation, STAGE_HARNESS_CONTRACT_ID,
        StageDomain, StageImplementation, StageSample, StageVectorRequest, compare_stage_outputs,
        execute_reference_batch, execute_reference_pipeline, execute_reference_stage,
    },
    transfer::linear_to_srgb_channel,
    types::{CieLab, ICtCp},
};

fn request(operation: ReferenceOperation, samples: Vec<StageSample>) -> StageVectorRequest {
    let (input_domain, output_domain) = operation.domains();
    StageVectorRequest {
        operation,
        implementation: StageImplementation::ReferenceF64,
        implementation_version: REFERENCE_IMPLEMENTATION_VERSION,
        input_domain,
        output_domain,
        samples,
    }
}

#[test]
fn batch_dispatches_transforms_and_metrics_with_auditable_receipts() {
    let transform = request(
        ReferenceOperation::DecodeSrgbV1,
        vec![StageSample::Rgb([-0.1292, 0.5, 1.2])],
    );
    let metric = request(
        ReferenceOperation::DeltaE2000V1,
        vec![StageSample::LabPair(
            CieLab::new(50.0, 2.6772, -79.7751).unwrap(),
            CieLab::new(50.0, 0.0, -82.7485).unwrap(),
        )],
    );

    let results = execute_reference_batch(&[transform, metric]).unwrap();
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].receipt.contract_id, STAGE_HARNESS_CONTRACT_ID);
    assert_eq!(results[0].receipt.operation_id, "decode-srgb.v1");
    assert_eq!(
        results[0].receipt.implementation_id,
        "rapidraw.reference-f64"
    );
    assert_eq!(results[0].receipt.input_hash.to_hex().len(), 64);
    assert_eq!(results[0].receipt.output_hash.to_hex().len(), 64);
    assert_eq!(results[0].receipt.diagnostics.negative_input_components, 1);
    assert_eq!(
        results[0].receipt.diagnostics.over_range_input_components,
        1
    );
    assert_eq!(results[0].receipt.diagnostics.clamps_applied, 0);
    assert_ne!(
        results[0].receipt.input_hash,
        results[0].receipt.output_hash
    );
    assert!(
        matches!(results[1].output[0], StageSample::Scalar(value) if (value - 2.0425).abs() < 0.0001)
    );
}

#[test]
fn hashes_change_when_stage_input_changes() {
    let first = execute_reference_stage(&request(
        ReferenceOperation::EncodeSrgbV1,
        vec![StageSample::Rgb([0.18, 0.5, 1.0])],
    ))
    .unwrap();
    let second = execute_reference_stage(&request(
        ReferenceOperation::EncodeSrgbV1,
        vec![StageSample::Rgb([0.180_001, 0.5, 1.0])],
    ))
    .unwrap();
    assert_ne!(first.receipt.input_hash, second.receipt.input_hash);
    assert_ne!(first.receipt.output_hash, second.receipt.output_hash);
}

#[test]
fn implementation_version_domain_and_sample_kind_fail_closed() {
    let valid = request(
        ReferenceOperation::DecodeSrgbV1,
        vec![StageSample::Rgb([0.0, 0.5, 1.0])],
    );

    let mut candidate = valid.clone();
    candidate.implementation = StageImplementation::ProductionCandidate;
    assert_eq!(
        execute_reference_stage(&candidate),
        Err(ReferenceError::UnsupportedImplementation)
    );

    let mut future = valid.clone();
    future.implementation_version += 1;
    assert_eq!(
        execute_reference_stage(&future),
        Err(ReferenceError::UnsupportedVersion)
    );

    let mut wrong_domain = valid.clone();
    wrong_domain.input_domain = StageDomain::LinearSrgb;
    assert_eq!(
        execute_reference_stage(&wrong_domain),
        Err(ReferenceError::StageDomainMismatch)
    );

    let wrong_kind = request(
        ReferenceOperation::DecodeSrgbV1,
        vec![StageSample::Scalar(0.5)],
    );
    assert_eq!(
        execute_reference_stage(&wrong_kind),
        Err(ReferenceError::MismatchedSampleKind)
    );
    assert_eq!(
        execute_reference_batch(&[]),
        Err(ReferenceError::EmptyBatch)
    );
}

#[test]
fn pipeline_rejects_an_injected_double_transfer() {
    let decode = request(
        ReferenceOperation::DecodeSrgbV1,
        vec![StageSample::Rgb([0.25, 0.5, 0.75])],
    );
    assert_eq!(
        execute_reference_pipeline(&[decode.clone(), decode]),
        Err(ReferenceError::StageDomainMismatch)
    );
}

#[test]
fn comparison_detects_premature_clamping_and_wrong_kinds() {
    let reference = execute_reference_stage(&request(
        ReferenceOperation::EncodeSrgbV1,
        vec![StageSample::Rgb([-0.1, 2.0, 0.5])],
    ))
    .unwrap();
    let candidate = reference
        .output
        .iter()
        .map(|sample| match sample {
            StageSample::Rgb(rgb) => StageSample::Rgb(rgb.map(|value| value.clamp(0.0, 1.0))),
            _ => unreachable!(),
        })
        .collect::<Vec<_>>();
    let comparison = compare_stage_outputs(&reference.output, &candidate, 1e-12).unwrap();
    assert_eq!(comparison.mismatched_components, 2);
    assert_eq!(comparison.premature_clamp_components, 2);
    assert!(comparison.maximum_absolute_error > 1.0);

    assert_eq!(
        compare_stage_outputs(
            &[StageSample::Rgb([1.0, 2.0, 3.0])],
            &[StageSample::LabPair(
                CieLab::new(1.0, 2.0, 3.0).unwrap(),
                CieLab::new(4.0, 5.0, 6.0).unwrap(),
            )],
            0.0,
        ),
        Err(ReferenceError::MismatchedSampleKind)
    );
}

#[test]
fn hdr_metric_dispatch_preserves_typed_ictcp_pairs() {
    let result = execute_reference_stage(&request(
        ReferenceOperation::DeltaEItpV1,
        vec![StageSample::ICtCpPair(
            ICtCp::new(0.5, 0.01, -0.02).unwrap(),
            ICtCp::new(0.6, 0.02, -0.01).unwrap(),
        )],
    ))
    .unwrap();
    assert!(matches!(result.output[0], StageSample::Scalar(value) if value > 0.0));
}

#[test]
fn rec2100_absolute_stage_produces_typed_ictcp_with_auditable_domains() {
    let result = execute_reference_stage(&request(
        ReferenceOperation::Rec2100NitsToICtCpV1,
        vec![StageSample::Rgb([100.0, 100.0, 100.0])],
    ))
    .unwrap();
    assert_eq!(
        result.receipt.input_domain,
        StageDomain::LinearRec2100Absolute
    );
    assert_eq!(result.receipt.output_domain, StageDomain::ICtCp);
    assert_eq!(result.receipt.operation_id, "rec2100-nits-to-ictcp.v1");
    assert!(matches!(
        result.output[0],
        StageSample::ICtCp(value)
            if value.intensity > 0.0 && value.tritan.abs() < 2.0e-15 && value.protan.abs() < 2.0e-15
    ));
}

#[test]
fn every_declared_transform_dispatches_with_its_typed_domain() {
    let cases = [
        request(
            ReferenceOperation::AcesCgToXyzD60V1,
            vec![StageSample::Rgb([0.18, 0.18, 0.18])],
        ),
        request(ReferenceOperation::PqEotfV1, vec![StageSample::Scalar(0.5)]),
        request(
            ReferenceOperation::PqInverseEotfV1,
            vec![StageSample::Scalar(100.0)],
        ),
        request(
            ReferenceOperation::HlgOetfV1,
            vec![StageSample::Scalar(0.18)],
        ),
        request(
            ReferenceOperation::HlgInverseOetfV1,
            vec![StageSample::Scalar(0.75)],
        ),
    ];
    let results = execute_reference_batch(&cases).unwrap();
    assert_eq!(results.len(), cases.len());
    for (request, result) in cases.iter().zip(results) {
        assert_eq!(result.receipt.input_domain, request.input_domain);
        assert_eq!(result.receipt.output_domain, request.output_domain);
        assert_eq!(result.receipt.sample_count, 1);
    }
}

#[test]
fn s_rgb_stage_outputs_match_the_published_channel_equation() {
    let inputs = [-0.1, 0.0, 0.003_130_8, 0.18, 1.0, 2.0];
    let result = execute_reference_stage(&request(
        ReferenceOperation::EncodeSrgbV1,
        inputs
            .chunks(3)
            .map(|values| StageSample::Rgb([values[0], values[1], values[2]]))
            .collect(),
    ))
    .unwrap();
    let expected = inputs.map(linear_to_srgb_channel);
    let actual = result
        .output
        .iter()
        .flat_map(|sample| match sample {
            StageSample::Rgb(rgb) => rgb.as_slice(),
            _ => unreachable!(),
        })
        .copied()
        .collect::<Vec<_>>();
    assert_eq!(actual, expected);
}
