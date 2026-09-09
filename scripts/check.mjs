import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const requiredDirs = [
  "apps/cli",
  "apps/desktop",
  "packages/agent-core",
  "packages/model",
  "packages/tools",
  "packages/mcp",
  "packages/code-intelligence",
  "packages/executor",
  "runtime/rust",
  "configs",
  "docs",
  "tests",
  "scripts",
];

const requiredFiles = [
  ".gitignore",
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "README.md",
  "LICENSE",
];

const typeScriptPackages = [
  "apps/cli",
  "packages/agent-core",
  "packages/model",
  "packages/tools",
  "packages/mcp",
  "packages/code-intelligence",
  "packages/executor",
];

const errors = [];

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

for (const dir of requiredDirs) {
  if (!isDirectory(join(root, dir))) {
    errors.push(`missing directory: ${dir}`);
  }
}

for (const file of requiredFiles) {
  if (!existsSync(join(root, file))) {
    errors.push(`missing file: ${file}`);
  }
}

for (const pkg of typeScriptPackages) {
  for (const file of ["package.json", "tsconfig.json", "src/index.ts", "README.md"]) {
    if (!existsSync(join(root, pkg, file))) {
      errors.push(`missing ${pkg}/${file}`);
    }
  }
}

const workspace = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
for (const glob of ["apps/*", "packages/*"]) {
  if (!workspace.includes(`"${glob}"`)) {
    errors.push(`pnpm-workspace.yaml is missing package glob: ${glob}`);
  }
}

if (errors.length > 0) {
  console.error("Structure check failed:");
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}

console.log(
  `Structure check passed: ${requiredDirs.length} directories and ${requiredFiles.length + typeScriptPackages.length * 4} expected files verified.`
);
