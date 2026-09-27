# ADR-26: 桌面端自动发布（受控版本 PR + 同源构建 + 门禁后自动公开）

> 状态：**Proposed**（默认关闭，待 Owner 配置启用条件后生效）
> 日期：2026-09-27
> 关联：[desktop-release-workflow 计划](../../plan/desktop-release-workflow.md)、[technical-debt §12](../../technical-debt.md)、[AGENTS.md Slice Checkpoints](../../../AGENTS.md)
> 实现 owner：`packages/script`（`release.ts` / `release-metadata.ts`）+ `script/desktop-release.ts`；工作流 `.github/workflows/publish.yml`

## 1. 背景与问题

桌面发布此前是「人工触发 `desktop-draft` → 人工验收 → 人工转正」，由此暴露出三个真实缺口的根因是同一个：**版本、构建来源、发布标签没有单一权威的编排者**。

| #   | 事实                                                                                                     | 证据                                                              |
| --- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | 发布模式分散在事件条件里：桌面收尾只接受 `workflow_dispatch`，而非手动事件会满足旧 `publish` 分支        | 改动前 `publish.yml` 的 `finalize-desktop-draft` / `publish` 条件 |
| 2   | 版本来源两套：`Script.VERSION` 从「最新 GitHub Release」反推，而 `main` 的 `package.json` 靠人工 PR 追平 | `packages/script/src/index.ts` 的 `VERSION` 计算、v0.0.2 的历史   |
| 3   | 版本 PR 的清单遍历漏掉嵌套 workspace（`packages/sdk/js`），且 `script/publish.ts` 只扫 `packages/*`      | v0.0.2 后 `packages/sdk/js/package.json` 仍为 0.0.1               |
| 4   | 旧 full 链路在发布后改标签、推 `dev`，桌面链路不能继承                                                   | `script/publish.ts` 的 release 段                                 |

历史证据（保留，不追溯修改）：成功 Run `36282895148` 的 `headSha` 为 `43d9b7349`，而公开标签 `v0.0.2` 指向后补版本提交 `f6644e758`——**改 Draft 的 target 不会重建安装包**，因此标签不能当作「同一提交构建」的证据。

## 2. 决策

引入一个**发布意图归一化 + 版本候选**的编排层，全部复用现有构建矩阵与发布工作流，不新增平行构建链。

```
业务 PR 合并到 main
  → CI 在 main 成功（workflow_run）
  → guard：归一化发布意图（单一 mode）
  → prepare：机器人生成「只改 version 字段」的版本 PR 并开启受控 auto-merge
  → 版本 PR 检查全绿后自动合并
  → 该合并的 CI 再次成功
  → version：以固定 source SHA 创建/复用 Draft（tag 从一开始就指向 source）
  → build-electron：5 平台构建（沿用现有矩阵）
  → finalize：合并 latest*.yml，校验同批次安装包与更新清单摘要
  → desktop-release：全部通过后自动公开；任意一项失败则不公开
```

### 2.1 关键不变量

1. **单一发布意图**：所有 job 只消费 `guard.outputs.mode`（`skip` / `prepare` / `desktop-draft` / `desktop-release` / `full`）。`push` 到 `main` 一律 `skip`，不再落入旧 full。
2. **同源**：Draft 的 tag / target、安装包、更新清单、最终标签必须对应同一个完整 SHA。`script/desktop-release.ts` 在构建前校验 `git rev-parse HEAD === AIGCFROGE_RELEASE_SHA`。
3. **幂等**：重复的 `workflow_run`、重复的 Draft 创建、重复的公开请求都不产生第二个 Release，也不移动已发布标签。
4. **失败不公开**：任一要求的平台、附件或摘要校验失败，`publish` 不执行。
5. **分发隔离**：自动桌面路径不运行 npm / Docker / AUR；`full` 仅由显式触发或旧分支 push 进入。
6. **发布单位是「一个已验证的版本候选」，不是「一个合并事件」**：同一候选冻结后归并连续变更，不替换正在验证的源提交。

### 2.2 版本真源

- 根 `package.json` 表示**计划版本**；各 workspace 清单与它对齐（遍历根 `workspaces.packages` 声明，含嵌套 `packages/sdk/js`）。
- GitHub Release / Tag 记录**已发布版本**。
- 执行阶段只使用已确定的版本，不在同一次运行里二次推算。
- 版本 PR **只改清单的 `version` 字段，不改 `bun.lock`**。理由：`bun.lock` 的 workspace 段也内嵌 `version`，但该仓库的 `bun install` 会重解析 git 依赖（如 `ghostty-web`），在 CI 里提交其结果不确定；仓库当前也没有任何 `--frozen-lockfile` 门禁。因此 `bun.lock` 的 workspace 版本行允许滞后，登记于 technical-debt §12，不用不确定的 `bun install` 结果污染发布提交。

## 3. 启用契约（默认关闭）

自动发布**默认关闭**。`workflow_run` 触发在 `vars.AIGCFROGE_DESKTOP_AUTOMATION` 为空或 `off` 时不启动任何 job。

启用前必须满足（任一项缺失即 fail closed，不降级）：

| 条件                                                                                                  | 校验点                                      |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `AIGCFROGE_DESKTOP_AUTOMATION` ∈ {`draft`, `publish`}                                                 | `guard` job 的 `if`                         |
| `AIGCFROGE_APP_ID` + `AIGCFROGE_APP_SECRET`（GitHub App）                                             | `setup-git-committer` 的 `require-app` 步骤 |
| 仓库开启 auto-merge                                                                                   | `Release.GitHub.policy()`                   |
| `main` 分支保护：要求最新分支 + 全部发布必需检查                                                      | `Release.GitHub.policy()`                   |
| 必需检查含 lint/typecheck、unit(linux/windows)、e2e(linux/windows)、check-standards、check-compliance | `Release.REQUIRED_CHECKS`                   |
| 已存在一个经过人工验收的正式版作为基线                                                                | `Release.automatic`                         |

`draft` 只构建与校验 Draft；`publish` 才自动公开。**发布公开前，`publish` 额外要求 macOS 签名 + 公证、Windows Azure 签名凭据齐全，缺失即失败**——自动公开不得静默降级为未签名产物。

## 4. Consequences

- **收益**：版本提交与产物同源；标签从构建之初即正确；版本/发布记录可追踪；重复劳动消除；失败可恢复。
- **成本**：多一轮版本 PR 的 CI；需要配置受限 GitHub App、分支保护与 auto-merge；`packages/script` 新增 typecheck。
- **新增约束**：新增桌面影响面判定逻辑（`affectsDesktop`）成为发布节奏的唯一裁决点；它必须随包拓扑演进而更新。
- **未闭环（登记于 technical-debt §12）**：真实安装 / 升级 / 数据迁移的实机验收证据；macOS Intel（x64）构建；启用配置尚未落地；历史 v0.0.2 来源差异保留不追溯。

## 5. 安全边界

- `workflow_run` 从**可信默认分支代码**启动，不 checkout PR 代码；仅接受 `push` + `main` + 同仓库 + `success`。
- 发布 controller 只接受完整 40 位 SHA 与严格稳定 semver（`HEAD`、`v0.0.3`、预发布号一律拒绝）。
- 版本 PR 被独立校验为**只改声明清单的 `version` 字段**；夹带业务改动即拒绝。
- 无人值守运行使用确定性 changelog，不把提交文本送进带发布凭据的模型。
- GitHub API 错误不携带响应体与凭据；所有请求带超时。
