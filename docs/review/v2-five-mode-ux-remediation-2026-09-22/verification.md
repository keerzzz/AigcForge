# 五模式 UX 修订：最终验证

- 分支：`five-mode-ux`
- 基线：`origin/main` = `53800bb8549443372243e5ba37b8277e225cf4df`
- 结论：审批修订、A 批实施与二次复核修复完成。全 app suite 仍有 2 例慢盘 hook 超时基线，不冒充全绿。

## 已交付提交

```text
# 本表覆盖修复批次；本报告自身的提交（其后的 docs: record five-mode ux second review）不在其中，
# 以免自我引用后哈希漂移。
$ git log --oneline 53800bb8549443372243e5ba37b8277e225cf4df..b7b02a8bd
b7b02a8bd fix(app): make the citation overlay dismissible
914959363 fix(app): hold work artifacts until the session syncs
b1da327ce fix(app): scope panel ids and workflow mount to the active mode
671ee1414 fix(app): guard asset lists against stale project data
7f2b0e2b2 docs: record five-mode ux verification
3b43f090e test(app): keep focused contracts off slow timers
59ab09a78 docs(ui): note radius scan removal
4b3d86684 test: drop heavyweight radius source scan
72ab46583 docs(debt): register deferred five-mode work
3a0245d7d fix(app): surface assistant mutation failures
62ade87e5 fix(app): announce asset load failures
625146ad2 refactor(app): reuse right panel for custom
5c6ab63ec fix(app): surface citation loading errors
365b8d5e6 fix(app): show custom asset skeleton while loading
86c0daa49 fix(app): distinguish chat asset loading
5f64158e0 fix(app): distinguish work artifact loading
daff1d98c feat(app): expose workflow runtime in work
372f679f4 test(ui): record radius reuse evidence
c27dfea6c refactor(ui): reuse radius tokens in v2
7fdeeee2d refactor(app): reuse radius tokens
edf0b37a9 docs: correct radius mapping baseline
44f1e6242 refactor(ui): consolidate radius token source
fc2e53e30 docs: approve five-mode UX remediation plan
```

## 二次复核修复（2026-09-22）

第二轮审批在已交付的 A 批之上又发现 6 项缺陷，均已修复并各自带回归证据：

1. **跨来源资产数据残留** — `assetListStatus` 原先只按 `failed === undefined` 判断 loading。切换 location/server 后，旧来源的行会冒充当前来源的数据。现由 `source` / `settledSource` / `state` 共同判定：`source === undefined` → `idle`（新增状态，渲染“先选择项目”），来源变化强制 `loading`，同来源 refetch 保留旧行，`settledSource !== source` 时不再消费旧 `failed`。纯 `loading` 布尔量（非资源 `state`）无法区分“首次加载”与“换源重载”，这是根因。
   - 证据：`asset-list-status.test.ts`（真实 Solid `createResource` 源切换行为）、`custom-asset-catalog.test.ts`。
2. **同一模式挂载两个 WorkflowRuntimePanel** — Custom 面板无条件挂载 runtime panel，与 Work 面板叠加，一次页面读发起两次 workflow 状态请求。现仅当 `mode.currentMode === "custom"` 时挂载。
   - 证据：`e2e/regression/workflow-runtime.spec.ts` 断言 `[data-mode="work"]` 下恰有 1 个 panel、1 次 GET、7 个 step。
3. **Work Artifact 把“同步中”误判为“空”** — `workArtifactView` 原消费 `sync().status`，bootstrap 的 `partial` 会直接落到 empty。现改为入参 `ready`，由当前 Session 的消息是否已同步（`sync().data.message[id] !== undefined`）决定，未就绪一律 loading。
   - 证据：`work-artifact-extract.test.ts`。
4. **citation 浮层无法关闭** — loading 与 error 两个分支此前只能等超时或重试。现两个分支各加一个 `IconButton`（`assistant.citation.dismiss`）关闭浮层。
5. **重复的 `review-panel` id** — 五个模式外壳同时输出 `id="review-panel"`。现 `SessionRightPanel` 接收 `modeID`，只有当前可见模式保留 `review-panel`，隐藏外壳改用 `session-mode-shell-${modeID}`；coding 继续用 `review-panel`，header 的 `aria-controls` 不变。
6. **删除源码字符串断言测试** — 移除 `custom-sidebar.test.ts`、`assistant-dashboard.test.ts`，以及 `assistant-citation.test.ts` / `workflow-runtime-panel.test.tsx` 中新增的源码字符串断言；这些行为改由真实渲染与 e2e 覆盖。

