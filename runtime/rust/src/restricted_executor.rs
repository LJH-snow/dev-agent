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

    #[cfg(not(target_os = "macos"))]
    pub async fn run(
        &self,
        _run: &RunRequest,
        _profile: &SandboxProfile,
    ) -> Result<RunResult, RestrictedError> {
        Err(RestrictedError::Unsupported(
            "macOS sandbox-exec is the only restricted backend currently wired in".to_string(),
        ))
    }
}

impl Default for RestrictedExecutor {
    fn default() -> Self {
        Self::new()
    }
}

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

#[cfg(not(target_os = "macos"))]
fn build_sandbox_profile(
    _network: NetworkPolicy,
    _writable_paths: &[String],
    _readonly_paths: &[String],
    _base_dir: &Path,
) -> Result<String, RestrictedError> {
    Err(RestrictedError::Unsupported(
        "profile generation only supports the macOS backend".to_string(),
    ))
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

fn quote_sandbox_path(path: &str) -> String {
    let escaped = path.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

#[cfg(target_os = "macos")]
const RESOURCE_MAX_CPU_SECS: libc::rlim_t = 30;
#[cfg(target_os = "macos")]
const RESOURCE_MAX_FILE_SIZE_BYTES: libc::rlim_t = 256 * 1024 * 1024;
#[cfg(target_os = "macos")]
const RESOURCE_MAX_OPEN_FILES: libc::rlim_t = 4096;
#[cfg(target_os = "macos")]
const RESOURCE_MAX_PROCESSES: libc::rlim_t = 256;

#[cfg(target_os = "macos")]
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
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::Other,
                        format!("setrlimit({resource}) failed: {err}"),
                    ));
                }
            }
            Ok(())
        });
    }
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
}
