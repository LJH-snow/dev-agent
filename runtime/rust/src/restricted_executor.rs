use std::path::{Path, PathBuf};

use tokio::process::Command;

use crate::local_executor::{ExecutorError, LocalExecutor};
use crate::proto::dev_agent::executor::{NetworkPolicy, RunRequest, RunResult, SandboxProfile};

#[derive(Debug, thiserror::Error)]
pub enum RestrictedError {
    #[error("sandbox profile error: {0}")]
    Profile(String),
    #[error("restricted execution is not supported on this platform: {0}")]
    Unsupported(String),
    #[error(transparent)]
    Executor(#[from] ExecutorError),
}

pub struct RestrictedExecutor {
    inner: LocalExecutor,
}

impl RestrictedExecutor {
    pub fn new() -> Self {
        Self {
            inner: LocalExecutor::new(),
        }
    }

    #[cfg(target_os = "macos")]
    pub async fn run(
        &self,
        run: &RunRequest,
        profile: &SandboxProfile,
    ) -> Result<RunResult, RestrictedError> {
        let mut request = run.clone();
        request.timeout_ms = effective_timeout_ms(run, profile);
        request.env = merge_env(run, profile);

        let base_dir = run
            .cwd
            .as_deref()
            .map(Path::new)
            .unwrap_or_else(|| Path::new("."));
        let policy_profile = build_sandbox_profile(
            profile.network(),
            &profile.writable_paths,
            &profile.readonly_paths,
            base_dir,
        )?;
        let command_name = request.command.clone();

        self.inner
            .run_with_builder(&request, move || {
                let mut command = Command::new("sandbox-exec");
                command.arg("-p").arg(&policy_profile).arg(&command_name);
                apply_resource_limits(&mut command);
                command
            })
            .await
            .map_err(RestrictedError::Executor)
    }

