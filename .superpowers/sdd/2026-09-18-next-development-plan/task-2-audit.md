# Task 2：剩余输入边界审计报告

- 审计日期：2026-09-18
- 审计基线：`a18e2cb`（`fix: bound CLI config file reads`）
- 审计工作树：独立 worktree；没有修改主工作树，也没有修改生产代码
- 审计范围：`apps/cli/src`、`apps/desktop/src`、`packages/agent-core/src`、`packages/tools/src`、`packages/mcp/src`、`packages/model/src`、`packages/runtime-manager/src`、`runtime/rust/src` 及其测试
- 方法：先对 `readFile`、`readFileSync`、`createReadStream`、`JSON.parse`、`JSON.stringify`、`readdir`、`stat` 做全量 inventory，再沿调用者追踪到输入来源、读取前保护、输出边界和测试证据。

## 1. 审计结论

本轮 inventory 共得到 262 个匹配项。多数 `JSON.stringify` 是受控状态的序列化，不是外部输入读取；多数 `JSON.parse` 已经由网络响应、MCP frame 或上层固定文件大小保护。当前值得进入实现队列的缺口分为两组：

1. **计划中已经确认的三个缺口**：runtime completion metadata、Desktop session directory discovery、CLI 内置 MCP workspace resource。这三项与下一阶段计划的 Task 3A/3B/3C 对应。
2. **审计额外发现的 CLI/工具读取缺口**：CLI index refresh、doctor、project init、Desktop config、Filesystem list，以及 CLI session list。它们不应在本轮擅自修改；主代理应在当前三项完成后单独安排后续任务。

已确认应保留的边界包括：memory 文件、Filesystem whole-file 操作、workflow 输入、CLI 主配置、模型响应、MCP frame、Desktop HTTP body/response、runtime manifest/archive 下载等。

## 2. 已覆盖边界：`PRESERVE`

