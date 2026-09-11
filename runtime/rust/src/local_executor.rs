use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot};
use tokio::time::timeout;

use crate::proto::dev_agent::executor::{RunRequest, RunResult};

#[derive(Debug, thiserror::Error)]
pub enum ExecutorError {
    #[error("command must not be empty")]
    EmptyCommand,
    #[error("execution error: {0}")]
    Io(#[from] std::io::Error),
    #[error("command cancelled")]
    Cancelled,
}

/// Bytes captured per output stream when the client does not ask for a
/// specific limit. Matches the TypeScript `LocalExecutor` default.
pub const DEFAULT_MAX_OUTPUT_BYTES: usize = 1_000_000;

/// How long a command gets to exit on SIGTERM before it is killed outright.
const TERMINATION_GRACE: Duration = Duration::from_secs(2);

pub struct LocalExecutor;

impl LocalExecutor {
    pub fn new() -> Self {
        Self
    }

    pub async fn run(&self, request: &RunRequest) -> Result<RunResult, ExecutorError> {
        self.run_cancellable(request, None).await
    }

    /// Runs a command that can be stopped early through `cancel`.
    ///
    /// Dropping the sender without sending is not a cancellation: the receiver
    /// resolves and the run stops only when a value is actually sent.
    pub async fn run_cancellable(
        &self,
        request: &RunRequest,
        cancel: Option<oneshot::Receiver<()>>,
    ) -> Result<RunResult, ExecutorError> {
        self.run_with_builder(request, || Command::new(&request.command), cancel)
            .await
    }

    pub(crate) async fn run_with_builder(
        &self,
        request: &RunRequest,
        build: impl FnOnce() -> Command,
        cancel: Option<oneshot::Receiver<()>>,
    ) -> Result<RunResult, ExecutorError> {
        if request.command.trim().is_empty() {
            return Err(ExecutorError::EmptyCommand);
        }

        let mut command = build();
        command.args(&request.args);
        command.stdin(Stdio::piped());
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());
        command.kill_on_drop(true);
        // Each command leads its own process group so a cancel or timeout can
        // reach the whole tree (sandbox wrappers included) instead of leaving
        // grandchildren behind.
        #[cfg(unix)]
        command.process_group(0);

        if let Some(cwd) = &request.cwd {
            command.current_dir(cwd);
        }

        for (key, value) in &request.env {
            command.env(key, value);
        }

        let mut child = command.spawn().map_err(ExecutorError::Io)?;

        if let Some(input) = &request.input {
            if let Some(stdin) = child.stdin.as_mut() {
                stdin
                    .write_all(input.as_bytes())
                    .await
                    .map_err(ExecutorError::Io)?;
            }
        }
        if let Some(stdin) = child.stdin.as_mut() {
            stdin.shutdown().await.ok();
        }

        // Stream both pipes instead of waiting for the whole output to be
        // buffered, so a chatty command cannot grow the runtime's memory
        // without bound.
        let max_output_bytes = request
            .max_output_bytes
            .map(|value| usize::try_from(value).unwrap_or(usize::MAX))
            .unwrap_or(DEFAULT_MAX_OUTPUT_BYTES);
        let (truncate_tx, mut truncate_rx) = mpsc::channel::<()>(1);
        let stdout_task = tokio::spawn(read_capped(
            child.stdout.take(),
            max_output_bytes,
            truncate_tx.clone(),
        ));
        let stderr_task = tokio::spawn(read_capped(
            child.stderr.take(),
            max_output_bytes,
            truncate_tx,
        ));

        let outcome = match request.timeout_ms {
            Some(millis) => {
                let duration = Duration::from_millis(millis);
                match timeout(
                    duration,
                    wait_for_exit(&mut child, &mut truncate_rx, cancel),
                )
                .await
                {
                    Ok(outcome) => outcome.map_err(ExecutorError::Io)?,
                    Err(_) => {
                        terminate(&mut child).await;
                        WaitOutcome::TimedOut
                    }
                }
            }
            None => wait_for_exit(&mut child, &mut truncate_rx, cancel)
                .await
                .map_err(ExecutorError::Io)?,
        };

        let (stdout_bytes, stdout_truncated) = join_output(stdout_task).await;
        let (stderr_bytes, stderr_truncated) = join_output(stderr_task).await;

        match outcome {
            WaitOutcome::Exited(status) => Ok(RunResult {
                stdout: String::from_utf8_lossy(&stdout_bytes).into_owned(),
                stderr: String::from_utf8_lossy(&stderr_bytes).into_owned(),
                exit_code: status.code().unwrap_or(-1),
                timed_out: false,
                bytes_truncated: stdout_truncated || stderr_truncated,
            }),
            WaitOutcome::TimedOut => Ok(RunResult {
                stdout: String::new(),
                stderr: "command timed out".to_string(),
                exit_code: -1,
                timed_out: true,
                bytes_truncated: false,
            }),
            WaitOutcome::Cancelled => Err(ExecutorError::Cancelled),
        }
    }
}

