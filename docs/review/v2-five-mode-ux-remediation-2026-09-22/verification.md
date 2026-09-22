# 五模式 UX 修订：最终验证

- 分支：`five-mode-ux`
- 基线：`origin/main` = `53800bb8549443372243e5ba37b8277e225cf4df`
- 结论：审批修订与 A 批实施完成；未交付的 B 批/视觉项已登记技术债。全 app suite 仍有环境基线超时，不冒充全绿。

## 已交付提交

```text
$ git log --oneline origin/main..HEAD
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

## 已验证

```text
bun --cwd packages/app typecheck
rc=0

bun --cwd packages/ui typecheck
rc=0

bun --cwd packages/ui test
21 pass, 0 fail, 370 expect() calls

bun --cwd packages/app test:unit:file <14 affected test files>
117 pass, 0 fail, 3207 expect() calls

LINT_BASE_REF=origin/main bun run script/lint-changed.ts
Incremental lint passed (52 changed files, 2132 added lines)

bash .aigcfroge/skills/protocols/scripts/check-refs.sh
All 32 paths OK

半径替换审计：
app 69 + v2 38 = 107 处无争议映射；
app/v2 剩余映射值命中 0；
孤儿值 20 处保持原样。
```

## 未验证 / 基线失败

```text
bun --cwd packages/app test
最后完整运行：1101 pass / 7 fail / 5609 expect() calls。

失败集中在慢盘下的 5s hook/source-read 超时：
comments.test.ts、terminal.test.ts、permission-identity.test.ts、i18n/parity.test.ts、
custom-sidebar.test.ts、global-sync/child-store.test.ts、agent-task-hub.test.tsx。
之后的 focused 复跑中，除 comments.test.ts 外全部转为 pass；comments.test.ts 单独复跑仍以
beforeEach/afterEach 11.4s 超时失败。该文件不在本批调用链内，故不宣称全 app suite green。

Playwright e2e：
本地 Vite cold start 69s 后端口 ready，但 global setup 的 page.goto 180s 内 modules=0；
WorkflowTab 的 e2e 用例已落盘，未取得本机绿证。该失败与本次修改的调用链无关，CI runner 仍需复核。
```

## 未交付登记

`docs/technical-debt.md` §4.2 已登记：S2b、S5b、S6、S7、S4f、S9a、S9c，均带 owner 与 unlock。S8c 因前提不存在而取消，不是未登记缺口。
