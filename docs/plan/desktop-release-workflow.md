# 桌面端发布流程（desktop draft）

> 状态：首个切片已实现，尚未在真实 GitHub Actions 上完成一次端到端发布验证。
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
- `desktop-draft` 对 changelog 生成启用 strict 模式：生成失败或结果为空时工作流失败，不再静默发布 “No notable changes”。
- 当前 `desktop-draft` 只保证构建产物和 Release 元数据使用新版本；尚未把版本提交回 `main` 的 `package.json`。这属于下一切片的显式债务，详见 `docs/technical-debt.md` §12。

## 4. 人工验收

工作流成功不等于可以公开。发布前至少完成：

- 从 Draft Release 下载目标平台安装包。
- 验证安装、启动、后台 sidecar、聊天和文件访问。
- 后续版本验证从上一正式版升级、用户数据保留和数据库迁移。
- 检查 `latest*.yml` 指向的文件、摘要和版本。

确认后才在 GitHub 上把同一份 Draft 发布。失败时保留草稿诊断，不移动已发布标签，不使用未经复核的新构建替换已验收产物。

## 5. 尚未交付

- 版本提交回 `main`、根 `package.json` 作为唯一版本源。
- PR 合并后按 label 自动触发 `desktop-draft`。
- 签名 / 公证和真实安装升级的自动门禁。
- 从桌面发布链彻底拆分 npm、Docker、AUR。

这些项不能在本切片中宣称已闭环；每次关闭前按 `AGENTS.md` 的 Slice Checkpoints 记录 owner 与解锁条件。
