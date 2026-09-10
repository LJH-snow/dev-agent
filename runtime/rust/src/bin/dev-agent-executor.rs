use std::collections::HashMap;
use std::io::{self, BufReader};
use std::sync::Arc;

use tokio::sync::{oneshot, Mutex};

use dev_agent_runtime::local_executor::ExecutorError;
use dev_agent_runtime::proto::dev_agent::executor::{
    envelope::Payload as RequestPayload, response::Payload as ResponsePayload, ErrorResult,
    HealthCheckResult, Response,
};
use dev_agent_runtime::{
    read_envelope, write_response, LocalExecutor, SandboxError, SandboxExecutor,
};

type CancelSenders = Arc<Mutex<HashMap<u32, oneshot::Sender<()>>>>;
type SharedWriter = Arc<Mutex<io::Stdout>>;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let stdin = io::stdin();
    let mut reader = BufReader::new(stdin.lock());
    let writer: SharedWriter = Arc::new(Mutex::new(io::stdout()));
    let pending: CancelSenders = Arc::new(Mutex::new(HashMap::new()));

    // Requests run concurrently so a cancel envelope can be read while a
    // command is still running. Each run keeps a cancellation sender in
    // `pending`, keyed by its request id, until it finishes.
    loop {
        let envelope = match read_envelope(&mut reader) {
            Ok(Some(envelope)) => envelope,
            Ok(None) => break,
            Err(err) => {
                let response = error_response(None, "TRANSPORT_ERROR", err.to_string());
                let mut out = writer.lock().await;
                let _ = write_response(&mut *out, &response);
                break;
            }
        };

        let request_id = envelope.request_id;
        match envelope.payload {
            Some(RequestPayload::Run(run)) => {
                let cancel = register_cancel(&pending, request_id).await;
                let writer = Arc::clone(&writer);
                let pending = Arc::clone(&pending);
                tokio::spawn(async move {
                    let executor = LocalExecutor::new();
                    let response = match executor.run_cancellable(&run, cancel).await {
                        Ok(result) => Response {
                            request_id,
                            payload: Some(ResponsePayload::RunResult(result)),
                        },
                        Err(err) => {
                            error_response(request_id, executor_error_code(&err), err.to_string())
                        }
                    };
                    finish_request(&pending, request_id).await;
                    let mut out = writer.lock().await;
                    let _ = write_response(&mut *out, &response);
                });
            }
            Some(RequestPayload::RunSandboxed(request)) => {
                let cancel = register_cancel(&pending, request_id).await;
                let writer = Arc::clone(&writer);
                let pending = Arc::clone(&pending);
                tokio::spawn(async move {
                    let run = request.run.unwrap_or_default();
                    let profile = request.profile.unwrap_or_default();
                    let executor = SandboxExecutor::new();
                    let response = match executor
                        .run_sandboxed_cancellable(&run, &profile, cancel)
                        .await
                    {
                        Ok(result) => Response {
                            request_id,
                            payload: Some(ResponsePayload::RunResult(result)),
                        },
                        Err(err) => {
                            let (code, message) = sandbox_error(&err);
                            error_response(request_id, code, message)
                        }
                    };
                    finish_request(&pending, request_id).await;
                    let mut out = writer.lock().await;
                    let _ = write_response(&mut *out, &response);
                });
            }
            Some(RequestPayload::Cancel(cancel)) => {
                let sender = pending.lock().await.remove(&cancel.request_id);
                if let Some(sender) = sender {
                    let _ = sender.send(());
                }
            }
            Some(RequestPayload::HealthCheck(_)) => {
                let response = Response {
                    request_id,
                    payload: Some(ResponsePayload::HealthCheckResult(HealthCheckResult {
                        runtime_version: env!("CARGO_PKG_VERSION").to_string(),
                        capabilities: vec![
                            "run".to_string(),
                            "run_sandboxed".to_string(),
                            "cancel".to_string(),
                        ],
                    })),
                };
                let mut out = writer.lock().await;
                write_response(&mut *out, &response)?;
            }
            None => {
                let response =
                    error_response(request_id, "INVALID_REQUEST", "empty envelope".to_string());
                let mut out = writer.lock().await;
                write_response(&mut *out, &response)?;
            }
        }
    }

    Ok(())
}

async fn register_cancel(
    pending: &CancelSenders,
    request_id: Option<u32>,
) -> Option<oneshot::Receiver<()>> {
    let id = request_id?;
    let (sender, receiver) = oneshot::channel();
    pending.lock().await.insert(id, sender);
    Some(receiver)
}

async fn finish_request(pending: &CancelSenders, request_id: Option<u32>) {
    if let Some(id) = request_id {
        pending.lock().await.remove(&id);
    }
}

fn error_response(request_id: Option<u32>, code: &str, message: String) -> Response {
    Response {
        request_id,
        payload: Some(ResponsePayload::Error(ErrorResult {
            message,
            code: code.to_string(),
        })),
    }
}

fn executor_error_code(error: &ExecutorError) -> &'static str {
    match error {
        ExecutorError::Cancelled => "CANCELLED",
        _ => "EXECUTOR_ERROR",
    }
}

fn sandbox_error(error: &SandboxError) -> (&'static str, String) {
    match error {
        SandboxError::PolicyDenied(message) => ("POLICY_DENIED", message.clone()),
        SandboxError::Policy(message) => ("POLICY_ERROR", message.clone()),
        SandboxError::SandboxConfig(message) => ("SANDBOX_CONFIG_ERROR", message.clone()),
        SandboxError::Unsupported(message) => ("SANDBOX_UNSUPPORTED", message.clone()),
        SandboxError::Cancelled => ("CANCELLED", error.to_string()),
        SandboxError::Executor(err) => ("EXECUTOR_ERROR", err.to_string()),
    }
}
