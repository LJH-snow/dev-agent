use crate::proto::dev_agent::executor::{RunRequest, RunResult, SandboxProfile};
use crate::restricted_executor::{RestrictedError, RestrictedExecutor};
use starlark::environment::{Globals, Module};
use starlark::eval::Evaluator;
use starlark::syntax::{AstModule, Dialect};
use starlark::values::list::AllocList;
use starlark::values::none::NoneType;
use starlark::values::structs::AllocStruct;

/// Maps a protobuf `NetworkPolicy` enum to the lowercase label exposed to
/// Starlark policy scripts via `ctx.network_policy`.
///
/// The policy contract (documented on `PolicyContext` and in
/// `examples/sandbox-policy.star`) uses lowercase labels: "unspecified",
/// "enabled", "disabled", "loopback". The prost-generated Rust enum variants
/// are `NetworkUnspecified`/`NetworkEnabled`/`NetworkDisabled`/`NetworkLoopback`,
/// so we cannot rely on `{:?}` here.
fn network_policy_label(policy: crate::proto::dev_agent::executor::NetworkPolicy) -> &'static str {
    use crate::proto::dev_agent::executor::NetworkPolicy;
    match policy {
        NetworkPolicy::NetworkEnabled => "enabled",
        NetworkPolicy::NetworkDisabled => "disabled",
        NetworkPolicy::NetworkLoopback => "loopback",
        NetworkPolicy::NetworkUnspecified => "unspecified",
    }
}

/// Errors that can occur during sandboxed execution.
///
/// These errors are returned to the TypeScript side as `ErrorResult` messages
/// with the corresponding error code, so the agent can react appropriately
/// (e.g., ask the user for permission, or pick a safer command).
#[derive(Debug, thiserror::Error)]
pub enum SandboxError {
    /// The command was denied by the sandbox policy.
    #[error("policy denied: {0}")]
    PolicyDenied(String),

    /// An error occurred while evaluating the Starlark policy script.
    #[error("policy evaluation error: {0}")]
    Policy(String),

    /// The sandbox profile could not be converted into an enforcement policy.
    #[error("sandbox configuration error: {0}")]
    SandboxConfig(String),

    /// The current platform does not yet provide a restricted execution backend.
    #[error("sandbox execution is not supported on this platform: {0}")]
    Unsupported(String),

    /// The underlying executor failed.
    #[error("executor error: {0}")]
    Executor(#[from] crate::local_executor::ExecutorError),
}

/// Evaluation context passed to the policy script.
///
/// This is the information available to Starlark policy scripts when deciding
/// whether to allow or deny a command. It is constructed from the `RunRequest`
/// and `SandboxProfile` before policy evaluation.
#[derive(Debug, Clone)]
pub struct PolicyContext {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub network_policy: String,
    pub writable_paths: Vec<String>,
    pub readonly_paths: Vec<String>,
}

impl PolicyContext {
    pub fn from_request(request: &RunRequest, profile: &SandboxProfile) -> Self {
        Self {
            command: request.command.clone(),
            args: request.args.clone(),
            cwd: request.cwd.clone(),
            network_policy: network_policy_label(profile.network()).to_owned(),
            writable_paths: profile.writable_paths.clone(),
            readonly_paths: profile.readonly_paths.clone(),
        }
    }
}

/// Result of a policy evaluation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PolicyDecision {
    Allow,
    Deny,
}

pub struct SandboxExecutor {
    inner: RestrictedExecutor,
}

impl SandboxExecutor {
    pub fn new() -> Self {
        Self {
            inner: RestrictedExecutor::new(),
        }
    }

    /// Runs a command under the given sandbox profile.
    ///
    /// If the profile includes a `policy_script`, it is evaluated before the
    /// command runs. A deny decision returns `SandboxError::PolicyDenied`.
    /// If no policy script is provided, the command runs without policy checks
    /// (relying on the profile's network/filesystem settings only).
    pub async fn run_sandboxed(
        &self,
        run: &RunRequest,
        profile: &SandboxProfile,
    ) -> Result<RunResult, SandboxError> {
        if let Some(script) = &profile.policy_script {
            let ctx = PolicyContext::from_request(run, profile);
            match evaluate_policy(script, &ctx)? {
                PolicyDecision::Allow => {}
                PolicyDecision::Deny => {
                    return Err(SandboxError::PolicyDenied(format!(
                        "command '{}' denied by policy script",
                        run.command
                    )));
                }
            }
        }
        self.inner
            .run(run, profile)
            .await
            .map_err(|error| match error {
                RestrictedError::Executor(error) => SandboxError::Executor(error),
                RestrictedError::Profile(message) => SandboxError::SandboxConfig(message),
                RestrictedError::Unsupported(message) => SandboxError::Unsupported(message),
            })
    }
}

