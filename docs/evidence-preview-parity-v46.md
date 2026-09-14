# v46 preview 跨宿主 parity 与 query decision matrix

**日期：2026-09-14**

**状态：Task 0 与 Task 1 完成；Task 2 结论为 preserve，未修改 runtime parser。**

## Scope

本 review 使用同一份临时 `FileMemory` session fixture，同时调用 agent-core、CLI
`--preview-evidence` 和 Desktop `/api/sessions/<id>/evidence/preview`。fixture 含有
UTF-8 validation/change-set ids、相对文件路径，以及故意不会出现在 preview 的 command、
args、cwd、output、error 和内部 summary 字段。

测试不会启动 provider、进入 chat queue 或执行 workspace tool；Desktop 注入 fake session
只计数 `run()` 调用，CLI 使用不可加载的 provider id。memory 文件和 workspace sentinel
在请求前后比较，确保 preview 只读。

## Success allowlist

CLI 与 Desktop 的 success response 都必须严格只包含以下字段，并由 agent-core 决定
counts、file count 与 canonical UTF-8 `serializedBytes`：

```text
schemaVersion
sessionId
generatedAt
validationCount
changeSetCount
fileCount
serializedBytes
```

`generatedAt` 是每次请求生成的时间，因此 parity 比较排除这一项；其它字段在同一 fixture
上必须完全相等。四组请求已覆盖未过滤、`status`、UTF-8 `changeSetId` 和 UTF-8
`validationId`，结果均为 parity：

| Case | CLI input | Desktop query | Expected counts |
| --- | --- | --- | --- |
| all | no filter | none | 2 validations / 2 change sets / 2 files |
| status | `--status failed` | `?status=failed` | 1 / 1 / 1 |
| change set | `--change-set-id 变更集:alpha` | encoded `changeSetId` | 1 / 1 / 1 |
| validation | `--validation-id 验证:失败:🚀` | encoded `validationId` | 1 / 1 / 1 |

## Query compatibility matrix

当前 Desktop parser 与既有 `/messages` history endpoint 的语义保持一致；v46 用同一
session 对 preview 和 history 做了回归，而不是仅凭理论风险收紧参数。

| Input | Current behavior | v46 decision | Evidence |
| --- | --- | --- | --- |
| `status=` | empty value treated as absent | **preserve** | preview/history both return all 2 records |
| `status=failed&status=passed` | `URLSearchParams.get()` uses first value | **preserve** | preview/history both return failed 1-record selection |
| `unrelated=ignored` | unknown query ignored | **preserve** | preview/history both return unfiltered 2-record selection |
| encoded UTF-8 `changeSetId` | decoded and filtered | **preserve** | preview returns 1/1/1 |
| preview + `maxBytes=1` on existing session | audit limits rejected by preview route | **preserve** | `400 {"error":"audit limit options require /evidence"}` |
| unknown session, even with `maxBytes=1` | session existence checked first | **preserve** | `404 {"error":"unknown session"}` |

没有发现 silent session selection、filter mismatch、客户端兼容性 proof gap 或敏感信息
回显，因此本轮不把 unknown/duplicate/empty query 改为 reject，也不引入 query versioning。
未来如果产品要改变这些语义，必须先获得真实客户端调用证据并单独设计迁移错误契约。

## Security and side-effect invariants

- CLI 与 Desktop response 不含 `secret-command`、`secret-output`、`secret-error`、
  `workingDirectory` 或 `cwd`。
- CLI provider 未加载；Desktop fake session 的 `run()` 调用数保持为 0。
- memory 文件 bytes 在所有 preview 请求前后相同；workspace sentinel 不被修改。
- unknown-session、audit-limit 和既有 malformed-memory paths 保持 metadata-only generic
  errors；不返回 persisted evidence details。
- preview 仍然是完整 v1 projection 的 sizing surface，不是 export partial、cursor、
  pagination、schema v2、validation 输入、restore 凭证或 Undo 授权。

## Test evidence

```bash
pnpm test:preview-parity
```

结果：**3/3 passed**。测试覆盖 core/CLI/Desktop parity、标准 filters、UTF-8 encoding、
empty/duplicate/unknown query、history compatibility、unknown session、audit-limit
rejection、敏感字段边界和 read-only side effects。

## v46 decision

**Preserve / tests-only：不修改 Desktop query parser。** 当前语义虽不如严格 reject
直观，但与既有 history/export compatibility 一致，且没有导致 session 选择或 metadata
边界错误。v46 的交付是跨宿主 regression harness 与明确 decision matrix；任何未来
query tightening 都需要新的兼容性证据，而不是理论上的“更安全”。