| 路径 / 入口 | 输入来源与现有保护 | 测试证据 | 决策 |
| --- | --- | --- | --- |
| `packages/agent-core/src/memory.ts:readEntries`, `readMemoryFile`, `persist` | `stat` 后再 `readFile`；memory 文件读写固定限制为 16 MiB；写入前也检查序列化后的字节数 | `packages/agent-core/tests/memory.test.ts`：读超 16 MiB、写超 16 MiB 且保留旧内容 | **PRESERVE** |
| `packages/tools/src/filesystem.ts:readFileRange`, `readSnapshot`, `editFile`, `patchFile` | `lstat` 后再整文件读取；整文件读取固定限制为 16 MiB；行范围只限制返回行数，不绕过文件大小保护 | `packages/tools/tests/tools-edge-cases.test.ts`：read/edit 超 16 MiB；Filesystem snapshot 也经过同一 guard | **PRESERVE** |
| `apps/cli/src/config.ts:loadConfig` | `statSync` 后再 `readFileSync`；用户/项目 config 固定限制为 1 MiB，超限按默认配置处理 | `apps/cli/tests/config.test.ts`：超 1 MiB 配置被忽略 | **PRESERVE** |
| `apps/cli/src/workflow-command.ts:readChanges`, `executeApply` | plan/changes 文件在 `readFile` 前用 `stat` 检查，固定限制为 16 MiB | `apps/cli/tests/workflow-command.test.ts`：plan、changes、workflow plan 超 16 MiB | **PRESERVE** |
| `packages/model/src/json-response.ts` 及 `openai.ts`、`anthropic.ts`、`gemini.ts`、`ollama.ts` | 成功 JSON 响应通过 bounded stream reader；streaming line 和错误 body 也有固定上限，之后才 `JSON.parse` | provider 源码中的 `MAX_SUCCESS_JSON_BYTES`、line-reader/error-body 保护；各 provider 测试覆盖正常与失败路径 | **PRESERVE** |
| `packages/mcp/src/stdio-client.ts`、`packages/mcp/src/server.ts`、`packages/mcp/src/framing.ts` | MCP frame 在累积、解析前以及序列化响应前都检查 `maxFrameBytes`；默认 8 MiB，超限返回协议错误 | `packages/mcp/tests/mcp-frame-limits.test.ts`：未结束输入、incoming frame、outgoing frame | **PRESERVE** |
| `apps/desktop/src/server.ts` HTTP body、静态文件、history/export、SSE 和 ID 入口 | request body、静态文件、history/export response 固定限制为 1 MiB；session/change-set/approval/filter 等字符串有长度限制；输出保持 metadata-only | `apps/desktop/tests/server.test.ts`、`apps/desktop/tests/server-edge-cases.test.ts`：body、静态文件、history/export、ID/filter 超限 | **PRESERVE** |
| `packages/runtime-manager/src/manager.ts` manifest/archive download | 默认下载器在流读取时限制 manifest 1 MiB、archive 16 MiB；`manifest.ts` 做严格 schema/target/path/size 校验 | `packages/runtime-manager/tests/runtime-manager.test.ts`：manifest/archive 固定下载上限和 streamed response cancel | **PRESERVE** |
| `packages/runtime-manager/src/archive.ts:extractTarGz` | gzip 解压输出限制 32 MiB；tar entry、PAX size、路径、重复项、link/special file 均校验；`hashFile` 只读取已经经过 staging/health 边界的本地 runtime binary | `packages/runtime-manager/tests/runtime-manager.test.ts` 的 archive/install/health 路径 | **PRESERVE** |
| `packages/runtime-manager/src/manifest.ts:parseManifest` | 公开 parser 本身接受字符串，但产品调用链在 `manager.ts` 中先执行 `assertManifestDownloadSize`，再 parse/validate；manifest artifact 数量和字段也有固定约束 | `packages/runtime-manager/tests/runtime-manager.test.ts` 的 manifest download/validation tests | **PRESERVE** |
| `packages/tools/src/code-search.ts` 当前 persisted-index reader / source scanner | 当前基线已对 persisted index 和 source scan 建立 16 MiB 文件边界；大源文件跳过，大 index 触发 full scan | `packages/tools/tests/code-search-cache.test.ts`、`packages/tools/tests/code-search-persisted.test.ts` | **PRESERVE**（仍需与主工作树正在进行的 signature 兼容改动一起验证） |
| `apps/cli/src/config-command.ts` | 主工作树已有未提交的 1 MiB config validate/show 边界改动；本审计工作树没有接管该文件 | 主工作树 dirty diff 与 `apps/cli/tests/config-command.test.ts` 是待主代理完成的证据 | **PRESERVE**（pending；不要在本报告分支重复修改） |

## 3. 可复现缺口：`FIX`

以下条目均是“读取前没有应用层固定大小/数量边界”的可复现缺口。本轮只记录，不修改生产代码。命令中的 `REPO` 指仓库根目录；先按项目现有流程构建对应 package，再执行复现命令。所有示例都使用临时目录，不应在主工作树生成大文件。

### F-01：runtime completion metadata 在 parse 前无大小保护

- **路径 / 调用链：** `packages/runtime-manager/src/manager.ts:inspect` → `lstat(paths.installMetadataPath)` / `lstat(paths.completePath)` → `readFile` → `parseInstallMetadata` / marker compare。
- **输入来源：** 本地 runtime cache 的 `install.json` 和 `.complete`；cache 目录虽然由 runtime manager 创建，但可能被用户、安装残留或其他进程写入。
- **现状：** 只检查 regular file / 非 symlink，没有在两个 `readFile` 前检查 `size`。
- **影响：** 超大的 completion metadata 会先被完整读入字符串，再进入 JSON parser；错误最终可能变成 generic corrupt status，但内存分配已经发生。
- **建议边界：** 与现有 runtime metadata 契约一致，增加固定 1 MiB（或计划中已确定的固定值）pre-read guard；超限继续返回现有 generic `corrupt` 状态，不回显路径、字节数或 parser error。
- **最小复现命令：**

```sh
export REPO="$PWD"
pnpm --filter @dev-agent/runtime-manager run build
node --input-type=module <<'NODE'
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeManager, getRuntimePaths } from "./packages/runtime-manager/dist/index.js";

const root = await mkdtemp(join(tmpdir(), "dev-agent-runtime-"));
const paths = getRuntimePaths(root, "0.1.8", "aarch64-apple-darwin");
await mkdir(paths.targetDir, { recursive: true });
await writeFile(paths.installMetadataPath, "{" + "x".repeat(17 * 1024 * 1024) + "}");
await writeFile(paths.completePath, "");
const manager = new RuntimeManager({ runtimeDir: root, platform: "darwin", arch: "arm64" });
console.log(await manager.status("0.1.8", "aarch64-apple-darwin"));
NODE
```