enum WaitOutcome {
    Exited(std::process::ExitStatus),
    TimedOut,
    Cancelled,
}

/// Waits for the child to exit, killing it early when a reader reports that the
/// capture limit was hit or when a cancellation arrives. Without the kill the
/// child could block forever writing into a pipe nobody reads.
async fn wait_for_exit(
    child: &mut Child,
    truncate_rx: &mut mpsc::Receiver<()>,
    cancel: Option<oneshot::Receiver<()>>,
) -> std::io::Result<WaitOutcome> {
    let cancel_wait = async move {
        match cancel {
            Some(receiver) => {
                if receiver.await.is_ok() {
                    return;
                }
                // The sender was dropped without cancelling: never resolve, so
                // the select keeps waiting for the command itself.
                std::future::pending::<()>().await;
            }
            None => std::future::pending::<()>().await,
        }
    };
    tokio::pin!(cancel_wait);

    tokio::select! {
        status = child.wait() => Ok(WaitOutcome::Exited(status?)),
        signal = truncate_rx.recv() => {
            if signal.is_some() {
                let _ = child.kill().await;
            }
            Ok(WaitOutcome::Exited(child.wait().await?))
        }
        _ = &mut cancel_wait => {
            terminate(child).await;
            Ok(WaitOutcome::Cancelled)
        }
    }
}

/// Stops a running command: SIGTERM to its process group first so it can clean
/// up, then SIGKILL when it is still alive after the grace period.
async fn terminate(child: &mut Child) {
    #[cfg(unix)]
    {
        if let Some(pid) = child.id() {
            // The child leads its own group (see `process_group(0)`), so the
            // group id is its pid.
            unsafe {
                libc::killpg(pid as libc::pid_t, libc::SIGTERM);
            }
        }
        if timeout(TERMINATION_GRACE, child.wait()).await.is_ok() {
            return;
        }
    }

    let _ = child.kill().await;
    let _ = child.wait().await;
}

/// Reads a child stream into memory, stopping once `limit` bytes were captured.
/// The returned flag reports whether more data was available (or would have
/// been), which is what marks the run as truncated on the wire.
async fn read_capped<R: AsyncRead + Unpin>(
    reader: Option<R>,
    limit: usize,
    truncate_tx: mpsc::Sender<()>,
) -> (Vec<u8>, bool) {
    let Some(mut reader) = reader else {
        return (Vec::new(), false);
    };

    let mut captured = Vec::new();
    let mut chunk = [0u8; 8192];
    let mut truncated = false;

    loop {
        match reader.read(&mut chunk).await {
            Ok(0) => break,
            Ok(read) => {
                let remaining = limit.saturating_sub(captured.len());
                if read > remaining {
                    captured.extend_from_slice(&chunk[..remaining]);
                    truncated = true;
                    let _ = truncate_tx.try_send(());
                    break;
                }
                captured.extend_from_slice(&chunk[..read]);
            }
            Err(_) => break,
        }
    }

    (captured, truncated)
}

/// Collects a reader task's result, falling back to empty output if the task
/// was cancelled or panicked so a broken pipe never fails the whole run.
async fn join_output(handle: tokio::task::JoinHandle<(Vec<u8>, bool)>) -> (Vec<u8>, bool) {
    handle.await.unwrap_or_default()
}

impl Default for LocalExecutor {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_request(command: &str, args: &[&str]) -> RunRequest {
        RunRequest {
            command: command.to_string(),
            args: args.iter().map(|s| s.to_string()).collect(),
            cwd: None,
            env: std::collections::HashMap::new(),
            input: None,
            timeout_ms: None,
            max_output_bytes: None,
        }
    }

    #[tokio::test]
    async fn local_executor_runs_echo() {
        let executor = LocalExecutor::new();
        let result = executor
            .run(&fake_request("echo", &["hello"]))
            .await
            .unwrap();
        assert_eq!(result.stdout.trim(), "hello");
        assert_eq!(result.stderr, "");
        assert_eq!(result.exit_code, 0);
        assert!(!result.timed_out);
    }

    #[tokio::test]
    async fn local_executor_returns_exit_code() {
        let executor = LocalExecutor::new();
        let result = executor.run(&fake_request("false", &[])).await.unwrap();
        assert_eq!(result.exit_code, 1);
    }

    #[tokio::test]
    async fn local_executor_rejects_empty_command() {
        let executor = LocalExecutor::new();
        let result = executor.run(&fake_request("", &[])).await;
        assert!(matches!(result, Err(ExecutorError::EmptyCommand)));
    }

