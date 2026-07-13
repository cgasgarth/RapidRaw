use std::{env, path::Path, process::ExitCode};

use rapidraw_color_reference::baseline::{ApprovalMetadata, approve, compare_files, load_baseline};

fn main() -> ExitCode {
    match run(env::args().skip(1).collect()) {
        Ok(output) => {
            println!("{output}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run(arguments: Vec<String>) -> Result<String, String> {
    match arguments.as_slice() {
        [command, baseline, candidate] if command == "compare" => {
            let report = compare_files(Path::new(baseline), Path::new(candidate))
                .map_err(|error| error.to_string())?;
            if !report.passed {
                return Err(report.explanation);
            }
            serde_json::to_string_pretty(&report).map_err(|error| error.to_string())
        }
        [command, baseline, candidate] if command == "explain" => {
            let report = compare_files(Path::new(baseline), Path::new(candidate))
                .map_err(|error| error.to_string())?;
            Ok(report.explanation)
        }
        [command, baseline, candidate, reviewer_flag, reviewer, issue_flag, issue, reason_flag, reason]
            if command == "approve"
                && reviewer_flag == "--reviewer"
                && issue_flag == "--issue"
                && reason_flag == "--reason" =>
        {
            let updated = approve(
                Path::new(baseline),
                Path::new(candidate),
                ApprovalMetadata {
                    reviewer: reviewer.clone(),
                    issue: issue.clone(),
                    reason: reason.clone(),
                },
            )
            .map_err(|error| error.to_string())?;
            Ok(format!(
                "approved baseline atomically; audit records: {}",
                updated.approvals.len()
            ))
        }
        [command, baseline] if command == "inspect" => {
            let manifest = load_baseline(Path::new(baseline)).map_err(|error| error.to_string())?;
            serde_json::to_string_pretty(&manifest).map_err(|error| error.to_string())
        }
        _ => Err("usage: rapidraw-color-baseline compare|explain <baseline> <candidate> | approve <baseline> <candidate> --reviewer <name> --issue <url-or-number> --reason <text> | inspect <baseline>".to_owned()),
    }
}