### F-02：Desktop session directory discovery 先完整 materialize 再 slice

- **路径 / 调用链：** `apps/desktop/src/server.ts:listSessions` → `readdir(sessionsDir())` → filter/sort → `slice(0, maxSessionListEntries)`。
- **输入来源：** `DEV_AGENT_SESSION_DIR` 或用户 home 下的 session 目录。
- **现状：** 返回结果有 256 条上限，但 `readdir` 先把整个目录名数组读入内存；因此响应 cap 没有保护目录枚举本身。
- **影响：** 大量 session 文件名会在返回 256 条之前造成不必要的内存和排序成本；每个候选还会尝试读 metadata/evidence。
- **建议边界：** 使用 streaming directory enumeration 或等价的 bounded candidate collection；保留当前 256 条结果、known in-memory session、确定性排序和 metadata-only 输出。
- **最小复现命令：**

```sh
export REPO="$PWD"
pnpm --filter @dev-agent/desktop run build
TMP_SESSION_DIR="$(mktemp -d)"
for i in $(seq -w 1 10000); do : > "$TMP_SESSION_DIR/session-$i.json"; done
DEV_AGENT_SESSION_DIR="$TMP_SESSION_DIR" node --input-type=module <<'NODE'
import { listSessions } from "./apps/desktop/dist/server.js";
const rows = await listSessions();
console.log({ returned: rows.length, cap: 256 });
NODE
```

### F-03：CLI 内置 MCP workspace resource 在 frame 限制前完整枚举目录

- **路径 / 调用链：** `apps/cli/src/index.ts:runMcpServer` 的 `dev-agent://workspace` resource → `readdir(options.workingDirectory)` → sort/map/join → MCP server response framing。
- **输入来源：** MCP host 选择的 working directory。
- **现状：** MCP frame 在 response 序列化后有 8 MiB 限制，但 workspace reader 在此之前已经 materialize 所有 directory entries 和完整文本。
- **影响：** frame cap 只能限制传输，不能限制目录枚举和中间字符串分配；超大目录还会在 response 被拒绝前消耗内存。
- **建议边界：** 按计划 Task 3C 扩展 resource reader 的 bounded-read context；workspace resource 按字节预算停止枚举，响应超限在 framing 前以稳定 JSON-RPC error 返回。
- **最小复现命令：**

```sh
export REPO="$PWD"
pnpm --filter @agent_cli/cli run build
TMP_WORKSPACE="$(mktemp -d)"
for i in $(seq -w 1 100000); do : > "$TMP_WORKSPACE/file-$i"; done
{
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"audit","version":"1"}}}'
  printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}'
  printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"resources/read","params":{"uri":"dev-agent://workspace"}}'
} | (cd "$TMP_WORKSPACE" && node "$REPO/apps/cli/dist/index.js" --mcp-server)
```

### F-04：CLI index refresh 对 persisted index 和源文件都无 pre-read size guard

- **路径 / 调用链：**
  - `apps/cli/src/index-command.ts:readPersistedIndex` → `readFile(indexPath, "utf8")` → `JSON.parse`。
  - `apps/cli/src/index-command.ts:collectFiles` → `stat` 只记录 `mtimeMs/size/ctimeMs` → `readSource` → `readFile(filePath, "utf8")`。
- **输入来源：** project-local `.dev-agent/index.json` 和 indexed project 中的 supported source files。
- **现状：** 当前 CLI index refresh 没有复用 `code-search` 的 persisted-index/source 16 MiB guard；`stat` 记录 signature，但没有在 `readSource` 前根据 size 跳过文件。
- **影响：** 任意受支持扩展名的大文件，或 project-local 的大 index，会被整文件读入并 parse/scan；这与同仓库 `code-search` 的固定边界不一致。
- **建议边界：** 复用同一固定 16 MiB read limit；超大 persisted index 按损坏/不可用处理并 fallback，超大源文件按稳定 warning/skip 行为处理；不要把 source 内容或绝对路径放进公开错误。
- **最小复现命令：**

