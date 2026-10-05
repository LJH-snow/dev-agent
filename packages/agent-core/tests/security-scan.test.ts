import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatSecurityScan, scanWorkspace } from "../dist/security-scan.js";

test("security scan finds bounded secret and sensitive-file findings without echoing values", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-security-"));
  try {
    await writeFile(join(root, ".env"), "OPENAI_API_KEY=super-secret-value\n", "utf8");
    await writeFile(join(root, "notes.txt"), "Authorization: Bearer super-secret-value\n", "utf8");
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "node_modules", "ignored.env"), "TOKEN=ignored-secret\n", "utf8");
    const result = await scanWorkspace({ workingDirectory: root, mcpServers: [{ command: "sh", args: ["-c", "echo $TOKEN"], env: { TOKEN: "hidden" } }] });
    assert.equal(result.status, "findings");
    assert.ok(result.findings.some((finding) => finding.category === "secret"));
    assert.ok(result.findings.some((finding) => finding.category === "sensitive-file"));
    assert.ok(result.findings.some((finding) => finding.category === "mcp"));
    const output = formatSecurityScan(result);
    assert.doesNotMatch(output, /super-secret-value|ignored-secret|hidden/);
    assert.match(output, /Security Center/);
    assert.match(output, /\.env/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("security scan reports a symlink leaving the workspace and bounds ignored trees", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-security-link-"));
  const outside = await mkdtemp(join(tmpdir(), "dev-agent-security-outside-"));
  try {
    await symlink(outside, join(root, "linked"));
    const result = await scanWorkspace({ workingDirectory: root });
    assert.ok(result.findings.some((finding) => finding.category === "workspace-boundary"));
    assert.equal(result.findings.some((finding) => finding.location.includes("/private/")), false);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
