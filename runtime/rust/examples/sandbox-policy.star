# Example Starlark sandbox policy for dev-agent.
#
# This file demonstrates the policy shape evaluated by the embedded Starlark
# interpreter in the Rust runtime. The runtime binds `ctx` to this script,
# then calls `policy(ctx)` when the script defines that function.
#
# The Rust runtime provides the following values to the policy script:
#
#   ctx.command   - the command being run (e.g. "cargo", "npm")
#   ctx.args      - list of arguments (e.g. ["build", "--release"])
#   ctx.cwd       - working directory (optional)
#   ctx.writable_paths - list of paths the command may write to
#   ctx.readonly_paths  - list of paths the command may read from
#   ctx.network_policy  - "enabled", "disabled", or "loopback"
#
# A policy script must either evaluate to a bool directly or define
# `policy(ctx)` returning True to allow the command or False to deny it.

def allow_readonly_tooling(ctx):
    """Allow read-only tooling like ls, cat, find, git status."""
    readonly_commands = ["ls", "cat", "find", "git", "pwd", "which", "echo"]
    if ctx.command in readonly_commands:
        # For git, only allow read-only subcommands
        if ctx.command == "git":
            readonly_git = ["status", "log", "diff", "show", "branch", "remote"]
            return ctx.args[0] in readonly_git if ctx.args else False
        return True
    return False

def allow_build_commands(ctx):
    """Allow common build commands within the workspace."""
    build_commands = ["cargo", "npm", "yarn", "pnpm", "make", "go"]
    return ctx.command in build_commands

def deny_dangerous_commands(ctx):
    """Deny commands that are dangerous or unnecessary in a sandbox."""
    dangerous = ["rm", "sudo", "chmod", "chown", "mkfs", "dd", "shutdown", "reboot"]
    return ctx.command not in dangerous

def check_network_policy(ctx):
    """Enforce network policy: deny network access if policy says disabled."""
    if ctx.network_policy == "disabled":
        # Deny commands that typically need network
        network_commands = ["curl", "wget", "ssh", "scp", "git", "npm", "pip"]
        if ctx.command in network_commands:
            # Allow some commands only if they operate on local data
            if ctx.command == "git":
                local_only = ["status", "log", "diff", "show", "branch"]
                return ctx.args[0] in local_only if ctx.args else False
            return False
    return True

def policy(ctx):
    """Main policy entry point. Returns True to allow, False to deny."""
    return (
        deny_dangerous_commands(ctx) and
        check_network_policy(ctx) and
        (allow_readonly_tooling(ctx) or allow_build_commands(ctx))
    )
