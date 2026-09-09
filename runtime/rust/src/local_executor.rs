use std::process::Stdio;
use std::time::Duration;

use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::timeout;

use crate::proto::dev_agent::executor::{RunRequest, RunResult};

#[derive(Debug, thiserror::Error)]
pub enum ExecutorError {
    #[error("command must not be empty")]
    EmptyCommand,
    #[error("execution error: {0}")]
    Io(#[from] std::io::Error),
}

pub struct LocalExecutor;

impl LocalExecutor {
    pub fn new() -> Self {
        Self
    }

    pub async fn run(&self, request: &RunRequest) -> Result<RunResult, ExecutorError> {
        if request.command.trim().is_empty() {
            return Err(ExecutorError::EmptyCommand);
        }

        let mut command = Command::new(&request.command);
        command.args(&request.args);
        command.stdin(Stdio::piped());
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());
        command.kill_on_drop(true);

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

        let result = match request.timeout_ms {
            Some(millis) => {
                let duration = Duration::from_millis(millis);
                match timeout(duration, child.wait_with_output()).await {
                    Ok(Ok(output)) => RunResult {
                        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
                        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
                        exit_code: output.status.code().unwrap_or(-1),
                        timed_out: false,
                    },
                    Ok(Err(err)) => return Err(ExecutorError::Io(err)),
                    Err(_) => RunResult {
                        stdout: String::new(),
                        stderr: "command timed out".to_string(),
                        exit_code: -1,
                        timed_out: true,
                    },
                }
            }
            None => {
                let output = child.wait_with_output().await.map_err(ExecutorError::Io)?;
                RunResult {
                    stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
                    stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
                    exit_code: output.status.code().unwrap_or(-1),
                    timed_out: false,
                }
            }
        };

        Ok(result)
    }
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
            })
            .await
            .unwrap();
        assert!(result.timed_out);
        assert_eq!(result.exit_code, -1);
    }
}
