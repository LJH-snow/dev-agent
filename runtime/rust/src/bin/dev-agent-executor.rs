use std::io::{self, BufReader};

use dev_agent_runtime::{
    proto,
    proto::dev_agent::executor::{HealthCheckResult, Response},
    read_envelope, write_response, LocalExecutor, SandboxError, SandboxExecutor,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = BufReader::new(stdin.lock());
    let mut writer = stdout.lock();

    let executor = LocalExecutor::new();
    let sandbox_executor = SandboxExecutor::new();

    loop {
        let envelope = match read_envelope(&mut reader) {
            Ok(Some(envelope)) => envelope,
            Ok(None) => break,
            Err(err) => {
                let response = Response {
                    request_id: None,
                    payload: Some(proto::dev_agent::executor::response::Payload::Error(
                        proto::dev_agent::executor::ErrorResult {
                            message: err.to_string(),
                            code: "TRANSPORT_ERROR".to_string(),
                        },
                    )),
                };
                write_response(&mut writer, &response)?;
                break;
            }
        };

        let request_id = envelope.request_id;
        let response = Response {
            request_id,
            payload: match envelope.payload {
                Some(proto::dev_agent::executor::envelope::Payload::Run(run)) => {
                    match executor.run(&run).await {
                        Ok(result) => Some(
                            proto::dev_agent::executor::response::Payload::RunResult(result),
                        ),
                        Err(err) => Some(proto::dev_agent::executor::response::Payload::Error(
                            proto::dev_agent::executor::ErrorResult {
                                message: err.to_string(),
                                code: "EXECUTOR_ERROR".to_string(),
                            },
                        )),
                    }
                }
                Some(proto::dev_agent::executor::envelope::Payload::RunSandboxed(req)) => {
                    let run = req.run.unwrap_or_default();
                    let profile = req.profile.unwrap_or_default();
                    let result = sandbox_executor.run_sandboxed(&run, &profile).await;
                    match result {
                        Ok(result) => Some(
                            proto::dev_agent::executor::response::Payload::RunResult(result),
                        ),
                        Err(err) => {
                            let (code, message) = match &err {
                                SandboxError::PolicyDenied(message) => {
                                    ("POLICY_DENIED", message.clone())
                                }
                                SandboxError::Policy(message) => ("POLICY_ERROR", message.clone()),
                                SandboxError::Executor(err) => ("EXECUTOR_ERROR", err.to_string()),
                            };
                            Some(proto::dev_agent::executor::response::Payload::Error(
                                proto::dev_agent::executor::ErrorResult {
                                    message,
                                    code: code.to_string(),
                                },
                            ))
                        }
                    }
                }
                Some(proto::dev_agent::executor::envelope::Payload::HealthCheck(_)) => Some(
                    proto::dev_agent::executor::response::Payload::HealthCheckResult(
                        HealthCheckResult {
                            runtime_version: env!("CARGO_PKG_VERSION").to_string(),
                            capabilities: vec!["run".to_string(), "run_sandboxed".to_string()],
                        },
                    ),
                ),
                None => Some(proto::dev_agent::executor::response::Payload::Error(
                    proto::dev_agent::executor::ErrorResult {
                        message: "empty envelope".to_string(),
                        code: "INVALID_REQUEST".to_string(),
                    },
                )),
            },
        };

        write_response(&mut writer, &response)?;
    }

    Ok(())
}