```sh
export REPO="$PWD"
pnpm --filter @agent_cli/cli run build
TMP_INDEX_PROJECT="$(mktemp -d)"
mkdir -p "$TMP_INDEX_PROJECT/src" "$TMP_INDEX_PROJECT/.dev-agent"
python3 - "$TMP_INDEX_PROJECT" <<'PY'
import json
import pathlib
import sys
root = pathlib.Path(sys.argv[1])
(root / "src" / "large.ts").write_text('export const value = "' + ('x' * (17 * 1024 * 1024)) + '";\n')
(root / ".dev-agent" / "index.json").write_text(json.dumps({
    "version": 1,
    "files": {},
    "symbols": [],
    "signatures": {},
    "padding": "x" * (17 * 1024 * 1024),
}))
PY
node "$REPO/apps/cli/dist/index.js" index refresh --cwd "$TMP_INDEX_PROJECT" --json
```

### F-05：CLI doctor 重复读取 config 时绕过主 loader 的 1 MiB 限制

- **路径 / 调用链：** `apps/cli/src/index.ts` 先调用受限的 `loadConfig`，随后 `apps/cli/src/doctor.ts:checkConfig` 再直接 `readFile(path, "utf8")` → `JSON.parse`。
- **输入来源：** `--config` / `DEV_AGENT_CONFIG_FILE` / 默认用户 config。
- **现状：** 主 loader 已有 1 MiB guard，但 doctor 的诊断 reader 没有 stat-before-read，因此大文件仍会被第二次完整读取。
- **影响：** `--doctor` 不能继承 config 读取契约；大配置在诊断阶段仍可能造成不必要的内存分配。
- **建议边界：** doctor 使用共享受限读取 helper，超限返回不泄露 path/bytes 的稳定 warning；正常、小文件、坏 JSON 的 doctor 输出保持不变。
- **最小复现命令：**

```sh
export REPO="$PWD"
pnpm --filter @agent_cli/cli run build
TMP_HOME="$(mktemp -d)"
mkdir -p "$TMP_HOME/.dev-agent"
python3 - "$TMP_HOME" <<'PY'
import pathlib
import sys
p = pathlib.Path(sys.argv[1]) / ".dev-agent" / "config.json"
p.write_text('{"defaultProvider":"ollama","padding":"' + ('x' * (1024 * 1024)) + '"}')
PY
HOME="$TMP_HOME" node "$REPO/apps/cli/dist/index.js" --doctor --json
```

### F-06：project init 读取现有 `.gitignore` 时没有大小边界

- **路径 / 调用链：** `apps/cli/src/project-init.ts:initializeProject` / `updateGitignore` → `readFile(gitignorePath, "utf8")`。
- **输入来源：** 用户指定 working directory 中已有的 `.gitignore`。
- **现状：** init 为判断规则是否存在而完整读入 `.gitignore`，没有 `stat` 或固定上限。
- **影响：** 一个非常大的 project-controlled `.gitignore` 会在 `init --gitignore` 中被完整读入两次；这是与其他 project-local input 不一致的内存边界。
- **建议边界：** 采用固定 project-file read limit；超限返回稳定的 init input error，不执行 append；保留 dry-run、idempotence 和现有 JSON 输出语义。
- **最小复现命令：**

```sh
export REPO="$PWD"
pnpm --filter @agent_cli/cli run build
TMP_INIT_PROJECT="$(mktemp -d)"
python3 - "$TMP_INIT_PROJECT" <<'PY'
import pathlib
import sys
p = pathlib.Path(sys.argv[1]) / ".gitignore"
p.write_text("# generated\n" + ("x" * (17 * 1024 * 1024)))
PY
node "$REPO/apps/cli/dist/index.js" init --cwd "$TMP_INIT_PROJECT" --gitignore --json
```

### F-07：Filesystem `list` 在 tool-output 截断之前完整 materialize 目录

