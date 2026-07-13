use std::{env, path::PathBuf, process::ExitCode};

use rapidraw_color_reference::{
    baseline::HardwareIdentity,
    lab::{ColorLabConfig, ColorLabTier, human_report, run_color_lab, write_reports},
};

fn main() -> ExitCode {
    match run(env::args().skip(1).collect()) {
        Ok((report, passed)) => {
            print!("{report}");
            if passed {
                ExitCode::SUCCESS
            } else {
                ExitCode::FAILURE
            }
        }
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run(arguments: Vec<String>) -> Result<(String, bool), String> {
    if arguments.first().map(String::as_str) != Some("run") {
        return Err(usage());
    }
    let mut tier = None;
    let mut graph_fingerprint = None;
    let mut output = None;
    let mut cache_directory = None;
    let mut baseline_path = None;
    let mut no_cache = false;
    let mut affected_fixtures = Vec::new();
    let mut backend = None;
    let mut vendor = None;
    let mut device = None;
    let mut driver = None;
    let mut index = 1;
    while index < arguments.len() {
        match arguments[index].as_str() {
            "--affected" => tier = Some(ColorLabTier::Fast),
            "--full" => tier = Some(ColorLabTier::Full),
            "--hardware" => tier = Some(ColorLabTier::Hardware),
            "--no-cache" => no_cache = true,
            "--graph" => graph_fingerprint = Some(next_value(&arguments, &mut index)?),
            "--output" => output = Some(PathBuf::from(next_value(&arguments, &mut index)?)),
            "--cache" => {
                cache_directory = Some(PathBuf::from(next_value(&arguments, &mut index)?));
            }
            "--baseline" => {
                baseline_path = Some(PathBuf::from(next_value(&arguments, &mut index)?));
            }
            "--fixture" => affected_fixtures.push(next_value(&arguments, &mut index)?),
            "--backend" => backend = Some(next_value(&arguments, &mut index)?),
            "--vendor" => vendor = Some(next_value(&arguments, &mut index)?),
            "--device" => device = Some(next_value(&arguments, &mut index)?),
            "--driver" => driver = Some(next_value(&arguments, &mut index)?),
            _ => return Err(usage()),
        }
        index += 1;
    }
    let hardware = match (backend, vendor, device, driver) {
        (None, None, None, None) => None,
        (Some(backend), Some(vendor), Some(device), Some(driver)) => Some(HardwareIdentity {
            backend,
            vendor,
            device,
            driver,
        }),
        _ => {
            return Err(
                "hardware identity requires --backend, --vendor, --device, and --driver".into(),
            );
        }
    };
    let config = ColorLabConfig {
        tier: tier.ok_or_else(usage)?,
        graph_fingerprint: graph_fingerprint.ok_or_else(usage)?,
        affected_fixtures,
        hardware,
        baseline_path,
        cache_directory,
        no_cache,
    };
    let output = output.ok_or_else(usage)?;
    let report = run_color_lab(&config).map_err(|error| error.to_string())?;
    write_reports(&output, &report).map_err(|error| error.to_string())?;
    let passed = report.passed;
    Ok((human_report(&report), passed))
}

fn next_value(arguments: &[String], index: &mut usize) -> Result<String, String> {
    *index += 1;
    arguments.get(*index).cloned().ok_or_else(usage)
}

fn usage() -> String {
    "usage: color-lab run (--affected|--full|--hardware) --graph <sha256> --output <directory> [--cache <directory>] [--no-cache] [--baseline <manifest>] [--fixture <id>] [--backend <name> --vendor <name> --device <name> --driver <version>]".into()
}
