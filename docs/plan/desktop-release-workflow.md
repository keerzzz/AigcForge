# 桌面端发布流程（desktop draft）

> 状态：`desktop-draft` 已在真实 Actions 端到端跑通并人工发布 v0.0.2；自动发布链路（ADR-26）已实现但**默认关闭**，待启用契约满足后才生效。
> 范围：复用 `.github/workflows/publish.yml`，不新增平行构建逻辑，不删除 npm / Docker / AUR 发布能力。

## 1. 当前入口

桌面草稿发布使用现有 `publish` 工作流的 `desktop-draft` 模式：

```sh
gh workflow run publish.yml -f release_mode=desktop-draft -f bump=patch
```

工作流要求 `workflow_dispatch` 从 `main` 触发。`bump` 可为 `major`、`minor` 或 `patch`；如需显式版本，再传 `-f version=0.1.0`。

也可以复用现有入口：

```sh
./script/release patch desktop-draft
```

旧的完整发布模式仍然保留：

```sh
gh workflow run publish.yml -f release_mode=full -f bump=patch
# 或 ./script/release patch full
```

## 2. desktop-draft 做什么

1. 读取最新正式 GitHub Release，按 `bump` 计算版本，或使用显式 `version`。
2. 为该版本创建 GitHub Draft Release，标签和标题为 `v<version>`。
3. 使用现有桌面构建链构建各目标平台：`prepare.ts` → `electron-vite` → `electron-builder`。
4. 将安装包和 `latest*.yml` 上传到 Draft Release。
5. 合并各平台 `latest*.yml` 并上传。
6. 校验 Release 仍是 Draft、标签一致且至少有一个附件。
7. 到此停止，不发布 npm、Docker、AUR，也不把 Draft 改成已发布。

## 3. 版本和元数据约定

- 发布标签、Release 标题、桌面 `package.json` 构建版本、sidecar 的 `AIGCFROGE_VERSION` 必须等于本次计算的版本。
- `latest*.yml` 由 electron-builder 生成后，再由 `packages/desktop/scripts/finalize-latest-yml.ts` 合并；其中的 `version`、文件 URL、`sha512`、文件大小和发布日期必须来自同一批产物。
- `desktop-draft` 对 changelog 生成启用 strict 模式：优先使用 AI changelog；模型密钥缺失或生成失败时，回退到确定性 `script/raw-changelog.ts`；两者都无法产生非空结果时工作流失败，不再静默发布 “No notable changes”。回退结果是提交驱动的 Draft 初稿，公开前仍需人工筛选用户可见内容。
- 版本回写由 ADR-26 的版本 PR 完成：控制器遍历根 `workspaces.packages` 声明的全部清单（含嵌套 `packages/sdk/js`），只改 `version` 字段，夹带其他改动即拒绝。手动 `desktop-draft` 不写回 `main`，需人工按 §6 处理。

## 4. 人工验收

工作流成功不等于可以公开。发布前至少完成：

- 从 Draft Release 下载目标平台安装包。
- 验证安装、启动、后台 sidecar、聊天和文件访问。
- 后续版本验证从上一正式版升级、用户数据保留和数据库迁移。
- 检查 `latest*.yml` 指向的文件、摘要和版本。

确认后才在 GitHub 上把同一份 Draft 发布。失败时保留草稿诊断，不移动已发布标签，不使用未经复核的新构建替换已验收产物。

## 5. 自动发布（ADR-26，默认关闭）

合并到 `main` 的改动在 CI 成功后由 `publish` 工作流的 `workflow_run` 触发：

| 阶段     | Job                          | 作用                                                                   |
| -------- | ---------------------------- | ---------------------------------------------------------------------- |
| 归一化   | `guard`                      | 把事件归一化为单一 `mode`；`push` 到 `main` 一律 `skip`，不落入旧 full |
| 版本候选 | `prepare-version`            | 机器人生成只改 `version` 的版本 PR，开启受控 auto-merge                |
| 构建     | `version` + `build-electron` | 以固定 source SHA 创建 Draft 并构建 5 平台                             |
| 校验     | `finalize-desktop-draft`     | 合并 `latest*.yml`，逐项校验同批次安装包的 SHA-512 / 大小 / 远端摘要   |
| 公开     | `publish` 模式               | 全部门禁通过后自动 `draft=false`；失败则保留 Draft                     |

**发布节奏**由 `Release.affectsDesktop` 裁决：文档、测试、Storybook 单独改动不发版；`minor` / `major` 用 `release:` 标签，`release:none` 显式跳过。**发布单位是「一个版本候选」**，同一候选冻结后归并连续变更。

### 5.1 启用前置条件（缺一即 fail closed）

1. 仓库 Secret `AIGCFROGE_APP_ID` + `AIGCFROGE_APP_SECRET`（受限 GitHub App，需 `contents: write`、`pull_requests: write`、`issues: write`、`administration: read`）。
2. 仓库开启 **Allow auto-merge**。
3. `main` 分支保护：Require branches to be up to date + 必需检查 = `Lint, Test, and Typecheck`、`unit (linux)`、`unit (windows)`、`e2e (linux)`、`e2e (windows)`、`check-standards`、`check-compliance`。
4. 仓库 Variable `AIGCFROGE_DESKTOP_AUTOMATION`：`draft`（只构建 Draft）或 `publish`（自动公开）。留空/`off` = 完全关闭。
5. `publish` 档位额外需要 macOS 签名+公证、Windows Azure 签名凭据齐全，否则该次自动公开失败（不会降级为未签名发布）。

建议先设 `draft` 跑通一轮，再切 `publish`。

## 6. 手动兜底（自动关闭时）

`workflow_dispatch` 仍可用，且只在 `main` 上允许：

```sh
gh workflow run publish.yml --repo keerzzz/AigcForge --ref main -f release_mode=desktop-draft -f bump=patch
```

人工验收 Draft 后手动转正；改 target **不会**重建安装包，来源不一致必须重跑而不是改元数据。

## 7. 尚未交付

- 真实安装 / 升级 / 数据迁移的实机验收证据与自动门禁。
- 启用契约（§5.1）的仓库配置尚未落地：Secret / Variable / 分支保护 / auto-merge。
- macOS Intel（x64）仍在构建矩阵外。
- 历史 v0.0.2 的标签与构建来源差异保留不追溯。

这些项不能在本切片中宣称已闭环；每次关闭前按 `AGENTS.md` 的 Slice Checkpoints 记录 owner 与解锁条件。
