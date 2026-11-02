use clap::Parser;
use exposure_cli::{Cli, execute, format_output, sanitize};
use std::io::{self, Write};
use std::process::ExitCode;

fn main() -> ExitCode {
    let cli = Cli::parse();
    match execute(&cli).and_then(|payload| format_output(&cli, &payload)) {
        Ok(output) => match io::stdout().lock().write_all(output.as_bytes()) {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) if error.kind() == io::ErrorKind::BrokenPipe => ExitCode::SUCCESS,
            Err(error) => {
                eprintln!("exposure: {error}");
                ExitCode::FAILURE
            }
        },
        Err(error) => {
            eprintln!("exposure: {}", sanitize(&error));
            ExitCode::FAILURE
        }
    }
}
