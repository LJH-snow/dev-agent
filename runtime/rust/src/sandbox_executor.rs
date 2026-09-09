use crate::local_executor::LocalExecutor;
use crate::proto::dev_agent::executor::{RunRequest, RunResult, SandboxProfile};
use starlark::environment::{Globals, Module};
use starlark::eval::Evaluator;
use starlark::syntax::{AstModule, Dialect};
use starlark::values::list::AllocList;
use starlark::values::none::NoneType;
use starlark::values::structs::AllocStruct;

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
            network_policy: format!("{:?}", profile.network()),
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
    inner: LocalExecutor,
}

impl SandboxExecutor {
    pub fn new() -> Self {
        Self {
            inner: LocalExecutor::new(),
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
        self.inner.run(run).await.map_err(SandboxError::from)
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

    #[tokio::test]
    async fn sandbox_executor_runs_without_policy() {
        let executor = SandboxExecutor::new();
        let result = executor
            .run_sandboxed(&fake_run("/bin/echo"), &fake_profile("default", None))
            .await
            .unwrap();
        assert_eq!(result.exit_code, 0);
    }

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
}

impl Default for SandboxExecutor {
    fn default() -> Self {
        Self::new()
    }
}