/// Evaluates a Starlark policy script against the given context.
///
/// The script can either evaluate to a bool directly or define a `policy(ctx)`
/// function that returns the allow/deny decision. `ctx` is exposed as a Starlark
/// struct with the fields documented in `runtime/rust/examples/sandbox-policy.star`.
const POLICY_MAX_TICK_COUNT: u64 = 1_000_000;
const POLICY_MAX_HEAP_BYTES: usize = 16 * 1024 * 1024;

fn evaluate_policy(script: &str, ctx: &PolicyContext) -> Result<PolicyDecision, SandboxError> {
    let ast = AstModule::parse("policy.star", script.to_owned(), &Dialect::Standard)
        .map_err(|err| SandboxError::Policy(err.to_string()))?;
    let globals = Globals::standard();

    Module::with_temp_heap(|module| {
        let heap = module.heap();
        let command = heap.alloc(ctx.command.as_str());
        let args = heap.alloc(AllocList(ctx.args.iter().cloned()));
        let cwd = match &ctx.cwd {
            Some(cwd) => heap.alloc(cwd.as_str()),
            None => heap.alloc(NoneType),
        };
        let network_policy = heap.alloc(ctx.network_policy.as_str());
        let writable_paths = heap.alloc(AllocList(ctx.writable_paths.iter().cloned()));
        let readonly_paths = heap.alloc(AllocList(ctx.readonly_paths.iter().cloned()));
        let ctx_value = heap.alloc(AllocStruct(vec![
            ("command", command),
            ("args", args),
            ("cwd", cwd),
            ("network_policy", network_policy),
            ("writable_paths", writable_paths),
            ("readonly_paths", readonly_paths),
        ]));
        module.set("ctx", ctx_value);

        let mut eval = Evaluator::new(&module);
        eval.set_max_tick_count(POLICY_MAX_TICK_COUNT)
            .map_err(|err| SandboxError::Policy(err.to_string()))?;
        eval.set_max_heap_size(POLICY_MAX_HEAP_BYTES)
            .map_err(|err| SandboxError::Policy(err.to_string()))?;

        let result = eval
            .eval_module(ast, &globals)
            .map_err(|err| SandboxError::Policy(format!("policy evaluation error: {err}")))?;

        let allow = if let Some(allow) = result.unpack_bool() {
            allow
        } else if let Some(policy) = module.get("policy") {
            let policy_result = eval
                .eval_function(policy, &[ctx_value], &[])
                .map_err(|err| SandboxError::Policy(format!("policy function error: {err}")))?;
            policy_result.unpack_bool().ok_or_else(|| {
                SandboxError::Policy(format!(
                    "policy(ctx) must return bool, got {}",
                    policy_result.get_type()
                ))
            })?
        } else {
            return Err(SandboxError::Policy(
                "policy script must evaluate to bool or define policy(ctx)".to_owned(),
            ));
        };

        Ok(if allow {
            PolicyDecision::Allow
        } else {
            PolicyDecision::Deny
        })
    })
}

impl Default for SandboxExecutor {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXAMPLE_POLICY: &str = include_str!("../examples/sandbox-policy.star");

    fn fake_run(command: &str) -> RunRequest {
        RunRequest {
            command: command.to_string(),
            args: vec!["--flag".to_string()],
            cwd: None,
            env: std::collections::HashMap::new(),
            input: None,
            timeout_ms: None,
            max_output_bytes: None,
        }
    }

    fn fake_profile(name: &str, policy_script: Option<&str>) -> SandboxProfile {
        SandboxProfile {
            name: name.to_string(),
            network: crate::proto::dev_agent::executor::NetworkPolicy::NetworkDisabled as i32,
            writable_paths: vec!["/workspace".to_string()],
            readonly_paths: vec!["/etc".to_string()],
            environment: std::collections::HashMap::new(),
            timeout_ms: Some(30000),
            policy_script: policy_script.map(|s| s.to_string()),
        }
    }

