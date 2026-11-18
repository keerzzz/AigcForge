# 当前辅助实施任务：P2.2T timeline fixture 编码与 lint

状态：规划对话已下发，待辅助实现与验证；不是新资产小节，也不关闭 P2.2T。唯一总体计划仍为[现行计划](../research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md)。

规划/复审/桌面验收：`01a1850f-5d8a-70a3-98e7-c22e4346e8e0`。辅助实现/包测试：`01a17c6a-ea92-72e3-92db-9cc773732f15`。

## 允许范围

- `packages/app/e2e/utils/timeline.ts`：保持 EventManifest public codec 的 decode → encode wire 边界，`makeEvent` 复用此入口；合理收敛整文件50条既有 lint 问题。
- 如需补缺失合同，只修改现有 `packages/app/e2e/performance/timeline-stability/fixture.test.ts`。当前已有 malformed SDK、duplicate ID/orphan、事件序号和类型负例。补最小带 Location 事件经输出后仍可再次公开解码的回归，证明去掉 encode 会重现省略字段变为显式 undefined 的失败。

真实问题：Schema 解码默认字段可包含 `workspaceID: undefined`，该对象直接作为 SSE wire 再次解码会失败。正确边界应输出公开 codec 编码值，不填假 workspaceID、不降低 Schema 验证、不复制事件契约。

优先复用已有 JsonValue/生成 SDK 类型，按 lint 共因处理。不得通过改别名、宽泛断言、重命名逃避规则或新建平行 fixture 框架。必须保留故意畸形值的运行时拒绝与类型负例。

## 执行与交付

1. 读取当前文件、既有 lint 记录及适用 AGENTS；用当前 `9e2c6577ef` 作为本次增量 lint 比较基点，不覆盖其他 WIP。
2. 修改上述范围，在 `packages/app` cwd 用仓库 `script/bun` 运行现有 fixture 测试；保留可复现的 red/green 与具体命令。
3. 运行 App/E2E 适用类型检查、整文件格式检查和原 `script/lint-changed.ts 9e2c6577ef`。一次只跑一项检查；旧日志和当前结果分开。
4. 回传实际 diff、允许文件 SHA256、命令/exit/tally、剩余问题。暂不提交，等待主对话复审；不自行进入下一任务。

禁止改动：`timeline-stream.spec.ts` 两处几何口径、生产 App/GUI、Home/routes、数据库五份候选代码、计划/提示词/账本。禁止 build 共享产物、桌面操作与服务重启。需要第三个文件时先回报具体错误和最小范围，由主对话裁定。

两条几何断言须在标题栏根因修复后用原断言重验；本任务不批准其测量变更。真实桌面与 Flash 验收由主对话在当前 P2.2T 产品修复完成、源码与产物冻结后执行。