## 已验证

```text
bun --cwd packages/app typecheck
rc=0

bun --cwd packages/ui typecheck
rc=0

bun --cwd packages/ui test
21 pass, 0 fail, 370 expect() calls

bun --cwd packages/app test:unit:file <7 focused files>
69 pass, 0 fail, 126 expect() calls

bun --cwd packages/app test:virtualizer
3 pass, 0 fail, 9 expect() calls

bun --cwd packages/app test:e2e:contracts
39 pass, 0 fail, 153 expect() calls

LINT_BASE_REF=53800bb8549443372243e5ba37b8277e225cf4df bun run script/lint-changed.ts
Incremental lint passed: 51 changed files, 2368 added lines

bash .aigcfroge/skills/protocols/scripts/check-refs.sh
All 32 paths OK

# 需先摘掉 HTTP(S)_PROXY，见下方环境陷阱
bunx playwright test regression/workflow-runtime.spec.ts --project=chromium
6 passed (3.9m)

半径替换审计：
app 69 + v2 38 = 107 处无争议映射；
app/v2 剩余映射值命中 0；
孤儿值 20 处保持原样。
```

## 未验证 / 基线失败

```text
bun --cwd packages/app test:unit
1117 pass / 2 fail / 5642 expect() calls
Ran 1119 tests across 150 files. [558.12s]

2 例均为慢盘下的 5s beforeEach/afterEach hook 超时：
src/context/terminal.test.ts、src/context/permission-identity.test.ts。
两者都不在本批调用链内；此前同形失败集（comments.test.ts 等）已缩小到 2 例，
但失败文件随机器负载漂移，故不宣称全 app suite green。

Playwright e2e 环境陷阱（非本次改动引入，已定位根因）：
本机 shell 设置了 HTTP_PROXY / HTTPS_PROXY = http://127.0.0.1:10808。
Playwright 的 webServer 可用性探针走该代理，代理对 127.0.0.1:3000 回 400，
被判定为 “WebServer is already available”，于是 vite 根本没被拉起，
随后所有 page.goto 全部 ERR_CONNECTION_REFUSED（6/6 失败）。
摘掉代理
  env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
      NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost
后 6/6 通过。带代理的 CI runner 需在 config 里显式 NO_PROXY，否则会静默地不启动 dev server。
```

## CI 轮次修复（2026-09-22）

PR #78 首轮 CI 暴露两处问题，均已修复；修复后整条流水线复跑全绿。

1. **Prettier 格式门失败。** Lint 步的 `script/format.ts --check` 报 11 个文件——本分支早期提交引入了缩进错误的 JSX，另有 5 个文档。`bun run script/format.ts` 归一后单独提交（`chore: format five-mode ux branch files with prettier`）。
2. **e2e 断言锁死了旧 class。** `assistant-session-panel.spec.ts` 断言 `toHaveClass(/rounded-\[10px\]/)`，而半径合并把该 class 换成了等价 token `rounded-xl`（`--n-xl` = 0.625rem = 10px）。改为断言计算值 `toHaveCSS("border-radius", "10px")`，这样下次改名 token 不会再误报（`test(app): assert the assistant panel radius by computed value`）。

首轮 e2e 另有 2 例 flaky（`mode-slot-fallback-a11y.spec.ts` 的 Escape 断点用例、`session-todo-progress.spec.ts` 的 writeback 用例），均在 retry #1 通过，与本批改动无调用链关系。

CI 最终结果（PR #78，head `9355ba722`）：

```text
Lint, Test, and Typecheck   pass  22m38s
unit (linux)                pass  42m7s
unit (windows)              pass  38m9s
e2e (linux)                 pass  18m0s
e2e (windows)               pass  23m19s
check-standards             pass
check-compliance            pass
```

## 未交付登记

`docs/technical-debt.md` §4.2 已登记：S2b、S5b、S6、S7、S4f、S9a、S9c，均带 owner 与 unlock。S8c 因前提不存在而取消，不是未登记缺口。