    #[tokio::test]
    async fn local_executor_honors_timeout() {
        let executor = LocalExecutor::new();
        let result = executor
            .run(&RunRequest {
                command: "sleep".to_string(),
                args: vec!["10".to_string()],
                cwd: None,
                env: std::collections::HashMap::new(),
                input: None,
                timeout_ms: Some(50),
                max_output_bytes: None,
            })
            .await
            .unwrap();
        assert!(result.timed_out);
        assert_eq!(result.exit_code, -1);
    }

    #[tokio::test]
    async fn local_executor_truncates_output_at_the_configured_limit() {
        let executor = LocalExecutor::new();
        let result = executor
            .run(&RunRequest {
                command: "yes".to_string(),
                args: vec![],
                cwd: None,
                env: std::collections::HashMap::new(),
                input: None,
                timeout_ms: Some(10_000),
                max_output_bytes: Some(1024),
            })
            .await
            .unwrap();
        assert!(result.bytes_truncated);
        assert_eq!(result.stdout.len(), 1024);
        assert!(!result.timed_out);
    }

    #[tokio::test]
    async fn local_executor_keeps_output_within_the_limit() {
        let executor = LocalExecutor::new();
        let result = executor
            .run(&RunRequest {
                command: "echo".to_string(),
                args: vec!["hello".to_string()],
                cwd: None,
                env: std::collections::HashMap::new(),
                input: None,
                timeout_ms: None,
                max_output_bytes: Some(1024),
            })
            .await
            .unwrap();
        assert_eq!(result.stdout, "hello\n");
        assert!(!result.bytes_truncated);
    }

    #[tokio::test]
    async fn local_executor_applies_a_default_limit_when_absent() {
        let executor = LocalExecutor::new();
        let result = executor
            .run(&RunRequest {
                command: "yes".to_string(),
                args: vec![],
                cwd: None,
                env: std::collections::HashMap::new(),
                input: None,
                timeout_ms: Some(10_000),
                max_output_bytes: None,
            })
            .await
            .unwrap();
        assert!(result.bytes_truncated);
        assert_eq!(result.stdout.len(), DEFAULT_MAX_OUTPUT_BYTES);
    }

    #[tokio::test]
    async fn local_executor_does_not_truncate_output_that_exactly_fills_the_limit() {
        let executor = LocalExecutor::new();
        let result = executor
            .run(&RunRequest {
                command: "/bin/sh".to_string(),
                args: vec!["-c".to_string(), "head -c 1024 /dev/zero".to_string()],
                cwd: None,
                env: std::collections::HashMap::new(),
                input: None,
                timeout_ms: None,
                max_output_bytes: Some(1024),
            })
            .await
            .unwrap();
        assert_eq!(result.stdout.len(), 1024);
        assert!(!result.bytes_truncated);
    }

    #[tokio::test]
    async fn local_executor_cancels_a_running_command() {
        let executor = LocalExecutor::new();
        let (sender, receiver) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            let _ = sender.send(());
        });

        let started = std::time::Instant::now();
        let result = executor
            .run_cancellable(&fake_request("sleep", &["10"]), Some(receiver))
            .await;

        assert!(matches!(result, Err(ExecutorError::Cancelled)));
        assert!(started.elapsed() < std::time::Duration::from_secs(2));
    }

    #[tokio::test]
    async fn dropping_the_cancel_sender_does_not_cancel_the_command() {
        let executor = LocalExecutor::new();
        let (sender, receiver) = tokio::sync::oneshot::channel::<()>();
        drop(sender);

        let result = executor
            .run_cancellable(&fake_request("echo", &["still-runs"]), Some(receiver))
            .await
            .unwrap();

        assert_eq!(result.stdout.trim(), "still-runs");
        assert_eq!(result.exit_code, 0);
    }

    #[tokio::test]
    async fn cancel_escalates_to_sigkill_when_sigterm_is_ignored() {
        let executor = LocalExecutor::new();
        let (sender, receiver) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            let _ = sender.send(());
        });

        let started = std::time::Instant::now();
        let result = executor
            .run_cancellable(
                &RunRequest {
                    command: "/bin/sh".to_string(),
                    args: vec![
                        "-c".to_string(),
                        "trap '' TERM; while :; do sleep 1; done".to_string(),
                    ],
                    cwd: None,
                    env: std::collections::HashMap::new(),
                    input: None,
                    timeout_ms: None,
                    max_output_bytes: Some(1024),
                },
                Some(receiver),
            )
            .await;

        assert!(matches!(result, Err(ExecutorError::Cancelled)));
        // The shell ignores SIGTERM, so this can only finish after the grace
        // period expires and SIGKILL takes over.
        assert!(
            started.elapsed() >= TERMINATION_GRACE,
            "expected the grace period to elapse before the kill"
        );
        assert!(started.elapsed() < std::time::Duration::from_secs(6));
    }
}