    #[cfg(target_os = "linux")]
    pub async fn run(
        &self,
        run: &RunRequest,
        profile: &SandboxProfile,
    ) -> Result<RunResult, RestrictedError> {
        let mut request = run.clone();
        request.timeout_ms = effective_timeout_ms(run, profile);
        request.env = merge_env(run, profile);

        let base_dir = run
            .cwd
            .as_deref()
            .map(Path::new)
            .unwrap_or_else(|| Path::new("."));
        let bwrap_args = build_bwrap_args(&request, profile, base_dir)?;

        self.inner
            .run_with_builder(&request, move || {
                let mut command = Command::new("bwrap");
                for arg in &bwrap_args {
                    command.arg(arg);
                }
                apply_resource_limits(&mut command);
                command
            })
            .await
            .map_err(RestrictedError::Executor)
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    pub async fn run(
        &self,
        _run: &RunRequest,
        _profile: &SandboxProfile,
    ) -> Result<RunResult, RestrictedError> {
        Err(RestrictedError::Unsupported(other_platform_message()))
    }
}

impl Default for RestrictedExecutor {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Shared helpers (all platforms)
// ---------------------------------------------------------------------------

fn effective_timeout_ms(run: &RunRequest, profile: &SandboxProfile) -> Option<u64> {
    match (run.timeout_ms, profile.timeout_ms) {
        (Some(run_timeout), Some(profile_timeout)) => Some(run_timeout.min(profile_timeout)),
        (Some(run_timeout), None) => Some(run_timeout),
        (None, Some(profile_timeout)) => Some(profile_timeout),
        (None, None) => None,
    }
}

fn merge_env(
    run: &RunRequest,
    profile: &SandboxProfile,
) -> std::collections::HashMap<String, String> {
    let mut env = profile.environment.clone();
    for (key, value) in &run.env {
        env.insert(key.clone(), value.clone());
    }
    env
}

fn resolve_sandbox_path(path: &str, base_dir: &Path) -> Result<PathBuf, RestrictedError> {
    let path_buf = if Path::new(path).is_absolute() {
        PathBuf::from(path)
    } else {
        base_dir.join(path)
    };

    if let Ok(canonical) = std::fs::canonicalize(&path_buf) {
        return Ok(canonical);
    }

    if let Some(parent) = path_buf.parent() {
        if let Ok(canonical_parent) = std::fs::canonicalize(parent) {
            if let Some(name) = path_buf.file_name() {
                return Ok(canonical_parent.join(name));
            }
        }
    }

    Ok(path_buf)
}

/// Read-only bind `path` onto itself if it exists on the host.
#[cfg(any(target_os = "linux", test))]
fn ro_bind_if_exists(args: &mut Vec<String>, path: &str) {
    if Path::new(path).exists() {
        args.push("--ro-bind".to_string());
        args.push(path.to_string());
        args.push(path.to_string());
    }
}

// ---------------------------------------------------------------------------
// macOS backend: sandbox-exec
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
fn build_sandbox_profile(
    network: NetworkPolicy,
    writable_paths: &[String],
    readonly_paths: &[String],
    base_dir: &Path,
) -> Result<String, RestrictedError> {
    let mut profile = String::from("(version 1)\n(allow default)\n(deny file-write*)\n");

    for raw in writable_paths.iter().filter(|path| !path.is_empty()) {
        let path = resolve_sandbox_path(raw, base_dir)?;
        profile.push_str(&format!(
            "(allow file-write* (subpath {}))\n",
            quote_sandbox_path(&path.to_string_lossy())
        ));
    }

    for raw in readonly_paths.iter().filter(|path| !path.is_empty()) {
        let path = resolve_sandbox_path(raw, base_dir)?;
        profile.push_str(&format!(
            "(deny file-write* (subpath {}))\n",
            quote_sandbox_path(&path.to_string_lossy())
        ));
    }

    match network {
        NetworkPolicy::NetworkDisabled => profile.push_str("(deny network*)\n"),
        NetworkPolicy::NetworkLoopback => {
            profile.push_str("(deny network*)\n(allow network* (local tcp))\n");
        }
        NetworkPolicy::NetworkEnabled | NetworkPolicy::NetworkUnspecified => {}
    }

    Ok(profile)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn build_sandbox_profile(
    _network: NetworkPolicy,
    _writable_paths: &[String],
    _readonly_paths: &[String],
    _base_dir: &Path,
) -> Result<String, RestrictedError> {
    Err(RestrictedError::Unsupported(
        "profile generation only supports the macOS and Linux backends".to_string(),
    ))
}

#[cfg(target_os = "macos")]
fn quote_sandbox_path(path: &str) -> String {
    let escaped = path.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

// ---------------------------------------------------------------------------
// Linux backend: bubblewrap (bwrap)
// ---------------------------------------------------------------------------

/// Builds the `bwrap` argument list (not including the `bwrap` binary itself).
///
/// This is a pure function so it can be unit-tested on any host, even though the
/// resulting command only runs on Linux where `bwrap` is available.
#[cfg(any(target_os = "linux", test))]
fn build_bwrap_args(
    run: &RunRequest,
    profile: &SandboxProfile,
    base_dir: &Path,
) -> Result<Vec<String>, RestrictedError> {
    let mut args: Vec<String> = vec![
        "--unshare-user-try".to_string(),
        "--unshare-ipc".to_string(),
        "--unshare-pid".to_string(),
        "--unshare-uts".to_string(),
        "--unshare-cgroup-try".to_string(),
    ];

    match profile.network() {
        NetworkPolicy::NetworkDisabled | NetworkPolicy::NetworkLoopback => {
            // A fresh network namespace only exposes the loopback interface, so
            // this both disables external network access (disabled) and confines
            // the command to loopback-only (loopback).
            args.push("--unshare-net".to_string());
        }
        NetworkPolicy::NetworkEnabled | NetworkPolicy::NetworkUnspecified => {}
    };

    // Read-only view of the standard filesystem hierarchy. Each entry is only
    // bound if it exists on the host, so the same profile works across distros.
    for path in &[
        "/", "/usr", "/bin", "/lib", "/lib64", "/sbin", "/etc", "/opt", "/home", "/root",
    ] {
        ro_bind_if_exists(&mut args, path);
    }

    args.push("--proc".to_string());
    args.push("/proc".to_string());
    args.push("--dev".to_string());
    args.push("/dev".to_string());
    args.push("--dir".to_string());
    args.push("/tmp".to_string());

    // Writable paths: bind-mounted read-write, overriding the read-only root.
    for raw in profile.writable_paths.iter().filter(|p| !p.is_empty()) {
        let path = resolve_sandbox_path(raw, base_dir)?;
        let rendered = path.to_string_lossy().to_string();
        args.push("--bind".to_string());
        args.push(rendered.clone());
        args.push(rendered);
    }

    // Explicit read-only paths.
    for raw in profile.readonly_paths.iter().filter(|p| !p.is_empty()) {
        let path = resolve_sandbox_path(raw, base_dir)?;
        let rendered = path.to_string_lossy().to_string();
        args.push("--ro-bind".to_string());
        args.push(rendered.clone());
        args.push(rendered);
    }

    // Environment variables (profile first, then run env can override).
    for (key, value) in &profile.environment {
        args.push("--setenv".to_string());
        args.push(key.clone());
        args.push(value.clone());
    }
    for (key, value) in &run.env {
        args.push("--setenv".to_string());
        args.push(key.clone());
        args.push(value.clone());
    }

    args.push("--die-with-parent".to_string());

    if let Some(cwd) = &run.cwd {
        args.push("--chdir".to_string());
        args.push(cwd.clone());
    }

    // Separator followed by the command to run inside the sandbox.
    args.push("--".to_string());
    args.push(run.command.clone());

    Ok(args)
}

// ---------------------------------------------------------------------------
// Resource limits
// ---------------------------------------------------------------------------

#[cfg(any(target_os = "macos", target_os = "linux"))]
const RESOURCE_MAX_CPU_SECS: libc::rlim_t = 30;
#[cfg(any(target_os = "macos", target_os = "linux"))]
const RESOURCE_MAX_FILE_SIZE_BYTES: libc::rlim_t = 256 * 1024 * 1024;
#[cfg(any(target_os = "macos", target_os = "linux"))]
const RESOURCE_MAX_OPEN_FILES: libc::rlim_t = 4096;
#[cfg(any(target_os = "macos", target_os = "linux"))]
const RESOURCE_MAX_PROCESSES: libc::rlim_t = 256;

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn apply_resource_limits(command: &mut Command) {
    unsafe {
        command.pre_exec(|| {
            let limits = [
                (libc::RLIMIT_CPU, RESOURCE_MAX_CPU_SECS),
                (libc::RLIMIT_FSIZE, RESOURCE_MAX_FILE_SIZE_BYTES),
                (libc::RLIMIT_NOFILE, RESOURCE_MAX_OPEN_FILES),
                (libc::RLIMIT_NPROC, RESOURCE_MAX_PROCESSES),
                (libc::RLIMIT_CORE, 0),
            ];

            for (resource, value) in limits {
                let limit = libc::rlimit {
                    rlim_cur: value,
                    rlim_max: value,
                };
                if libc::setrlimit(resource, &limit) != 0 {
                    let err = std::io::Error::last_os_error();
                    return Err(std::io::Error::other(format!(
                        "setrlimit({resource}) failed: {err}"
                    )));
                }
            }
            Ok(())
        });
    }
}

// ---------------------------------------------------------------------------
// Other platforms
// ---------------------------------------------------------------------------

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn other_platform_message() -> String {
    "Restricted execution is currently supported on macOS (sandbox-exec) and Linux (bwrap)."
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn profile_rejects_writes_without_writable_paths() {
        let profile =
            build_sandbox_profile(NetworkPolicy::NetworkEnabled, &[], &[], Path::new(".")).unwrap();
        assert!(profile.contains("(deny file-write*)"));
        assert!(!profile.contains("(allow file-write*)"));
        assert!(!profile.contains("(deny network*)"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn profile_orders_writable_path_before_readonly_path() {
        let profile = build_sandbox_profile(
            NetworkPolicy::NetworkDisabled,
            &["/tmp/work".to_string()],
            &["/tmp/work/readonly".to_string()],
            Path::new("."),
        )
        .unwrap();
        let writable = profile.find("(allow file-write*").unwrap();
        let readonly = profile.find("(deny file-write* (subpath").unwrap();
        assert!(writable < readonly);
        assert!(profile.contains("(deny network*)"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn profile_uses_real_path_for_tmp_symlink() {
        let writable = std::fs::canonicalize("/tmp").unwrap();
        let profile = build_sandbox_profile(
            NetworkPolicy::NetworkEnabled,
            &["/tmp".to_string()],
            &[],
            Path::new("."),
        )
        .unwrap();
        assert!(profile.contains(&writable.to_string_lossy().to_string()));
    }

    #[test]
    fn effective_timeout_takes_smaller_value() {
        let run = RunRequest {
            command: "sleep".to_string(),
            args: vec![],
            cwd: None,
            env: std::collections::HashMap::new(),
            input: None,
            timeout_ms: Some(10_000),
            max_output_bytes: None,
        };
        let profile = SandboxProfile {
            name: "timed".to_string(),
            network: NetworkPolicy::NetworkDisabled as i32,
            writable_paths: vec![],
            readonly_paths: vec![],
            environment: std::collections::HashMap::new(),
            timeout_ms: Some(250),
            policy_script: None,
        };
        assert_eq!(effective_timeout_ms(&run, &profile), Some(250));
    }

    // `build_bwrap_args` is a pure function, so we can verify its output on any
    // host (including macOS CI) even though the command only runs on Linux.
    #[test]
    fn bwrap_args_include_namespace_unsharing() {
        let run = RunRequest {
            command: "echo".to_string(),
            args: vec!["hi".to_string()],
            cwd: None,
            env: std::collections::HashMap::new(),
            input: None,
            timeout_ms: None,
            max_output_bytes: None,
        };
        let profile = SandboxProfile {
            name: "default".to_string(),
            network: NetworkPolicy::NetworkEnabled as i32,
            writable_paths: vec![],
            readonly_paths: vec![],
            environment: std::collections::HashMap::new(),
            timeout_ms: None,
            policy_script: None,
        };
        let args = build_bwrap_args(&run, &profile, Path::new(".")).unwrap();
        assert!(args.contains(&"--unshare-ipc".to_string()));
        assert!(args.contains(&"--unshare-pid".to_string()));
        assert!(args.contains(&"--unshare-uts".to_string()));
        assert!(args.contains(&"--proc".to_string()));
        assert!(args.contains(&"--dev".to_string()));
        assert!(args.contains(&"--die-with-parent".to_string()));
        // Command must come after the `--` separator.
        let sep = args.iter().position(|a| a == "--").unwrap();
        assert_eq!(args[sep + 1], "echo");
    }

    #[test]
    fn bwrap_args_disable_network_when_disabled() {
        let run = RunRequest {
            command: "curl".to_string(),
            args: vec![],
            cwd: None,
            env: std::collections::HashMap::new(),
            input: None,
            timeout_ms: None,
            max_output_bytes: None,
        };
        let profile = SandboxProfile {
            name: "net-off".to_string(),
            network: NetworkPolicy::NetworkDisabled as i32,
            writable_paths: vec![],
            readonly_paths: vec![],
            environment: std::collections::HashMap::new(),
            timeout_ms: None,
            policy_script: None,
        };
        let args = build_bwrap_args(&run, &profile, Path::new(".")).unwrap();
        assert!(args.contains(&"--unshare-net".to_string()));
    }

    #[test]
    fn bwrap_args_allow_network_when_enabled() {
        let run = RunRequest {
            command: "curl".to_string(),
            args: vec![],
            cwd: None,
            env: std::collections::HashMap::new(),
            input: None,
            timeout_ms: None,
            max_output_bytes: None,
        };
        let profile = SandboxProfile {
            name: "net-on".to_string(),
            network: NetworkPolicy::NetworkEnabled as i32,
            writable_paths: vec![],
            readonly_paths: vec![],
            environment: std::collections::HashMap::new(),
            timeout_ms: None,
            policy_script: None,
        };
        let args = build_bwrap_args(&run, &profile, Path::new(".")).unwrap();
        assert!(!args.contains(&"--unshare-net".to_string()));
    }

    #[test]
    fn bwrap_args_bind_writable_and_readonly_paths() {
        let run = RunRequest {
            command: "make".to_string(),
            args: vec![],
            cwd: Some("/workspace".to_string()),
            env: std::collections::HashMap::new(),
            input: None,
            timeout_ms: None,
            max_output_bytes: None,
        };
        let profile = SandboxProfile {
            name: "build".to_string(),
            network: NetworkPolicy::NetworkEnabled as i32,
            writable_paths: vec!["/workspace".to_string()],
            readonly_paths: vec!["/workspace/src".to_string()],
            environment: std::collections::HashMap::new(),
            timeout_ms: None,
            policy_script: None,
        };
        let args = build_bwrap_args(&run, &profile, Path::new("/workspace")).unwrap();
        assert!(args.contains(&"--bind".to_string()));
        assert!(args.contains(&"--ro-bind".to_string()));
        assert!(args.contains(&"--chdir".to_string()));
        assert!(args.contains(&"/workspace".to_string()));
    }

    #[test]
    fn bwrap_args_set_environment_variables() {
        let run = RunRequest {
            command: "cargo".to_string(),
            args: vec!["build".to_string()],
            cwd: None,
            env: std::collections::HashMap::new(),
            input: None,
            timeout_ms: None,
            max_output_bytes: None,
        };
        let mut environment = std::collections::HashMap::new();
        environment.insert("CARGO_HOME".to_string(), "/tmp/cargo".to_string());
        let profile = SandboxProfile {
            name: "cargo".to_string(),
            network: NetworkPolicy::NetworkEnabled as i32,
            writable_paths: vec![],
            readonly_paths: vec![],
            environment,
            timeout_ms: None,
            policy_script: None,
        };
        let args = build_bwrap_args(&run, &profile, Path::new(".")).unwrap();
        let setenv = args.iter().position(|a| a == "--setenv").unwrap();
        assert_eq!(args[setenv + 1], "CARGO_HOME");
        assert_eq!(args[setenv + 2], "/tmp/cargo");
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn linux_bwrap_runs_echo() {
        if !bwrap_available() {
            eprintln!("skipping linux_bwrap_runs_echo: bwrap not available");
            return;
        }
        let executor = RestrictedExecutor::new();
        let result = executor
            .run(
                &RunRequest {
                    command: "echo".to_string(),
                    args: vec!["hello".to_string()],
                    cwd: None,
                    env: std::collections::HashMap::new(),
                    input: None,
                    timeout_ms: Some(5000),
                    max_output_bytes: None,
                },
                &SandboxProfile {
                    name: "echo".to_string(),
                    network: NetworkPolicy::NetworkDisabled as i32,
                    writable_paths: vec![],
                    readonly_paths: vec![],
                    environment: std::collections::HashMap::new(),
                    timeout_ms: None,
                    policy_script: None,
                },
            )
            .await
            .unwrap();
        assert_eq!(result.exit_code, 0);
        assert_eq!(result.stdout.trim(), "hello");
    }

    #[cfg(target_os = "linux")]
    fn bwrap_available() -> bool {
        std::process::Command::new("bwrap")
            .arg("--version")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }
}
