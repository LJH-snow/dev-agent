import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const maxBuffer = 4 * 1024 * 1024;

async function run(command, args, options = {}) {
  try {
    return await execFileAsync(command, args, {
      cwd: repositoryRoot,
      env: process.env,
      maxBuffer,
      ...options,
    });
  } catch (error) {
    const stdout = typeof error?.stdout === "string" ? error.stdout : "";
    const stderr = typeof error?.stderr === "string" ? error.stderr : "";
    const detail = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
    throw new Error(
      `${command} ${args.join(" ")} failed${error?.code === undefined ? "" : ` with ${error.code}`}${
        detail ? `:\n${detail}` : ""
      }`,
      { cause: error }
    );
  }
}

function assertSuccessful(result, label) {
  assert.equal(result.stderr, "", `${label} should not write diagnostics: ${result.stderr}`);
  return result.stdout;
}

async function runInstalled(bin, args, cwd, env) {
  const result = await run(bin, args, { cwd, env });
  return {
    stdout: assertSuccessful(result, `${bin} ${args.join(" ")}`),
    stderr: result.stderr,
  };
}

async function buildPackageUnlessSkipped() {
  if (process.argv.includes("--skip-build")) {
    return;
  }
  // A fresh checkout has no workspace dist declarations. Build the complete
  // workspace first, then create the standalone CLI bundle.
  await run(packageManager, ["build"]);
  await run(packageManager, ["--filter", "@agent_cli/cli", "run", "build:package"]);
}

async function main() {
  await buildPackageUnlessSkipped();

  const stagingRoot = await mkdtemp(join(tmpdir(), "dev-agent-cli-package-smoke-"));
  try {
    const packDirectory = join(stagingRoot, "pack");
    const installDirectory = join(stagingRoot, "install");
    const homeDirectory = join(stagingRoot, "home");
    // Keep npm's user configuration isolated while allowing repeat/offline
    // verification to reuse a caller-selected, trusted package cache.
    const requestedCacheDirectory = process.env.DEV_AGENT_PACKAGE_SMOKE_NPM_CACHE?.trim();
    const cacheDirectory = requestedCacheDirectory
      ? resolve(requestedCacheDirectory)
      : join(stagingRoot, "npm-cache");
    const projectDirectory = join(stagingRoot, "external-project");
    const launcherDirectory = join(stagingRoot, "launcher");
    await Promise.all([
      mkdir(packDirectory, { recursive: true }),
      mkdir(installDirectory, { recursive: true }),
      mkdir(homeDirectory, { recursive: true }),
      mkdir(cacheDirectory, { recursive: true }),
      mkdir(projectDirectory, { recursive: true }),
      mkdir(launcherDirectory, { recursive: true }),
    ]);

    await writeFile(join(projectDirectory, "entry.ts"), "export const externalValue = 42;\n", "utf8");

    await run(packageManager, [
      "--filter",
      "@agent_cli/cli",
      "pack",
      "--pack-destination",
      packDirectory,
    ]);
    const packedFiles = (await readdir(packDirectory)).filter((file) => file.endsWith(".tgz"));
    assert.equal(packedFiles.length, 1, `expected one CLI tarball, found ${packedFiles.join(", ")}`);
    const tarballPath = join(packDirectory, packedFiles[0]);

    const isolatedEnv = {
      ...process.env,
      HOME: homeDirectory,
      USERPROFILE: homeDirectory,
      NPM_CONFIG_CACHE: cacheDirectory,
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      ALL_PROXY: "",
      NO_PROXY: "*",
      DEV_AGENT_MODEL_PROVIDER: "ollama",
      DEV_AGENT_SESSION_DIR: join(homeDirectory, "sessions"),
      DEV_AGENT_MEMORY_FILE: join(homeDirectory, "memory.json"),
      DEV_AGENT_CONFIG_FILE: join(homeDirectory, "missing-config.json"),
    };
    await run(npmCommand, [
      "install",
      "--prefix",
      installDirectory,
      "--no-save",
      "--ignore-scripts",
      "--prefer-offline",
      "--no-audit",
      "--no-fund",
      tarballPath,
    ], { env: isolatedEnv });

    const binPath = join(
      installDirectory,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "dev-agent.cmd" : "dev-agent"
    );
    await access(binPath);
    const resolvedBinPath = await realpath(binPath);
    const resolvedInstallDirectory = await realpath(installDirectory);
    const binRelativePath = relative(resolvedInstallDirectory, resolvedBinPath);
    assert.ok(
      binRelativePath &&
        !isAbsolute(binRelativePath) &&
        binRelativePath !== ".." &&
        !/^\.\.(?:[\\/]|$)/.test(binRelativePath),
      `installed bin must stay inside the staging install: ${resolvedBinPath}`
    );

    const installedManifestPath = join(
      installDirectory,
      "node_modules",
      "@agent_cli",
      "cli",
      "package.json"
    );
    const installedManifest = JSON.parse(await readFile(installedManifestPath, "utf8"));
    assert.equal(installedManifest.bin?.["dev-agent"], "dist/cli.js");
    assert.equal(installedManifest.license, "MIT");
    assert.equal(
      installedManifest.repository?.url,
      "git+https://github.com/LJH-snow/dev-agent.git"
    );
    assert.equal(
      installedManifest.homepage,
      "https://github.com/LJH-snow/dev-agent#readme"
    );
    assert.equal(
      installedManifest.bugs?.url,
      "https://github.com/LJH-snow/dev-agent/issues"
    );
    for (const [name, version] of Object.entries(installedManifest.dependencies ?? {})) {
      assert.ok(!String(version).startsWith("workspace:"), `${name} has a workspace runtime dependency`);
    }
    assert.equal(typeof installedManifest.dependencies?.typescript, "string");
    assert.deepEqual(
      Object.keys(installedManifest.dependencies ?? {}),
      ["ink", "react", "signal-exit", "typescript"]
    );

    const installedBundlePath = join(
      installDirectory,
      "node_modules",
      "@agent_cli",
      "cli",
      "dist",
      "cli.js"
    );
    await access(join(installDirectory, "node_modules", "@agent_cli", "cli", "LICENSE"));
    const installedBundle = await readFile(installedBundlePath, "utf8");
    assert.ok(installedBundle.startsWith("#!/usr/bin/env node\n"));
    assert.equal(
      installedBundle.includes(repositoryRoot),
      false,
      "installed bundle must not contain a checkout-specific absolute path"
    );

    const version = await runInstalled(binPath, ["--version"], launcherDirectory, isolatedEnv);
    assert.match(version.stdout, /^dev-agent \d+\.\d+\.\d+\n$/);

    const tools = await runInstalled(binPath, ["--tools", "--json"], launcherDirectory, isolatedEnv);
    const toolList = JSON.parse(tools.stdout);
    assert.ok(Array.isArray(toolList));
    assert.ok(toolList.some((tool) => tool.name === "filesystem"));

    const indexed = await runInstalled(
      binPath,
      ["--cwd", projectDirectory, "--index", ".", "--json"],
      launcherDirectory,
      isolatedEnv
    );
    const report = JSON.parse(indexed.stdout);
    assert.equal(report.path, projectDirectory);
    assert.equal(report.files, 1);
    assert.equal(report.symbols, 1);
    await access(join(projectDirectory, ".dev-agent", "index.json"));

    console.log("CLI package smoke passed");
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

await main();
