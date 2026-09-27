# 桌面端发布流程（desktop draft）

> 状态：已在真实 GitHub Actions 上端到端跑通 `desktop-draft` 并人工转正发布 v0.0.2（2026-09-27，5 平台，缺 macOS x64 见 §6 / 技术债 §12）。当前定位：只做桌面端，构建自动、发布人工。
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
- 版本回写 `main` 目前是**人工闭环**：发布前用一个只改 `version` 字段的 PR，把根 `package.json` 与各 workspace 清单提到目标版本（见 §5 操作手册第 2 步）。工作流本身尚未自动 commit 回 `main`；在“只做桌面端、发布保持人工”的当前定位下，自动回写按显式决策延后，详见 `docs/technical-debt.md` §12。

## 4. 人工验收

工作流成功不等于可以公开。发布前至少完成：

- 从 Draft Release 下载目标平台安装包。
- 验证安装、启动、后台 sidecar、聊天和文件访问。
- 后续版本验证从上一正式版升级、用户数据保留和数据库迁移。
- 检查 `latest*.yml` 指向的文件、摘要和版本。

确认后才在 GitHub 上把同一份 Draft 发布。失败时保留草稿诊断，不移动已发布标签，不使用未经复核的新构建替换已验收产物。

## 5. 人工发布操作手册（SOP）

当前定位是**构建自动、发布人工**：桌面安装包必须人工验收（能装、能启动、能升级、数据不丢）后再公开。推荐顺序为“先把版本写回 `main`，再触发发布”，这样 Draft 的 tag 从一开始就指向版本正确的提交，转正一步到位，能避开 `--target` 与 `--draft=false` 同条命令提交时的 `HTTP 422` 报错。

以发布 0.0.3 为例（把 0.0.3 换成目标版本）。

**第 1 步 — 同步本地 `main`：**

```sh
git switch main && git fetch origin main && git merge --ff-only origin/main
```

**第 2 步 — 版本回写（暂存提交）：** 把根与 16 个 workspace 清单的 `version` 改到 0.0.3，走 PR 合并回 `main`。只改 `version` 字段，`bun.lock` 不受影响（workspace 间是 `workspace:*` 引用）。

```sh
bun -e 'const fs=["package.json",...new Bun.Glob("packages/*/package.json").scanSync(".")];for(const f of fs){const p=await Bun.file(f).json();p.version="0.0.3";await Bun.write(f,JSON.stringify(p,null,2)+"\n")}'
git switch -c bump-version
git commit -am "chore(release): set workspace versions to 0.0.3"
git push -u origin bump-version
gh pr create --base main --head bump-version --title "chore(release): set workspace versions to 0.0.3" --body-file <按 .github/pull_request_template.md 填写>
```

合并并同步：

```sh
gh pr merge <PR 号> --repo keerzzz/AigcForge --merge
git switch main && git fetch origin main && git merge --ff-only origin/main
```

**第 3 步 — 触发桌面草稿构建**（显式版本，与 `main` 对齐）：

```sh
gh workflow run publish.yml --ref main -f version=0.0.3 -f release_mode=desktop-draft
# 或按 bump 自动递增：./script/release patch desktop-draft
```

**第 4 步 — 监控** `build-electron`（5 平台）与 `finalize-desktop-draft` 全绿：

```sh
gh run list --repo keerzzz/AigcForge --workflow publish.yml --event workflow_dispatch --limit 1 --json databaseId,status,url
gh run view <run-id> --repo keerzzz/AigcForge --json status,conclusion,jobs
```

**第 5 步 — 人工验收 Draft**（保留人工的核心）：下载安装包，安装、启动、（有旧版则）升级、核对 `latest*.yml` 的版本与摘要。

```sh
gh release view v0.0.3 --repo keerzzz/AigcForge --json isDraft,tagName,assets
gh release download v0.0.3 --repo keerzzz/AigcForge --dir /tmp/rel --pattern 'latest*.yml'
```

**第 6 步 — 转正公开**（第 2 步已先回写，tag 天然指向对的提交，一步即可）：

```sh
gh release edit v0.0.3 --repo keerzzz/AigcForge --draft=false --latest
```

**第 7 步 — 复核：**

```sh
gh release view v0.0.3 --repo keerzzz/AigcForge --json isDraft,tagName,targetCommitish,url
git ls-remote --tags origin refs/tags/v0.0.3
```

**必记两个坑：**

- 若跳过第 2 步、想在转正时改 target：不要把 `--target` 与 `--draft=false` 写进同一条命令（会报 `HTTP 422 tag_name is not a valid tag`）。分两步——先 `gh release edit v0.0.3 --target <完整 40 位 SHA>`，再单独 `gh release edit v0.0.3 --draft=false --latest`；`--target` 只认完整 SHA。
- 版本号目前从“最新已发布 Release”反推（v0.0.2 → 下一 patch = 0.0.3），所以每次发完都要按第 2 步把 `package.json` 提上去，否则 `main` 会落后于已发布版本。

## 6. 尚未交付 / 范围外

当前定位（只做桌面端、发布人工）下，以下项按**显式决策**延后或列为范围外，不在本阶段闭环（详见 `docs/technical-debt.md` §12）：

- 版本自动回写 `main`（CI 提交）：现用第 5 节的人工 PR 闭环替代；自动化需先定 bot 提交策略与分支保护边界，暂缓。
- 根 `package.json` 作为唯一版本源：现仍由“最新 Release”反推、人工把 `package.json` 提平；单一真源改造暂缓。
- PR 合并后按 label 自动触发 `desktop-draft`：多人 / 高频场景才需要，桌面单端暂不做。
- 签名 / 公证 / 真实升级的自动门禁：依赖真实密钥与升级基线，暂缺。
- 从桌面链拆分 npm / Docker / AUR：仅 `full` 模式涉及，桌面端不经过，列为范围外 / legacy。
- macOS Intel（x64）已暂时移出构建矩阵（macos-13 runner 长期排队），v0.0.2 仅覆盖 Apple Silicon。

每项关闭前按 `AGENTS.md` 的 Slice Checkpoints 记录 owner 与解锁条件。
