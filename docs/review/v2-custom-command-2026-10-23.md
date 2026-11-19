# V2 Custom Command 检查点（2026-10-23）

实施目录 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`。本批接在 Custom runtime 检查点之后，按 M2 既定合同把 Command 作为消费者绑定的稳定指令模板。

## 已交付

`SessionCommand.execute`（`packages/core/src/session/command.ts:14`）用 `SessionComposition.selectSessionAgent` 选择当前 root/child consumer；`CompositionConsumerView.getCommands` 决定可见目录，匹配规则只在该函数中按 name/invocation 取唯一项。Flat snapshot catalog 不提供额外执行权；重名与交叉 alias 冲突拒绝。

`Command.interpolate`（`packages/core/src/command.ts:101`）从既有 ConfigCommand 提取纯参数替换：quoted 参数、位置参数的最后一项吞余项、`$ARGUMENTS` 与 literal replacement 保持原行为。普通配置命令仍在替换后使用原 shell interpolation 阶段。Custom 仅允许稳定模板，拒绝 source 的 shell interpolation，用户参数中的 shell 语法保持字面量。它通过现有 Session.prompt 持久准入，不切换 Agent/Model、不建 child，也不调用 live Command callback。

`SessionComposition.assertDependency`（`session/composition.ts:286`）检查 top-level 与 scoped Command 的 invocation/body；旧快照缺字段拒绝，明确空正文可运行。错误沿用 Command.NotFoundError/ExecutionError 与现有 HTTP mapping，不回显附件正文或输入参数。公开协议说明已由官方生成器更新；Client 官方生成未产生额外差异。

## 验证

命令、cwd、退出码、源码和日志 SHA256 见 [verification.json](evidence/v2-custom-command-2026-10-23/verification.json)。单包测试使用项目 Bun 1.4.2；Core 全包使用隔离 network namespace。

- Core 全包 `command-core-full`：exit 0，7312 pass / 365 skip / 0 fail，363 文件。
- Server 全包 `command-server-full`：exit 0，129 pass / 1 skip / 0 fail，35 文件；保留 MaxListenersExceededWarning。
- 七文件回归 `command-runtime-regressions`：exit 0，98 pass，覆盖 consumer 隔离、live callback 删除/替换、literal/quoted 参数、queue+attachment、缺快照/正文/legacy invocation/重名、空正文、关闭开关无准入与普通 callback。
- 真实 HTTP 单文件：exit 0，15 pass；删除源文件后仍消费冻结正文，关闭开关无写入。最终 Server 全包覆盖当前源码。
- Core、Server、Protocol typecheck exit 0。Protocol generate/check 与 Client generate exit 0，Client 没有新增差异。
- 10 个源码/测试/JSON 格式检查通过；oxlint 9 文件 0 warning/error（该范围配置只有 1 条规则）；Effect ast-grep 专项与 git diff --check 通过。

失败记录保留：首轮测试缺 Project import；新增 location test graph 将 Location-scoped Command 当作全局依赖，类型失败；统一测试 registry global node 后通过。最终通过不覆盖这些失败。

## 未交付与限制

本批关闭 V2-D-COMMAND 的冻结模板执行子范围。Workflow、Custom 产品 UI、TaskPanel/Work 调度、外部 CLI/attended/review、其他 reverse consumers 和全产品验收继续开放。没有进行根 check、产品 E2E、Electron/PTY、真实数据库升级、push/PR/merge/release。Consumer template 的 args 仍是原描述字段，不新增参数 Schema 或 shell 权限。

## 提交核算

```sh
git log --oneline d1bea71c41..51ad583c98
```

```text
51ad583c98 feat(core): execute frozen command templates
```