    /// Returns the first candidate that behaves like a real Python 3
    /// interpreter.
    ///
    /// macOS ships a `/usr/bin/python3` stub that shells out to `xcode-select`
    /// when the developer tools are not installed. That stub cannot run inside
    /// the sandbox profiles these tests use (they deny writes to `/dev/null`),
    /// so the stub's own failure would mask the behaviour under test. Probing
    /// candidates outside the sandbox keeps the assertions meaningful, and
    /// lets the network tests skip cleanly on machines without an interpreter.
    #[cfg(target_os = "macos")]
    fn python3_interpreter() -> Option<String> {
        let mut candidates: Vec<String> = Vec::new();
        if let Ok(explicit) = std::env::var("DEV_AGENT_TEST_PYTHON") {
            if !explicit.trim().is_empty() {
                candidates.push(explicit);
            }
        }
        candidates.push("python3".to_string());
        candidates.push("/usr/bin/python3".to_string());
        candidates.push("/opt/homebrew/bin/python3".to_string());
        candidates.push("/usr/local/bin/python3".to_string());

        candidates.into_iter().find(|candidate| {
            std::process::Command::new(candidate)
                .args(["-c", "import socket"])
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .is_ok_and(|status| status.success())
        })
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn sandbox_executor_runs_without_policy() {
        let executor = SandboxExecutor::new();
        let result = executor
            .run_sandboxed(&fake_run("/bin/echo"), &fake_profile("default", None))
            .await
            .unwrap();
        assert_eq!(result.exit_code, 0);
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn sandbox_executor_evaluates_policy_script() {
        let executor = SandboxExecutor::new();
        let result = executor
            .run_sandboxed(
                &fake_run("/bin/echo"),
                &fake_profile("ci", Some("def policy(ctx):\n    return True")),
            )
            .await
            .unwrap();
        assert_eq!(result.exit_code, 0);
    }

    #[tokio::test]
    async fn sandbox_executor_denies_with_policy() {
        let executor = SandboxExecutor::new();
        let result = executor
            .run_sandboxed(&fake_run("/bin/echo"), &fake_profile("deny", Some("False")))
            .await;
        assert!(matches!(result, Err(SandboxError::PolicyDenied(_))));
    }

    #[test]
    fn evaluate_policy_reads_context_fields() {
        let ctx = PolicyContext::from_request(&fake_run("/bin/echo"), &fake_profile("ci", None));
        assert!(matches!(
            evaluate_policy("ctx.command == '/bin/echo'", &ctx),
            Ok(PolicyDecision::Allow)
        ));
        assert!(matches!(
            evaluate_policy("False", &ctx),
            Ok(PolicyDecision::Deny)
        ));
    }

    #[test]
    fn evaluate_policy_calls_policy_function() {
        let ctx = PolicyContext::from_request(&fake_run("/bin/echo"), &fake_profile("ci", None));
        let script = r#"
def policy(ctx):
    return ctx.args == ["--flag"] and ctx.command == "/bin/echo"
"#;
        assert!(matches!(
            evaluate_policy(script, &ctx),
            Ok(PolicyDecision::Allow)
        ));
    }

    #[test]
    fn evaluate_policy_accepts_example_policy() {
        let echo = PolicyContext::from_request(&fake_run("echo"), &fake_profile("ci", None));
        assert!(matches!(
            evaluate_policy(EXAMPLE_POLICY, &echo),
            Ok(PolicyDecision::Allow)
        ));

        let rm = PolicyContext::from_request(&fake_run("rm"), &fake_profile("ci", None));
        assert!(matches!(
            evaluate_policy(EXAMPLE_POLICY, &rm),
            Ok(PolicyDecision::Deny)
        ));
    }

    #[test]
    fn evaluate_policy_rejects_non_bool_results() {
        let ctx = PolicyContext::from_request(&fake_run("/bin/echo"), &fake_profile("ci", None));
        let error = evaluate_policy("ctx.args", &ctx).unwrap_err();
        assert!(matches!(error, SandboxError::Policy(_)));
    }

    #[test]
    fn evaluate_policy_rejects_invalid_syntax() {
        let ctx = PolicyContext::from_request(&fake_run("/bin/echo"), &fake_profile("ci", None));
        let error = evaluate_policy("def broken(", &ctx).unwrap_err();
        assert!(matches!(error, SandboxError::Policy(_)));
    }

    #[test]
    fn policy_context_extracts_fields() {
        let mut run = fake_run("cargo");
        run.cwd = Some("/workspace".to_string());
        let ctx = PolicyContext::from_request(&run, &fake_profile("ci", None));
        assert_eq!(ctx.command, "cargo");
        assert_eq!(ctx.args, vec!["--flag".to_string()]);
        assert_eq!(ctx.cwd, Some("/workspace".to_string()));
        assert_eq!(ctx.writable_paths, vec!["/workspace".to_string()]);
        assert_eq!(ctx.readonly_paths, vec!["/etc".to_string()]);
    }

    #[test]
    fn policy_context_exposes_network_policy_as_lowercase_label() {
        use crate::proto::dev_agent::executor::NetworkPolicy;
        let run = fake_run("/bin/echo");

        let disabled = PolicyContext::from_request(
            &run,
            &SandboxProfile {
                name: "net-disabled".to_string(),
                network: NetworkPolicy::NetworkDisabled as i32,
                writable_paths: vec!["/workspace".to_string()],
                readonly_paths: vec!["/etc".to_string()],
                environment: std::collections::HashMap::new(),
                timeout_ms: Some(30000),
                policy_script: None,
            },
        );
        assert_eq!(disabled.network_policy, "disabled");

        let enabled = PolicyContext::from_request(
            &run,
            &SandboxProfile {
                name: "net-enabled".to_string(),
                network: NetworkPolicy::NetworkEnabled as i32,
                writable_paths: vec!["/workspace".to_string()],
                readonly_paths: vec!["/etc".to_string()],
                environment: std::collections::HashMap::new(),
                timeout_ms: Some(30000),
                policy_script: None,
            },
        );
        assert_eq!(enabled.network_policy, "enabled");

        let loopback = PolicyContext::from_request(
            &run,
            &SandboxProfile {
                name: "net-loopback".to_string(),
                network: NetworkPolicy::NetworkLoopback as i32,
                writable_paths: vec!["/workspace".to_string()],
                readonly_paths: vec!["/etc".to_string()],
                environment: std::collections::HashMap::new(),
                timeout_ms: Some(30000),
                policy_script: None,
            },
        );
        assert_eq!(loopback.network_policy, "loopback");

        let unspecified = PolicyContext::from_request(
            &run,
            &SandboxProfile {
                name: "net-unspecified".to_string(),
                network: NetworkPolicy::NetworkUnspecified as i32,
                writable_paths: vec!["/workspace".to_string()],
                readonly_paths: vec!["/etc".to_string()],
                environment: std::collections::HashMap::new(),
                timeout_ms: Some(30000),
                policy_script: None,
            },
        );
        assert_eq!(unspecified.network_policy, "unspecified");
    }

    #[test]
    fn evaluate_policy_denies_network_commands_when_disabled() {
        let ctx = PolicyContext::from_request(
            &fake_run("curl"),
            &SandboxProfile {
                name: "network-off".to_string(),
                network: crate::proto::dev_agent::executor::NetworkPolicy::NetworkDisabled as i32,
                writable_paths: vec!["/workspace".to_string()],
                readonly_paths: vec![],
                environment: std::collections::HashMap::new(),
                timeout_ms: None,
                policy_script: None,
            },
        );
        let script = r#"
def policy(ctx):
    if ctx.network_policy == "disabled":
        network_commands = ["curl", "wget", "ssh", "scp"]
        return ctx.command not in network_commands
    return True
"#;
        assert!(matches!(
            evaluate_policy(script, &ctx),
            Ok(PolicyDecision::Deny)
        ));

        let local = PolicyContext::from_request(
            &fake_run("cat"),
            &SandboxProfile {
                name: "network-off".to_string(),
                network: crate::proto::dev_agent::executor::NetworkPolicy::NetworkDisabled as i32,
                writable_paths: vec!["/workspace".to_string()],
                readonly_paths: vec![],
                environment: std::collections::HashMap::new(),
                timeout_ms: None,
                policy_script: None,
            },
        );
        assert!(matches!(
            evaluate_policy(script, &local),
            Ok(PolicyDecision::Allow)
        ));
    }

    #[test]
    fn evaluate_policy_allows_network_commands_when_enabled() {
        let ctx = PolicyContext::from_request(
            &fake_run("curl"),
            &SandboxProfile {
                name: "network-on".to_string(),
                network: crate::proto::dev_agent::executor::NetworkPolicy::NetworkEnabled as i32,
                writable_paths: vec!["/workspace".to_string()],
                readonly_paths: vec![],
                environment: std::collections::HashMap::new(),
                timeout_ms: None,
                policy_script: None,
            },
        );
        let script = r#"
def policy(ctx):
    if ctx.network_policy == "disabled":
        network_commands = ["curl", "wget", "ssh", "scp"]
        return ctx.command not in network_commands
    return True
"#;
        assert!(matches!(
            evaluate_policy(script, &ctx),
            Ok(PolicyDecision::Allow)
        ));
    }

    #[test]
    fn evaluate_example_policy_network_check() {
        let ctx = PolicyContext::from_request(
            &fake_run("curl"),
            &SandboxProfile {
                name: "network-off".to_string(),
                network: crate::proto::dev_agent::executor::NetworkPolicy::NetworkDisabled as i32,
                writable_paths: vec!["/workspace".to_string()],
                readonly_paths: vec![],
                environment: std::collections::HashMap::new(),
                timeout_ms: None,
                policy_script: None,
            },
        );
        assert!(matches!(
            evaluate_policy(EXAMPLE_POLICY, &ctx),
            Ok(PolicyDecision::Deny)
        ));

        let git_local = PolicyContext::from_request(
            &{
                let mut run = fake_run("git");
                run.args = vec!["status".to_string()];
                run
            },
            &SandboxProfile {
                name: "network-off".to_string(),
                network: crate::proto::dev_agent::executor::NetworkPolicy::NetworkDisabled as i32,
                writable_paths: vec!["/workspace".to_string()],
                readonly_paths: vec![],
                environment: std::collections::HashMap::new(),
                timeout_ms: None,
                policy_script: None,
            },
        );
        assert!(matches!(
            evaluate_policy(EXAMPLE_POLICY, &git_local),
            Ok(PolicyDecision::Allow)
        ));
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn sandbox_executor_allows_writes_to_writable_paths() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("out.txt");
        let executor = SandboxExecutor::new();
        let result = executor
            .run_sandboxed(
                &RunRequest {
                    command: "/bin/sh".to_string(),
                    args: vec!["-c".to_string(), "echo ok > out.txt".to_string()],
                    cwd: Some(dir.path().to_string_lossy().to_string()),
                    env: std::collections::HashMap::new(),
                    input: None,
                    timeout_ms: None,
                    max_output_bytes: None,
                },
                &SandboxProfile {
                    name: "writable".to_string(),
                    network: crate::proto::dev_agent::executor::NetworkPolicy::NetworkDisabled
                        as i32,
                    writable_paths: vec![dir.path().to_string_lossy().to_string()],
                    readonly_paths: vec![],
                    environment: std::collections::HashMap::new(),
                    timeout_ms: None,
                    policy_script: Some("True".to_string()),
                },
            )
            .await
            .unwrap();
        assert_eq!(result.exit_code, 0);
        assert_eq!(std::fs::read_to_string(out).unwrap(), "ok\n");
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn sandbox_executor_rejects_readonly_path_writes() {
        let dir = tempfile::tempdir().unwrap();
        let readonly = dir.path().join("readonly.txt");
        std::fs::write(&readonly, "keep\n").unwrap();
        let executor = SandboxExecutor::new();
        let result = executor
            .run_sandboxed(
                &RunRequest {
                    command: "/bin/sh".to_string(),
                    args: vec!["-c".to_string(), "echo blocked > readonly.txt".to_string()],
                    cwd: Some(dir.path().to_string_lossy().to_string()),
                    env: std::collections::HashMap::new(),
                    input: None,
                    timeout_ms: None,
                    max_output_bytes: None,
                },
                &SandboxProfile {
                    name: "readonly".to_string(),
                    network: crate::proto::dev_agent::executor::NetworkPolicy::NetworkDisabled
                        as i32,
                    writable_paths: vec![dir.path().to_string_lossy().to_string()],
                    readonly_paths: vec![readonly.to_string_lossy().to_string()],
                    environment: std::collections::HashMap::new(),
                    timeout_ms: None,
                    policy_script: Some("True".to_string()),
                },
            )
            .await
            .unwrap();
        assert_ne!(result.exit_code, 0);
        assert!(result.stderr.contains("Operation not permitted"));
        assert_eq!(std::fs::read_to_string(readonly).unwrap(), "keep\n");
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn sandbox_executor_denies_network_when_disabled() {
        let Some(python) = python3_interpreter() else {
            eprintln!(
                "skipping sandbox_executor_denies_network_when_disabled: no working python3 interpreter"
            );
            return;
        };
        let executor = SandboxExecutor::new();
        let result = executor
            .run_sandboxed(
                &RunRequest {
                    command: python,
                    args: vec![
                        "-c".to_string(),
                        "import socket; s=socket.socket(); s.settimeout(1); s.connect(('127.0.0.1', 65530))"
                            .to_string(),
                    ],
                    cwd: None,
                    env: std::collections::HashMap::new(),
                    input: None,
                    timeout_ms: None,
                    max_output_bytes: None,
                },
                &fake_profile("network-off", Some("True")),
            )
            .await
            .unwrap();
        assert_ne!(result.exit_code, 0);
        assert!(result.stderr.contains("Operation not permitted"));
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn sandbox_executor_allows_loopback_network_when_loopback() {
        let Some(python) = python3_interpreter() else {
            eprintln!(
                "skipping sandbox_executor_allows_loopback_network_when_loopback: no working python3 interpreter"
            );
            return;
        };
        let executor = SandboxExecutor::new();
        let script = "import socket, threading; ls=socket.socket(); ls.bind((\"127.0.0.1\", 0)); ls.listen(1); port=ls.getsockname()[1]; threading.Thread(target=lambda: (lambda c: (c.sendall(b\"ok\"), c.close()))(ls.accept()[0]), daemon=True).start(); s=socket.socket(); s.settimeout(2); s.connect((\"127.0.0.1\", port)); print(s.recv(2).decode()); s.close()";
        let result = executor
            .run_sandboxed(
                &RunRequest {
                    command: python,
                    args: vec!["-c".to_string(), script.to_string()],
                    cwd: None,
                    env: std::collections::HashMap::new(),
                    input: None,
                    timeout_ms: None,
                    max_output_bytes: None,
                },
                &SandboxProfile {
                    name: "loopback".to_string(),
                    network: crate::proto::dev_agent::executor::NetworkPolicy::NetworkLoopback
                        as i32,
                    writable_paths: vec![],
                    readonly_paths: vec![],
                    environment: std::collections::HashMap::new(),
                    timeout_ms: None,
                    policy_script: Some("True".to_string()),
                },
            )
            .await
            .unwrap();
        assert_eq!(result.exit_code, 0);
        assert_eq!(result.stdout.trim(), "ok");
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn sandbox_executor_enforces_profile_timeout() {
        let executor = SandboxExecutor::new();
        let result = executor
            .run_sandboxed(
                &RunRequest {
                    command: "/bin/sleep".to_string(),
                    args: vec!["10".to_string()],
                    cwd: None,
                    env: std::collections::HashMap::new(),
                    input: None,
                    timeout_ms: None,
                    max_output_bytes: None,
                },
                &SandboxProfile {
                    name: "timed".to_string(),
                    network: crate::proto::dev_agent::executor::NetworkPolicy::NetworkDisabled
                        as i32,
                    writable_paths: vec![],
                    readonly_paths: vec![],
                    environment: std::collections::HashMap::new(),
                    timeout_ms: Some(100),
                    policy_script: Some("True".to_string()),
                },
            )
            .await
            .unwrap();
        assert!(result.timed_out);
        assert_eq!(result.exit_code, -1);
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn sandbox_executor_applies_resource_limits() {
        let executor = SandboxExecutor::new();
        let result = executor
            .run_sandboxed(
                &RunRequest {
                    command: "/bin/sh".to_string(),
                    args: vec!["-c".to_string(), "ulimit -n".to_string()],
                    cwd: None,
                    env: std::collections::HashMap::new(),
                    input: None,
                    timeout_ms: None,
                    max_output_bytes: None,
                },
                &fake_profile("limits", Some("True")),
            )
            .await
            .unwrap();
        assert_eq!(result.exit_code, 0);
        assert_eq!(result.stdout.trim(), "4096");
    }
}
