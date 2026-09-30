## [ERR-20260930-001] multiline-apply-patch-template

**Priority**: low
**Status**: resolved
**Area**: tools

### 摘要
通过 JavaScript 模板字符串包装 apply_patch 时，补丁正文中的反引号和正则转义会先被外层脚本解析，导致补丁命令在执行前失败。

### 错误信息
SyntaxError: Unexpected identifier
SyntaxError: Invalid or unexpected token

### 建议修复
生成补丁时避免正文反引号，或使用 String.raw 加字符串拼接；失败后先确认目标文件未变化，再重试。

### 元数据
- Reproducible: yes
- Source: error

---

## [ERR-20260930-002] documentation-contract-release-version-drift

**Priority**: medium
**Status**: pending
**Area**: docs

### 摘要
Desktop 执行中心完成后的文档契约检查仍有两个既有发布版本断言冲突：部分文档读取到 0.1.8，测试期望 0.2.0；另一处同步检查反向读取到 0.2.0，测试期望 0.1.8。该冲突不由本次功能改动引入。

### 错误信息
0.1.8 !== 0.2.0
0.2.0 !== 0.1.8

### 建议修复
单独建立发布文档同步任务，核对 package、npm、tag、GitHub Release 和契约测试的单一版本来源；不要在功能开发中顺手修改发布记录。

### 元数据
- Reproducible: yes
- Source: error

---