- **路径 / 调用链：** `packages/tools/src/filesystem.ts:FilesystemTool.execute(action="list")` → `readdir` → `entries.map(...)`；之后才由 `packages/agent-core/src/tools.ts:runTool` 对 JSON tool result 做字符截断。
- **输入来源：** agent working directory 下用户/项目控制的目录。
- **现状：** `runTool` 的 50,000 字符输出上限保护传输给模型的结果，但不能限制 `readdir` 返回的 entries 数组或 `map` 产生的完整对象数组。
- **影响：** 大目录会先完整分配，再被下游截断；工具层缺少与 MCP resource 一致的数量/字节预算。
- **建议边界：** 为 `list` 增加 bounded enumeration 和稳定的 `truncated` metadata；不得改变 `read/write/edit/patch` 的路径或权限语义。
- **最小复现命令：**

```sh
export REPO="$PWD"
pnpm --filter @dev-agent/tools run build
TMP_LIST_DIR="$(mktemp -d)"
for i in $(seq -w 1 100000); do : > "$TMP_LIST_DIR/file-$i"; done
(cd "$TMP_LIST_DIR" && node --input-type=module <<'NODE'
const { FilesystemTool } = await import(`${process.env.REPO}/packages/tools/dist/filesystem.js`);
const result = await new FilesystemTool().execute({ action: "list", path: "." });
console.log({ returned: result.entries.length });
NODE
)
```

### F-08：CLI session list 没有 directory-entry 数量上限

- **路径 / 调用链：** `apps/cli/src/index.ts:listSessions` → `readdir(sessionDir)` → filter → 为每个 `.json` 调 `stat`、`FileMemory.getMetadata`、`evidenceSummary` → 完整排序和输出。
- **输入来源：** `DEV_AGENT_SESSION_DIR` 或用户 home/project session directory。
- **现状：** session 文件内容本身由 `FileMemory` 限制，但目录 entry 数量、候选数量、rows 数组和排序没有固定上限。
- **影响：** session 文件数量很大时，CLI `sessions` 会逐个读取 metadata/evidence，耗时和内存随目录规模增长；与 Desktop 已有 256-entry response cap 不一致。
- **建议边界：** 先决定 CLI 是否需要完整列表契约；若保留完整列表，应采用 streaming + 时间排序预算或显式分页；若不需要，则复用 256 条 metadata-only cap 并记录 `truncated`。
- **最小复现命令：**

```sh
export REPO="$PWD"
pnpm --filter @agent_cli/cli run build
TMP_SESSION_DIR="$(mktemp -d)"
for i in $(seq -w 1 10000); do : > "$TMP_SESSION_DIR/session-$i.json"; done
DEV_AGENT_SESSION_DIR="$TMP_SESSION_DIR" node "$REPO/apps/cli/dist/index.js" --session-list --json
```

## 4. 需要产品/性能证据后再决定：`NEEDS-EVIDENCE`

| 路径 / 入口 | 观察 | 为什么暂不直接归为 FIX |
| --- | --- | --- |
| `apps/desktop/src/chat-session.ts:loadMcpServers` | `DEV_AGENT_MCP_SERVERS` 直接 `JSON.parse`，`args`、`env` 的条目数和字符串长度没有应用层 schema 上限 | 环境变量自身有操作系统级大小约束，且这是显式 operator configuration；需要先确定 MCP server 数量/args/env 的产品契约，再决定固定 byte/shape limit，否则容易破坏现有配置兼容性 |
| `apps/cli/src/index-command.ts:collectFiles`、`packages/tools/src/code-search.ts:collectSignatures` | 递归扫描的 directory entry 数量没有固定总量上限；单文件边界已经存在 | 大项目天然会有任意文件数量，当前 `maxDepth`、ignore/exclude 和单文件 16 MiB 是主要 workload controls；需要 benchmark/产品预算决定是否增加 `maxFiles`，不能仅凭 `readdir` 就改变 index 语义 |
| `packages/tools/src/filesystem.ts` rollback internals、`packages/runtime-manager/src/manager.ts:isDirectoryEmpty` | 内部用于校验目录 post-image 或清理 runtime cache 的 `readdir` 可能随目录数量增长 | 这些目录由本程序创建并受其他写入/解压边界控制；需要针对最坏目录规模测量后再决定是否要 streaming，否则可能引入 rollback/cleanup 语义变化 |
| `packages/runtime-manager/src/manifest.ts:parseManifest` 直接作为库函数被调用时 | public API 可以接收任意很大的 string/Uint8Array | 产品网络调用链已经在 `manager.ts` 先做 1 MiB guard；若要限制 public API，需要先确认外部 library caller contract，不能把内部下载 guard 误当成公共 API 的 breaking change |

