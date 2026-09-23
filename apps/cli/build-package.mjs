import { build } from "esbuild";
import { access, chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const cliRoot = dirname(fileURLToPath(import.meta.url));
const entryPoint = resolve(cliRoot, "dist", "cli-entry.js");
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
  // Ink treats React Devtools as an optional peer and only loads it when
  // `DEV=true`. Its ESM import is still linked by Node even when that branch
  // is not taken, so replace the optional browser-only module with a no-op
  // during the production bundle instead of shipping it as a runtime dep.
  // signal-exit is a CommonJS dependency whose implementation uses
  // conditional dynamic require() calls for Node built-ins. Bundling it into
  // an ESM file makes esbuild emit a runtime __require shim, which fails after
  // npm installation. Keep it as a direct runtime dependency instead.
  external: ["signal-exit", "typescript"],
  plugins: [
    {
      name: "optional-react-devtools-core-stub",
      setup(buildContext) {
        buildContext.onResolve(
          { filter: /^react-devtools-core$/ },
          () => ({
            path: "dev-agent-react-devtools-core-stub",
            namespace: "dev-agent-stub",
          })
        );
        buildContext.onLoad(
          { filter: /.*/, namespace: "dev-agent-stub" },
          () => ({
            contents:
              "export default { initialize() {}, connectToDevTools() {} };",
            loader: "js",
          })
        );
      },
    },
  ],
  // Some Ink dependencies are CommonJS and use dynamic require() for Node
  // built-ins. Provide the ESM-compatible require bridge before the bundle
  // executes so those dependencies remain usable after installation.
  banner: {
    js: 'import { createRequire as __devAgentCreateRequire } from "node:module";\nconst require = __devAgentCreateRequire(import.meta.url);',
  },
  sourcemap: "external",
  legalComments: "none",
  logLevel: "info",
});

// npm preserves the executable bit for the bin target. Keep this explicit so
// clean checkouts and CI produce a directly runnable global command.
await chmod(outfile, 0o755);

console.log(`CLI package bundle written to ${outfile}`);
