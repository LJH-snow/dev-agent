import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const maxBuffer = 4 * 1024 * 1024;
const runtimeVersion = "0.2.0";
const runtimeRelease = "0.1.6";

async function run(command, args, options = {}) {
  try {
    return await execFileAsync(command, args, {
      cwd: repositoryRoot,
      env: process.env,
      maxBuffer,
      ...options,
    });
  } catch (error) {
    const detail = [error.stdout, error.stderr].filter(Boolean).join("\n");
    throw new Error(
      `${command} ${args.join(" ")} failed${error.code === undefined ? "" : ` with ${error.code}`}${
        detail ? `:\n${detail}` : ""
      }`,
      { cause: error }
    );
  }
}

async function runInstalled(binPath, args, cwd, env) {
  const result = await run(binPath, args, { cwd, env });
  assert.equal(result.stderr, "", `${binPath} ${args.join(" ")} must not write stderr`);
  return JSON.parse(result.stdout);
}

async function main() {
  if (!process.argv.includes("--skip-build")) {
    await run(packageManager, ["build"]);
    await run(packageManager, ["--filter", "@agent_cli/cli", "run", "build:package"]);
  }

  const stagingRoot = await mkdtemp(join(tmpdir(), "dev-agent-runtime-install-smoke-"));
  try {
    const packDirectory = join(stagingRoot, "pack");
    const installDirectory = join(stagingRoot, "install");
    const homeDirectory = join(stagingRoot, "home");
    const runtimeDirectory = join(stagingRoot, "runtime");
    const launcherDirectory = join(stagingRoot, "launcher");
    await Promise.all([
      mkdir(packDirectory, { recursive: true }),
      mkdir(installDirectory, { recursive: true }),
      mkdir(homeDirectory, { recursive: true }),
      mkdir(runtimeDirectory, { recursive: true }),
      mkdir(launcherDirectory, { recursive: true }),
    ]);

    await run(packageManager, [
      "--filter",
      "@agent_cli/cli",
      "pack",
      "--pack-destination",
      packDirectory,
    ]);
    const tarballs = (await readdir(packDirectory)).filter((name) => name.endsWith(".tgz"));
    assert.equal(tarballs.length, 1);
    const tarballPath = join(packDirectory, tarballs[0]);

    const isolatedEnv = {
      ...process.env,
      HOME: homeDirectory,
      USERPROFILE: homeDirectory,
      DEV_AGENT_MODEL_PROVIDER: "ollama",
      DEV_AGENT_SESSION_DIR: join(homeDirectory, "sessions"),
      DEV_AGENT_CONFIG_FILE: join(homeDirectory, "missing-config.json"),
    };
    await run(npmCommand, [
      "install",
      "--prefix",
      installDirectory,
      "--no-save",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      tarballPath,
    ], { env: isolatedEnv });

    const binPath = join(installDirectory, "node_modules", ".bin", process.platform === "win32" ? "dev-agent.cmd" : "dev-agent");
    const realBinPath = await realpath(binPath);
    const realInstallDirectory = await realpath(installDirectory);
    assert.equal(realBinPath.startsWith(realInstallDirectory), true);
    const installedManifest = JSON.parse(
      await readFile(
        join(installDirectory, "node_modules", "@agent_cli", "cli", "package.json"),
        "utf8"
      )
    );
    assert.equal(typeof installedManifest.dependencies?.typescript, "string");
    assert.deepEqual(Object.keys(installedManifest.dependencies ?? {}), ["typescript"]);

    const runtimeArgs = [
      "--runtime-version",
      runtimeVersion,
      "--runtime-release",
      runtimeRelease,
      "--runtime-dir",
      runtimeDirectory,
      "--json",
    ];
    const before = await runInstalled(binPath, ["runtime", "status", ...runtimeArgs], launcherDirectory, isolatedEnv);
    assert.equal(before.state, "missing");

    const installed = await runInstalled(
      binPath,
      ["runtime", "install", ...runtimeArgs],
      launcherDirectory,
      isolatedEnv
    );
    assert.equal(installed.version, runtimeVersion);
    assert.equal(typeof installed.target, "string");
    assert.equal(installed.reused, false);
    await access(installed.path);

    const located = await runInstalled(binPath, ["runtime", "path", ...runtimeArgs], launcherDirectory, isolatedEnv);
    assert.equal(located.path, installed.path);

    const doctor = await runInstalled(
      binPath,
      ["--executor", "rust-sandbox", "--doctor", ...runtimeArgs],
      launcherDirectory,
      isolatedEnv
    );
    assert.equal(doctor.runtime.source, "runtime");
    assert.equal(doctor.runtime.runtimeVersion, runtimeVersion, JSON.stringify(doctor, null, 2));
    assert.equal(doctor.runtime.protocolVersion, 1);
    assert.equal(doctor.runtime.target, installed.target);
    assert.equal(doctor.runtime.state, "installed");
    assert.equal(doctor.runtime.configured, true);
    assert.equal(doctor.checks.some((check) => check.name === "rust runtime" && check.status === "ok"), true);
    assert.equal(JSON.stringify(doctor).includes(realInstallDirectory), false);
    assert.equal(JSON.stringify(doctor).includes(runtimeDirectory), false);

    const removed = await runInstalled(
      binPath,
      ["runtime", "remove", ...runtimeArgs],
      launcherDirectory,
      isolatedEnv
    );
    assert.equal(removed.removed, true);
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }

  console.log("Runtime install smoke passed");
}

await main();