## 5. 重点审计到调用者/测试的对应关系

- **Memory：** `FileMemory.readEntries/readMemoryFile` 读取前走 `assertMemoryFileSize`；写入通过 `Buffer.byteLength` 约束；`memory.test.ts` 有读写超限测试。
- **Filesystem whole-file：** `readFileRange`、snapshot、edit、patch 都走 `assertReadFileSize`；`tools-edge-cases.test.ts` 锁定超 16 MiB 行为；但 `list` 不是 whole-file read，当前没有等价的 directory budget。
- **CLI config/workflow：** `loadConfig` 和 workflow plan/changes 已有固定边界；`doctor`、`project-init`、`index-command` 是同类 CLI 输入中尚未复用 guard 的旁路。
- **Model/MCP：** provider body 先 bounded stream 再 parse；MCP 先限制 line/frame 累积，再 parse/request/response；因此这些 `JSON.parse` 不应被单独误报为无界读取。
- **Desktop HTTP：** body、static、history/export 和 ID/filter 的 tests 已覆盖；Desktop session directory 的问题不在 response cap，而在 cap 之前的 `readdir` materialization。
- **Runtime：** manifest/archive 下载和 tar 解压有边界；completion metadata 是另一条本地 cache reader，当前没有继承下载/解压的大小契约。

## 6. 给主代理的交接建议

1. 先按既有计划完成 F-01/F-02/F-03 对应的 Task 3A/3B/3C，并保持本报告列出的 generic error、metadata-only、256-entry 和 MCP frame 兼容契约。
2. 当前审计额外发现的 F-04～F-08 不在本轮生产写入范围；主代理应在当前工作树完成并通过 focused tests 后，另开不重叠的实现任务。
3. `PRESERVE` 项不要因为看到 `readFile` 或 `JSON.parse` 就重复重构；先确认读取前 guard、caller boundary 和测试证据是否仍然存在。
4. 本审计没有运行全量 `pnpm verify`，因为没有生产代码改动；主代理整合后仍需按计划运行 focused tests、`pnpm verify` 和 `git diff --check`。
5. 不创建 tag、不 push、不 publish npm、不修改主工作树；本报告本身可以由主代理在确认无冲突后 cherry-pick。

## 7. 最终决策表

| ID | 精确路径 | 决策 | 复现命令 | 下一步 |
| --- | --- | --- | --- | --- |
| F-01 | `packages/runtime-manager/src/manager.ts` | **FIX** | runtime-manager build + oversized `install.json` script（见 F-01） | 现有 Task 3A |
| F-02 | `apps/desktop/src/server.ts` | **FIX** | Desktop build + 10,000 session entries + `listSessions`（见 F-02） | 现有 Task 3B |
| F-03 | `apps/cli/src/index.ts` | **FIX** | CLI MCP server + 100,000 workspace entries + `resources/read`（见 F-03） | 现有 Task 3C，与 MCP server contract 一起修复 |
| F-04 | `apps/cli/src/index-command.ts` | **FIX** | CLI build + 17 MiB source/index + `index refresh`（见 F-04） | 新建后续 CLI index boundary task |
| F-05 | `apps/cli/src/doctor.ts` | **FIX** | CLI build + >1 MiB config + `--doctor --json`（见 F-05） | 新建后续 shared config reader task |
| F-06 | `apps/cli/src/project-init.ts` | **FIX** | CLI build + 17 MiB `.gitignore` + `init --gitignore`（见 F-06） | 新建后续 init input boundary task |
| F-07 | `packages/tools/src/filesystem.ts` | **FIX** | tools build + 100,000 directory entries + `list`（见 F-07） | 新建后续 filesystem list budget task |
| F-08 | `apps/cli/src/index.ts:listSessions` | **FIX** | CLI build + 10,000 session entries + `sessions --json`（见 F-08） | 先锁定完整列表/分页契约，再实现 |
| N-01 | `apps/desktop/src/chat-session.ts` | **NEEDS-EVIDENCE** | 需补 MCP env shape/size contract fixture | 产品契约确认后再决定 |
| N-02 | `apps/cli/src/index-command.ts`, `packages/tools/src/code-search.ts` | **NEEDS-EVIDENCE** | 需扫描规模 benchmark | 决定是否增加 max-files，而非本轮投机修改 |
| N-03 | `packages/tools/src/filesystem.ts`, `packages/runtime-manager/src/manager.ts` | **NEEDS-EVIDENCE** | 需 rollback/cache worst-case benchmark | 保持现有语义，先收集证据 |
| P-01～P-11 | memory/filesystem read/config/workflow/model/MCP/Desktop HTTP/runtime download/archive/code-search | **PRESERVE** | 现有 focused tests 已覆盖固定边界 | 不重复修改；整合后回归验证 |


