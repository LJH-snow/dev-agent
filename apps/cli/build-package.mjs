import { build } from "esbuild";
import { access, chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const cliRoot = dirname(fileURLToPath(import.meta.url));
const entryPoint = resolve(cliRoot, "dist", "index.js");
const outfile = resolve(cliRoot, "dist", "cli.js");

try {
  await access(entryPoint);
} catch {
  throw new Error(`CLI build output is missing: ${entryPoint}. Run the CLI TypeScript build first.`);
}

await build({
  entryPoints: [entryPoint],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  // TypeScript exposes a CommonJS runtime that uses Node's dynamic require.
  // Keep it as an ordinary npm dependency instead of emitting an ESM shim that
  // cannot load Node built-ins after installation.
  external: ["typescript"],
  sourcemap: "external",
  legalComments: "none",
  logLevel: "info",
});

// npm preserves the executable bit for the bin target. Keep this explicit so
// clean checkouts and CI produce a directly runnable global command.
await chmod(outfile, 0o755);

console.log(`CLI package bundle written to ${outfile}`);