## 8. 审计后的独立修复证据（不属于原始审计快照）

在原始审计完成后，且确认主工作树没有修改下列文件的情况下，独立 worktree 又完成了三个不重叠的修复。它们仍需由主代理在当前 Task 3 工作合并后决定是否 cherry-pick，并补充候选文档。

| Finding | 修复 commit | 变更 | focused evidence |
| --- | --- | --- | --- |
| F-04 | `9bf4883` | `apps/cli/src/index-command.ts` 对源文件和 persisted index 使用固定 16 MiB stat-before-read guard，并在 source read 处再次检查 | `index-command` 17/17；先写 RED 测试，原实现分别收录超大源文件和错误复用 oversized index |
| F-05 | `b160b20` | `apps/cli/src/doctor.ts` 对 config 检查复用固定 1 MiB read boundary，超限只返回稳定 warning | doctor 16/16；完整 CLI 回归包含该场景 |
| F-06 | `0a274dc` | `apps/cli/src/project-init.ts` 对现有 `.gitignore` 在计划读取和实际更新读取前使用固定 16 MiB guard | project-init 7/7、project-init-cli 4/4；超限不创建 `.dev-agent` 且不改写原文件 |

上述三个 commit 的合并顺序为：`b160b20` → `0a274dc` → `9bf4883`。合并后的独立 worktree 验证为：

```text
pnpm --filter @agent_cli/cli run test
322 tests, 322 passed, 0 failed
```

该证据不改变原始 Task 2 的 `PRESERVE`/`FIX`/`NEEDS-EVIDENCE` 判断，也不代表主工作树已经合并这些提交。

## 9. 审计后的 Desktop 配置读取修复

后续检查发现，Desktop 端的 `apps/desktop/src/chat-session.ts:loadConfigFile` 是另一条没有复用固定边界的用户配置读取路径。该路径现在已在独立 worktree 中补上 stat-before-read guard：

| Finding | 修复 commit | 变更 | focused evidence |
| --- | --- | --- | --- |
| F-09 | `f16cbb2` | `~/.dev-agent/config.json` 超过 1 MiB 时忽略配置并回退到默认 Desktop 配置；新增超大配置回归测试 | Desktop build 通过；新增测试 1/1；`git diff --check` 通过 |

该 commit 与主工作树当前修改不重叠，仍需等待主代理提交其工作后再 cherry-pick。独立 worktree 的完整 Desktop 测试中，除本测试外有两个既有静态资源 404；这两个失败与 F-09 无关，不能据此宣称 Desktop 全量测试通过。

## 10. 审计后的 Filesystem 目录列表修复

针对 F-07，`packages/tools/src/filesystem.ts:FilesystemTool.execute(action="list")` 现在通过 `opendir` 流式枚举目录，最多保留 256 条目，并在还有未返回条目时返回 `truncated: true`。原有 `path`、`entries[].name` 和 `entries[].isDirectory` 字段保持不变。

| Finding | 修复 commit | 变更 | focused evidence |
| --- | --- | --- | --- |
| F-07 | `89750d9` | 为目录列表增加 256-entry 上限和截断元数据，避免先完整物化超大目录 | `@dev-agent/tools` build + test：130/130；先写 RED 测试，原实现返回 257 条，修复后按上限截断 |

该 commit 与主工作区当前修改不重叠，仍需等待主代理提交其工作后再 cherry-pick。
