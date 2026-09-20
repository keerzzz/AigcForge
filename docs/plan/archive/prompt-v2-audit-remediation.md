# 执行提示词：V2 审计整改 S1–S4（交给执行智能体）

> 用法：一次开工一个批次，把「通用前置」+「已知噪声」+ 对应批次段落完整粘贴给执行智能体。**必须按 S1 → S2 → S3 → S4 顺序**，每批次验收通过后才开下一批（S2 会建立一道「断言是否真的执行」的门禁，它要覆盖 S3/S4 新写的测试）。
> 决策依据：本文件末节「批次划分的协议依据」。审计原始报告见 `/tmp/kimi-agent-{0,1,2,4}.md` 与两轮后台 agent 输出。
> 关联计划：`docs/plan/v2-architecture-governance-slice-0-3.md`、`docs/plan/v2-ux-trust-foundation.md`（本批次全部先于两份计划的 A0/B0 合并）。

---

## 通用前置（每次必带）

```text
你是 AigcForge 仓库的高级全栈工程师，工作目录 /media/win_data/aigcfroge。
本任务是安全/缺陷整改，不是功能开发。每条改动都必须先有一条会失败的测试。

【强制首读，未读不动手】
- CLAUDE.md（第一性原理、九荣九耻、根因收敛三步法、极致减法、安全与工程门禁、改完即审七步）
- AGENTS.md（Effect 编码、Schema、测试三模式、自导出、禁 star/alias import）
- docs/testing.md（§0 命令陷阱、§10 测试书写七条红线）
- .aigcfroge/skills/effect/SKILL.md（Effect v4 API 以源码为真源，禁凭记忆写旧 API）
- 批次涉及 UI 时加读 DESIGN.md（v2 token、data-* 属性选择器、i18n、a11y）

【TDD 纪律】
- 红→绿→重构：先写失败测试并**跑出**预期失败，把原始失败输出记下来；失败信息与预期不符立即停下报告，不要"顺着改到过"。
- 禁止写完实现再补测试。禁止用源码字符串断言代替行为断言（docs/testing.md §10 红线 3）。
- 测试模式：纯逻辑/service 用 it.effect；真实文件系统/子进程用 it.live；落盘集成用 it.instance。
- 等待并发 fiber 只用就绪信号（pollWithTimeout / awaitWithTimeout / Deferred），严禁 Effect.sleep(N)。
- testEffect 来自各包 test/lib/effect.ts；优先 Layer.mock 部分覆盖，而非手写全量 stub。

【命令纪律】
- 永不从仓根跑测试：bun --cwd packages/<name> test --timeout 30000。
- **--cwd 后面绝不能加 run**：bun --cwd <pkg> run <script> 会打印 usage、什么都不执行、且 exit 0（"绿了但没跑"）。正确形式是 bun --cwd <pkg> <script>。
- typecheck 用 bun --cwd packages/<name> typecheck（tsgo），禁止直接调 tsc。
- 增量 lint **必须显式给基线**：LINT_BASE_REF=origin/main bun run script/lint-changed.ts。不带它会以本地 main 为基线，在累积提交时扫到 0 个文件并空绿通过。
- 跑门禁时不要并行跑其他重任务（子代理、全仓 typecheck）：spawn 密集的测试在负载下会集体 TimeoutError，让结果不可判读。

【工程门禁】
- 禁止无理由 as any / @ts-ignore / 非空断言；错误用 Schema.TaggedErrorClass；Effect.gen 组合；Effect.fn("Domain.method") 命名。
- 禁止 Effect.fork/forkDaemon，用 Effect.forkIn(scope)；优先 Effect.void。
- 新代码用 export * as Foo from "./foo" 自导出；禁新增 export namespace、star import、alias import。
- **最小改动**：不顺手修无关代码。范围外的发现记进报告末尾「额外发现」，不擅自修复。
- **根因收敛**：本任务的每个批次都已经按共享根因划好。如果你发现真正的根因与批次描述不同，**停下报告**，不要在原修法上打补丁。修复优先级：复用 → 删除 → 归并 → 重构 → 新增。

【交付格式】完成后输出：
1. 改动文件清单（路径 + 一行摘要），并附 git diff --stat
2. 红→绿证据：每条测试**未改代码时的原始失败输出** + 改后通过结果
3. 已运行命令及真实结果（test / typecheck / lint），不许写"应该通过"
4. 复查结论（CLAUDE.md 改完即审固定七项：影响文件 / 命中 skills / 安全门禁 / 工程门禁 / 数据流追踪 / 已运行命令 / 剩余风险）
5. 额外发现（如有）
```

---

## 已知噪声（每次必带，防止把既有失败当成自己的回归）

```text
【这些失败在 main 上就存在，不是你造成的，也不要去修】
1. packages/aigcfroge/test/server/httpapi-reference.test.ts 会真的克隆 github.com/Effect-TS/effect。
   网络不通时整个 test/server/ 以超时形式变红，失败现场（test/lib/effect.ts 的 orElse 栈）看不出是网络问题。
2. HttpApi exerciser --mode effect 在 main 上有 3 条既有失败：agent-asset.apply、
   session.workflow.run（期望 202 实得 500）、session.task.get。--mode coverage 从不发请求，
   所以 coverage 的绿不代表行为正确。
3. 全仓 Prettier 基线漂移（packages/core/src 有 112/498 个文件未过 prettier，origin/main 上即如此）。
   **不要**做批量格式化，那会把无关改动混进本批 diff。
4. packages/app/e2e 不在 typecheck 项目内，且带 29 个存量类型错误。新写 e2e 时 tsgo 不会替你把关。
5. packages/storybook 的 bun run build 在 main 上即可能 OOM。若复现，按 docs/technical-debt.md §3.1
   处理，不要为它改动无关代码。
6. cli typecheck 的 Effect.fn R=unknown 与 packages/app/happydom.ts 的 lint error 在 main 就存在。

【报告要求】如果你跑出的失败在上表内，在报告里显式标注「既有失败，未处理」，不要静默忽略也不要修。
```

---

## S1 提示词：输出编码与脱敏真源（Security First）

```text
任务：S1 — 修复两处"本仓代码删掉/没同步已有保护"的缺陷（packages/ui、packages/session-ui、packages/core、
packages/aigcfroge，TDD 红→绿）。这两条共享同一个根因，必须一起修。

【背景事实（已实测核实，供定位；行号以实际代码为准）】
A. markdown 链接渲染删掉了上游自带的转义
- packages/ui/src/context/marked.tsx:478-487 的 createMarkedParser() 覆写了 renderer.link：
    const titleAttr = title ? ` title="${title}"` : ""
    return `<a href="${href}"${titleAttr} class="external-link" target="_blank" rel="noopener noreferrer">${text}</a>`
  两个值都是**原样插值**。
- marked 17.0.1 的默认 link 实现（node_modules/marked/lib/marked.esm.js，函数 X = encodeURI 包装、
  w = HTML 实体转义）做的是 encodeURI(href) + escape(title)。覆写把这两道保护都删了。
- marked.use 的包装逻辑是「覆写返回非 false 就不回落默认」，所以默认实现永不执行。
- 该覆写的**唯一目的**是加 class="external-link" + target + rel。
- 下游放行：packages/session-ui/src/components/markdown-cache.tsx 的 DOMPurify config 有
  FORBID_TAGS:["style"]（禁的是 <style> 标签）但**没有 FORBID_ATTR** ⇒ style **属性**放行；
  form/input/button/img 都在 DOMPurify 默认 html profile 的 allowlist 内。
- CSP 放大：packages/aigcfroge/src/server/shared/ui.ts 的 csp() 是
  style-src 'self' 'unsafe-inline'、img-src 'self' data: https:、且**没有 form-action**
  （form-action 不回落 default-src）。packages/app/index.html 无 CSP meta。
- 注入面驱动方：packages/session-ui/src/components/message-part.tsx:1704 / :1728 / :1755 把
  list/glob/grep 的**原始工具输出**当 markdown 渲染（即仓库文件内容 → 富 HTML）。
  同一文件的 bash 分支 :1998-2000 用 <pre><code>{text()}</code></pre> 文本节点，是安全写法。
- 已确认的危害形态：title 里闭合属性后注入 style="position:fixed;inset:0;z-index:99999"
  ⇒ 全视口遮罩可盖住 permission / question 提示框，诱导用户批准工具调用；外链 <img> 作信标。
  **不是 JS 执行**（DOMPurify 剥事件处理器，CSP 挡内联脚本）——报告里不要夸大成 RCE/XSS-JS。

B. 凭据脱敏模式两处实现发散
- packages/core/src/credential-scanner.ts:2 只 import 了 API_KEY_RE / BEARER_TOKEN_RE /
  PRIVATE_KEY_RE / ENV_LINE_RE 四个；本地 PATTERNS 数组 4 项；Hit["type"] 是 4 值联合。
- packages/schema/src/credential-scan.ts:31 的 SECRET_PATTERNS 有 6 个，多出
  NAMED_CREDENTIAL_RE(:21) 与 ENCODED_BEARER_RE(:29)。
- 引入这两个模式的提交是 e4a036866「fix(schema): widen the MCP secret scan to flag-prefixed and
  encoded credentials」，git show --stat 显示它只改了 4 个文件，**没有一个是 core 的 scanner**。
- core scanner 的运行时消费方：packages/core/src/mcp/connection.ts:568 的 redactStderrLine、
  :616 的 redactRemoteResponse、packages/core/src/workflow/workflow-runner.ts:205。
  ⇒ MCP 子进程 stderr 与远程响应在进日志前，对 --token=… / Bearer%20… 形态**不脱敏**。
- docs/technical-debt.md §5 把这条记成「已闭环」，实际只闭了 schema 一半。
- 误拒预算参照：packages/schema/test/credential-scan.test.ts 已钉住 5 条合法输入仍通过。
```

```text
【Phase A（红）】四组测试，逐组跑出预期失败并记录原始输出：
1. packages/ui/src/context/marked.test.ts（新建）：对 createMarkedParser() 的**真实产物**断言，
   不要另建干净 Marked 实例。两条 PoC：
   - 输入 [x](https://ok.example 'a" style="position:fixed;inset:0') → 输出的 title 属性内 " 必须已被
     实体化，整段输出不得出现 style=
   - 输入 [x](https://a"style="b) → href 必须经 encodeURI（不得出现裸 "）
2. packages/session-ui/src/components/sanitize-regression.test.tsx（扩展）：补当前缺失的三条 ——
   style 属性、<form action>、外链 <img> 必须被剥。
   **陷阱**：该套件跑在 happy-dom 上，同一个 sanitizeMarkdown 在不同 happy-dom 初始化下会丢掉
   <a>/<p>/<form>/裸 <img>，于是 not.toContain(...) 会**因元素被环境丢弃而假通过**。
   ⇒ 每条必须先断言承载元素存在，再断言危险属性被剥。做不到就改用真实浏览器 e2e 并说明理由。
3. packages/core/test/credential-scanner.test.ts（新建）：四条形态经 redactStderrLine 后不得含原值 ——
   --token=ghp_xxxxxxxxxxxxxxxx、--env=TOKEN=xxxxxxxxxxxx、?token=xxxxxxxxxxxx、
   ?Authorization=Bearer%20xxxxxxxxxxxx。
4. 同文件补一条误拒预算：schema 侧那 5 条合法输入经 core scanner 也不得被脱敏。

【Phase B（绿）】按根因修，不要按现象修：
1. **删掉 marked.tsx 的 renderer.link 覆写**。加属性改用不接管渲染的方式：
   markdown-cache.tsx:30 附近已有一个 DOMPurify afterSanitizeAttributes hook，是现成的加
   class/target/rel 的位置；或用 marked 的 postprocess hook。
   **明确禁止**在覆写里补 escapeHtml/encodeURI —— 那等于保留一份必须自己维护转义的分叉实现，
   下一个改这段代码的人会再犯一次（极致减法：删除 > 修补）。
2. markdown-cache.tsx 的 config 加 FORBID_ATTR: ["style"]，FORBID_TAGS 增加
   form / input / button / select / textarea。改动后确认 kb:// 协议与 svg/path 白名单不受影响。
3. message-part.tsx:1704 / :1728 / :1755 三处改成 <pre><code> 文本节点，对齐同文件 bash 分支
   :1998-2000 的写法。
4. **删掉 credential-scanner.ts 的本地 PATTERNS 数组**，改遍历 schema 的 SECRET_PATTERNS 单一真源；
   Hit["type"] 与 CredentialScan.ScanResult 的 literals 从 4 扩到 6（这两者现在本来就不同步）。
   **明确禁止**在 core 里补那两个正则 —— 下次再加模式还会漏（复用 > 新增）。
5. shared/ui.ts 的 csp() 补 form-action 'self'。

【Phase C（回归）】
bun --cwd packages/ui test
bun --cwd packages/session-ui test
bun --cwd packages/core test test/credential-scanner.test.ts --timeout 30000
bun --cwd packages/schema test
四包 typecheck；LINT_BASE_REF=origin/main bun run script/lint-changed.ts
手动：light/dark 各看一遍含链接与含 list/glob/grep 输出的会话，确认 external-link 的
样式、target、rel 仍生效，代码块仍可读。

【验收】
- 9 条新测试全绿，且每条都贴出了未改代码时的原始失败输出
- marked.tsx 里不再有接管 link 渲染的代码
- credential-scanner.ts 里不再有本地模式数组
- 顺手更正 docs/technical-debt.md §5 那条「已闭环」的表述（只改表述，不动其他行）

【显式不做】packages/app/index.html 补 CSP meta（涉及 vite dev/desktop renderer 三种载入路径，
另立专项）；sanitizeHtmlLite 的单遍 replace 可重组问题（由 iframe sandbox 兜住，另立专项）。
```

---

## S2 提示词：未 await 的断言与一道可行的门禁（No Cheating · 一击必杀）

```text
任务：S2 — 修全仓 29 处「断言写了但从不执行」的测试，并加一道能防止复发的门禁
（packages/aigcfroge、packages/desktop、script/，TDD 红→绿）。

【先纠正一个直觉错误（顾问已实测，不要再走这条路）】
这批缺陷不能靠"把关掉的 lint 规则打开"来抓。根因是 **Bun 的类型在说谎**：
expect(p).rejects.toThrow() 运行时返回 Promise，但 bun-types 把它标成 void。后果是两个方向的
类型驱动规则都失明：
- typescript/await-thenable 若打开，会把**正确**写法（await expect(...).rejects.…）判成
  "await 了一个非 thenable" —— 仓内有 **33 处**正确写法会被误报，0 处真 bug 会被抓到。
  .oxlintrc.json:56-65 的 override 正是为此刻意关掉它的，注释已写明理由。**不要动这个 override。**
- typescript/no-floating-promises **已经开着**（.oxlintrc.json:52 "warn"，且不在 test override 的
  关闭列表里），但它同样看不见 —— 从类型上看 .toThrow() 返回 void，没有"悬空的 Promise"。
⇒ 唯一可行的门禁是**文本级检查**：匹配行首 expect(...) 紧跟 .rejects / .resolves 且该行不含 await。

【背景事实（已实测核实）】
- 缺 await 的站点全仓 **29 处**，不是最初报告的 5 处。desktop 的 5 处只是子集：
  packages/desktop/src/main/attachment-picker.test.ts:40 / :66 / :74 / :85
  packages/desktop/src/main/updater-controller.test.ts:108
  其余分布在 packages/aigcfroge/test/ 下，已确认的样本：
  cli/run/runtime.queue.test.ts:479、cli/run/runtime.boot.test.ts:156 / :160 / :219 / :274、
  cli/tui/plugin-lifecycle.test.ts:110 / :112、cli/tui/plugin-loader-entrypoint.test.ts:64。
  完整清单由 Phase A 的检查脚本自己列出，不要照抄这里的样本。
- 正确写法 33 处（含 aigcfroge/test/plugin/xai.test.ts:329 / :404、
  aigcfroge/test/util/filesystem.test.ts:189），用来验证门禁不误报。
- 危害不均等：desktop 的 :66 / :74 是**跨 renderer picker-token 隔离**与**release 后授权**的
  唯一断言 ⇒ attachment-picker.ts:20 那道安全控制实际从未被验证过。
- 另有零断言用例：attachment-picker.test.ts:34 / :70 / :77 有 0 个被强制执行的断言；
  updater-controller.test.ts:89-110 因 :108 未 await，导致 :109 断言的是**安装前**状态。
- 独立且较小的缺口：packages/desktop/tsconfig.json 的 exclude 是 ["src/**/*.test.ts"]，
  desktop 测试文件全部不进 typecheck。**它抓不到本批缺陷**（丢弃一个 void 是合法的），
  但它是真实的覆盖缺口，本批顺手关掉并如实报告它照出了什么。
```

```text
【Phase A（红）】门禁先行 —— 这一步的输出就是本批的红证：
1. 新建检查（放 script/ 下，形如 script/check-unawaited-assertions.ts；若 script/lint-changed.ts
   有合适的挂点则并入它，不要新建平行入口）：
   扫 packages/*/{src,test} 的 *.test.ts / *.test.tsx，报出「行首 expect(…) 紧跟 .rejects 或
   .resolves 且该行不含 await」的全部站点。
2. 跑它，把**完整站点清单**贴进报告。预期 29 处；如果不是 29，如实报告实际数字与差异原因。
3. 反向验证门禁不误报：确认那 33 处正确写法**没有**被报出来。这一条必须在报告里给出数字。
4. 改 packages/desktop/tsconfig.json 把 src 下的 *.test.ts 纳入 typecheck，跑
   bun --cwd packages/desktop typecheck，如实报告它照出了什么（可能是 0 条本批相关）。

【Phase B（绿）】
1. 逐处补 await。
2. **补上 await 之后，之前从未执行的断言会真正运行。任何因此真实失败的断言 = 一个新发现的 bug。**
   遇到这种情况：**停下报告，不要弱化断言让它过**。已知至少一处会变 ——
   updater-controller.test.ts:109 补 await 后断言的对象从"安装前状态"变成"安装后状态"。
3. attachment-picker.test.ts:34 / :70 / :77 的零断言用例：补真实断言，或删除该用例。
   不允许留着当摆设（docs/testing.md §10）。
4. 把 Phase A 的检查接进门禁：加进 package.json 的 lint 链路（与 script/lint-changed.ts 同层），
   使其在 CI 的 lint 步骤里执行。

【Phase C（回归）】
bun --cwd packages/desktop typecheck && bun --cwd packages/desktop test --timeout 30000
bun --cwd packages/aigcfroge test --timeout 30000（全量；注意【已知噪声】第 1、2 条）
LINT_BASE_REF=origin/main bun run script/lint-changed.ts
新门禁自身跑一遍，输出应为 0 站点
bun typecheck（全仓，确认 desktop tsconfig 改动没波及 project references）

【验收】
- 新门禁存在、接进 lint 链路、当前输出 0 站点，且对那 33 处正确写法零误报（报告给数字）
- 29 处（或实际数量）全部补齐，每一处因此暴露的真实失败都单独列出并说明处置
- picker-token 隔离与 release 后授权两条断言真实执行：贴出未补 await 时它们失败的输出
- desktop 测试进入 typecheck，且报告写明它照出了什么

【显式不做】动 .oxlintrc.json:56-65 的 test override（见上，打开会误报 33 处、抓 0 个 bug）；
把 packages/app/e2e 纳入 typecheck（29 个存量类型错误，另立专项）。
```

---

## S3 提示词：两处判空手误（No Null Pointer）

```text
任务：S3 — 修 packages/app 里两处一行级手误（TDD 红→绿）。两条无共享根因，归并成一批只因同包同量级。

【背景事实（已实测核实）】
A. Binary.search 的判空写晚了一行
- packages/app/src/context/global-sync/event-reducer.ts:193-195：
    const result = Binary.search(input.store.session, info.id, (s) => s.id)
    if (info.time.archived) {
      if (input.store.session[result.index].time.archived === info.time.archived) break   // ← 这里解引用
      if (result.found) { ... }                                                           // ← 检查在下一行
- Binary.search 未命中返回 { found:false, index:left }，且 left 可等于 array.length
  （packages/core/src/util/binary.ts:19）⇒ input.store.session[result.index] 为 undefined
  ⇒ 读 .time 抛 TypeError。
- 传播链：异常经 packages/app/src/context/server-sync.tsx:516 的 batch() 上抛进
  packages/app/src/context/server-sdk.tsx:118-120 的 flush() ⇒ output.forEach 中途中断，
  **该帧剩余事件全部丢失**；且 flush 末尾 :122 的 buffer.length = 0 被跳过 ⇒
  下一帧 queue/buffer 交换把旧事件重新发出（重复/乱序）。store 与服务端状态就此漂移。
- 同处附带缺陷：sessionTotal 在 result.found 之外**无条件** -1（:212 与 :256），
  外层的 Math.max(0, …) 把漂移压到 0 而不是暴露它。
- 现有测试 event-reducer.test.ts:221 只覆盖 session 在列表内的归档路径，恰好漏掉这个分支。
- 触发路径（现实可达）：child store 刚创建（session: []，loadSessions 未完成）时收到任意归档事件；
  或他端归档了一个超出本地保留窗口的会话。事件按目录广播，与本地列表裁剪无关。

B. 形参遮蔽导致自比较恒真
- packages/app/src/context/directory-sync.ts:185-188：
    const current = createMemo(() => serverSync.child(directory, { mcp: true }))
    const target = (directory?: string) => {
      if (!directory || directory === directory) return current()   // 恒真
      return serverSync.child(directory)                            // 不可达
    }
  形参 directory 遮蔽了外层同名闭包变量，两侧指的都是形参。
- 触发链（已逐跳验证）：prompt-input/submit.ts:337-374 新建 worktree 会话时
  sessionDirectory ≠ projectDirectory → session.tsx:1387 / submit.ts:597 传入当前项目目录的
  DirSync → submit.ts:131-136 的 optimistic.add({ directory: sessionDirectory }) →
  target() 恒返回 current() ⇒ 乐观消息写进**当前项目目录**的 child store。
- 影响：worktree 首条消息无乐观回显；错误 store 里留一条孤儿 message 记录。add/remove 都走错的
  同一个 store，所以失败回滚自洽、不崩溃 —— 这是它长期没被发现的原因。
```

```text
【Phase A（红）】
1. event-reducer.test.ts 补两条：
   - store.session 为空时收到带 time.archived 的 session.updated：当前抛 TypeError，改后不抛且不误改状态
   - 未命中列表的 session.deleted：当前 sessionTotal 被减 1，改后不减
   参照既有 :221 用例的装配方式。
2. directory-sync 的 target 抽成可测纯函数（形如 pickTarget(ownDirectory, requested)），
   补一条断言 requested ≠ ownDirectory 时返回的是 requested 那侧。
   若抽函数会牵动过多调用点，改为断言"跨目录 optimistic 写入落到目标 directory 的 store"，
   并在报告里说明选择理由。

【Phase B（绿）】
1. event-reducer.ts：判空提前 ——
     const existing = result.found ? input.store.session[result.index] : undefined
     if (existing?.time.archived === info.time.archived) break
   并把 sessionTotal 的减量移进「result.found 且确实从列表移除」的分支。
2. directory-sync.ts：形参改名（如 dir）并与外层 directory 比较，让 :187 那行真正可达。

【Phase C（回归）】
bun --cwd packages/app test:unit
bun --cwd packages/app test:virtualizer
bun --cwd packages/app typecheck
LINT_BASE_REF=origin/main bun run script/lint-changed.ts
只跑受影响的 e2e spec，不跑全量。

【验收】4 条新断言全绿且有红证；sessionTotal 漂移用例通过；worktree 首条消息有乐观回显（手动验一次）。
```

---

## S4 提示词：写路径单一 owner（复用 FileMutation）

```text
任务：S4 — 让 KB 写路径复用既有的 FileMutation owner，并补齐同型缺口（packages/core，TDD 红→绿）。
本批次含一个已由顾问裁定的设计结论，见【裁定】段，执行方不需要再做产品决策。

【裁定（不要重新讨论）】
KB 的写序问题**不是**"事务化 vs 接 sweep"的产品裁决，而是实现缺陷：
- FileMutation 已具备全部所需原语 —— writeIfUnchanged（file-mutation.ts:73 条件写/CAS）、
  remove（:76）、writeAtomic（:78 tmp+rename）、locks.withLock(target.canonical)(
  Effect.uninterruptible(...))（:96，KeyedMutex 按目标序列化）。
- 全仓 12 个文件在用它：5 个 typed 资产服务、custom-profile-service、session/artifact.ts、
  tool/{write,apply-patch,edit}.ts、location-layer。
- packages/core/src/session/kb-service.ts 对 FileMutation 的引用数是 **0**，两处写是裸
  fs.writeWithDirs（:257、:367）—— 既无锁、无原子写、无条件写。
⇒ KB 是全仓唯一绕开既有 owner 的写路径。按极致减法（复用 → 删除 → 归并 → 重构 → 新增），
  答案是复用 FileMutation，**不推翻 ADR-14 的「.md 是内容真源」**，而是正确实现它：
  身份检查对文件系统做、在锁内做、在写之前做；DB 降级为纯索引；syncFromDirectory 接启动 sweep
  作为**收敛兜底**而非正确性依赖。

【背景事实（已实测核实）】
- create 写序：kb-service.ts:282 先写 <dir>/<title>.md，:284-297 才 insert，撞
  kb_note_scope_title_unique（session/kb.sql.ts:26）→ Effect.orDie → 500。
  终态：既有笔记的 .md 已被换成新内容，DB 行仍是旧内容，永久不一致。create 全程无同名预检。
- rename 写序：kb-service.ts:354-361 **先删旧镜像**（失败只 logWarning），:367 才写新镜像，
  :369-380 最后改 DB。两个分支都坏 ——
  (a) 写新失败 → 旧文件已删、新文件不存在、DB 未改，内容只剩 DB 里，磁盘侧消失；
  (b) 新标题与同 scope 另一篇重名 → :367 覆盖**那一篇**的镜像，DB update 撞唯一索引 500 →
      旧镜像已删 + 别人的笔记文件被写脏 + DB 完全没变。UI 标题输入框无重名校验。
- 两处写序的注释（:278-282、:347-350）都用「syncFromDirectory 会重新导入/收敛」论证自己安全，
  且都标了 (review MAJOR) —— 说明这个写序本身就是上一轮评审的修复方案。
  而 syncFromDirectory 全仓 12 处命中里：接口声明 :103、那两条注释、实现 :525、Service.of 导出 :614、
  以及 6 个测试调用点。**生产代码零调用方**。所以那两个半状态是永久的。
- 同型缺口 1：session/artifact.ts:102 的 fs.exists 冲突判定在锁外，:106 的写才进锁
  （file-mutation.ts:96）⇒ TOCTOU；它用了 writeAtomic 但没用 writeIfUnchanged，
  且丢弃了 writeAtomic 返回的 priorBytes（file-mutation.ts:230）。
- 同型缺口 2：tool/grep.ts 与 tool/glob.ts 都是裸
  path.resolve(location.directory, input.path ?? ".")，无 FSUtil.contains、无 LocationMutation.resolve。
  RelativePath（packages/schema/src/schema.ts:6）是纯 brand 零校验，绝对路径与 ../ 都能解码。
  对照 tool/read.ts:56-63 有完整的 contains + realPath 双重校验。
  且 permission/effective.ts:33 的 READONLY_CEILING_ACTIONS 含 glob/grep ⇒
  custom 无人值守会话对这两个工具是**预授权**的，等于无审批越界读。
- 权限缺口：KBTools.layer 在 tool/builtins.ts:88 **全局注册**，而 plugin/agent.ts:229 的 defaults
  首条是 { action:"*", resource:"*", effect:"allow" }，默认 agent 与 general 子代理都只在 defaults
  上做加法、无 catch-all deny ⇒ kb_create/kb_update/kb_delete 对它们既被广告也被允许。
  只有 assistant-orchestrator（agent.ts:455-464）有 {*,*,deny} + 只放行读类。
  后果：一个 coding 会话可静默 kb_delete 掉用户笔记（行 + .md 一起删，无审计行、无 undo）。
```

```text
【Phase A（红）】五组测试，逐组跑出预期失败：
1. packages/core/test/kb-service.test.ts 扩展三条：
   - 同名 create 失败后，既有笔记的 .md 内容**未被改动**
   - rename 到同 scope 已存在的标题时失败，且旧镜像仍在、被撞的那篇镜像未被改动
   - rename 写新镜像失败时旧镜像仍在（用只读目录或 mock 制造写失败）
2. artifact 并发一条：两次 apply 同一目标，第二次得到冲突而非静默覆盖
   （现有测试位置见 packages/core/test/ 下 artifact 相关文件；没有就新建）
3. packages/core/test/tool-path-containment.test.ts（新建）：
   grep({ pattern, path: "../.." }) 与 glob({ pattern, path: "/etc" }) 必须被拒
4. 权限一条：默认 agent 的 ruleset 下 kb_delete 必须不可用（断言 evaluate 结果或工具表不含它）

【Phase B（绿）】
1. kb-service.ts 注入 FileMutation：两处 fs.writeWithDirs 换成 writeAtomic；把「目标 .md 是否已存在」
   的身份检查移进 withLock 内、移到写之前。
2. rename 改为「先写新镜像、成功后再删旧镜像」，或在同一锁作用域内对新旧两个目标都取锁。
   两种都可以，选哪种在代码注释里写清理由。
3. syncFromDirectory 接启动 sweep：照 packages/core/src/session/scheduled-job.ts:203-235 的
   recoverStaleClaims + SchedulerCore.daemon({ startupSweep }) 范式（daemonNode 已在
   httpapi/server.ts:338 接入 app 图，**不要新建 daemon**）。定位为收敛兜底，不是正确性依赖。
4. session/artifact.ts：冲突判定移进锁内，或改用 writeIfUnchanged。
5. grep.ts / glob.ts 补 FSUtil.contains 校验，照 read.ts:56-63 的形状。
   **但失败要用 ToolFailure 而不是 Effect.die** —— read.ts 用 die 是既有偏差（模型输入校验错误不该是
   defect），不要照抄那一点。
6. plugin/agent.ts：给默认 agent 与 general 的 ruleset 加 kb_create/kb_update/kb_delete 的 deny
   （或把 KBTools 改为按 agent 注册）。**这一条如果影响面超出 ruleset 本身，停下报告**。

【Phase C（回归）】
bun --cwd packages/core test --timeout 30000（全量，不要只跑改动文件）
bun --cwd packages/core typecheck
LINT_BASE_REF=origin/main bun run script/lint-changed.ts
跑之前确认没有其他重任务在跑（见【已知噪声】第 1、2 条）。

【验收】
- 8 条新断言全绿且各有红证
- kb-service.ts 内不再有裸 fs.writeWithDirs
- syncFromDirectory 有生产调用方（贴出 grep 证据）
- 默认 agent 下 kb_delete 不可用

【显式不做（各自另立专项，不要在本批次碰）】
- RelativePath 在 schema 层加 filter：**243 处消费点**跨 core/aigcfroge/app，必须先用
  codegraph_impact 量影响面
- KB 的 scope:"project" 无分区列（kb_note 表无 project/directory/workspace 列，唯一索引是全局
  (scope,title)，而镜像目录按每次请求的 directory 算）：需要 schema 迁移
- propose_note 的确认侧 UI（全仓零消费方）
- workflow/plugin 资产内联 handler 的盲覆盖与静默回滚：归 UX/架构计划
- Custom snapshot 的 freeze 静默降级与无 re-freeze 通道：归架构计划
```

---

## 批次划分的协议依据

为什么不是一个"止血批次"，而是四个：

- **CLAUDE.md 改完即审 §1**「确认影响面：`git diff -- <files>` 锁定本次改动，不顺手修无关代码」——
  一个跨 ui/session-ui/app/core/desktop/schema 的批次无法做影响面确认。
- **根因收敛三步法**（归类 → 找交集 → 一击必杀）要求按**类型**分组而非按文件。分组后 S1 的交集是
  「本仓代码删掉/没同步已有保护」、S2 是「Bun 类型说谎导致类型驱动的 lint 双向失明」、S4 是
  「写路径缺 owner」；S3 无共享根因，是两处孤立手误，归并只因同包同量级。
- 分组这一步**改变了四条的修法**，全部是**极致减法（复用 → 删除 > 修补 > 新增）**的直接结果：
  - S1 的 marked 从「补转义」变成「删覆写」
  - S1 的 scanner 从「补两个正则」变成「改用 schema 单一真源」
  - S2 从「打开被关掉的 lint 规则」变成「加一道文本级门禁」—— 实测发现打开
    `typescript/await-thenable` 会误报仓内 33 处**正确**写法、抓到 0 个真 bug，
    因为 Bun 把 `expect().rejects.X()` 标成 `void`；同时 `no-floating-promises` 已经开着却同样失明。
    并且站点数从 5 修正为全仓 29。
  - S4 的 KB 从「事务化 vs 接 sweep 二选一裁决」变成「复用 FileMutation」
- S2 排在 S1 之后、其余之前，是因为它建立的那道门禁会覆盖 S3/S4 新写的测试。

## 审批记录追加位置

每批次验收后，在本文件末尾按 `prompt-external-cli-dispatch.md` 的惯例追加一节：

```text
## S<n> 审批结果（日期，通过/打回）与后续补丁

【S<n> 经验补丁（S<n+1> 起追加遵守）】
1. ...

【S<n> 已确立、后续批次直接可用的契约事实】
- ...
```

审批重点三项（这轮审计恰好暴露了这三处最容易造假）：

1. **红证是真的吗** —— 要求贴出「未改代码时该测试失败」的原始输出。S2 那批缺 `await` 的教训就是：
   断言写了但从不执行，`bun test` 报绿、`no-floating-promises` 开着也看不见。
2. **修的是根因还是现象** —— S1 交上来「在覆写里补 escapeHtml」而不是「删覆写」、或「在 core 补两个
   数组项」而不是「改用 schema 真源」，打回；S2 交上来「打开 await-thenable」，打回。
3. **有没有顺手改无关代码** —— `git diff --stat` 必须与批次范围逐文件对得上。

---

## S1 审批结果（2026-08-29，打回）与后续补丁

三项审批重点：**根因 ✅ 通过**（四条修法全部按根因走，marked 覆写是删掉不是打补丁，core 的
本地 `PATTERNS` 是删掉不是补两项）、**范围 ✅ 通过**（12 文件全部在批次内，`technical-debt.md`
只动一行）、**红证 ❌ 不成立**（见 B3）。另有两处必改（B1/B2）。

【B1 阻塞 · `FORBID_ATTR: ["style"]` 在生产环境摧毁 KaTeX 数学渲染】
真实 Chromium + DOMPurify 3.4.6 实测：KaTeX 输出的 10 个内联 style → **0**。`.katex-html`
视觉层完全靠内联 style 定位 strut/分式/vlist，剥掉后 `\frac{a}{b}` 是重叠错位的字形，
不是交付报告里写的「布局降级（内容保留）」。KaTeX 是在用的功能：`marked.tsx:484` 的
`markedKatex`、`:389`/`:402` 两处 `katex.renderToString`、`ui/src/styles/index.css:7` 引入
`katex.min.css`。**已申报但从未实测的风险，落在一个在用功能上，不构成可以静默交付的取舍。**

三条修法（按 极致减法 排序，取 2、退 1）：

1. **删除**对内联 style 的依赖：KaTeX 改 `output: "mathml"`，Chromium 109+ 原生渲染 MathML，
   本仓是 Electron/Chromium，`FORBID_ATTR: ["style"]` 可原样保留。代价：数学外观变化，需真机看。
2. **归并**到容器层而非属性层：遮罩之所以成立是 `position:fixed` 能逃出消息容器逃到视口。
   给 markdown 容器建立 containing block（`contain: layout paint` 或 `transform`）即可就地封死，
   不动 sanitizer、不伤 KaTeX，一行 CSS。**前置验证**：permission / question 面必须渲染在该容器之外。
3. **重构**成 style 值过滤：在既有 hook 里删掉可逃逸的属性。代码最多，且是黑名单——
   与 `technical-debt.md` 里自己批评过的形状同款。
   **禁止**用 `class="katex"` 做 style 白名单豁免：class 可由 markdown 直接伪造，等于没防。

【B2 阻塞 · `"img"` 进 `FORBID_TAGS` 是未批准的范围扩张，删掉了在用功能】
实测 `![alt](https://…)`、`![alt](data:image/png;base64,…)`、`![alt](/local/file.png)`
一律 sanitize 成 `<p></p>`——远程、内联、本地图片全没了，`alt` 文本也一起丢。
`session-ui/src/components/timeline-playground.stories.tsx:263` 有 `![Alt text](…)` 作为渲染
fixture，服务端 CSP 又刻意允许 `img-src 'self' data: https:`，所以这一改与既有决定相冲。
**这一半是提示词的错**：S1 要了一条信标测试，而 S1 给的 `FORBID_TAGS` 五项修法根本满足不了它——
提示词自相矛盾。修法：**去掉 `"img"`**，那条信标测试按最终决定重写。若信标外泄需要处理，
那是 CSP `img-src` 收窄的独立决定，不是 markdown 标签禁用。

【B3 阻塞 · sanitizer 的红证不成立，而真实浏览器本来就有】
`sanitize-regression.test.tsx` 跑在 happy-dom 上，实测：**只要前面有任何一个元素被 DOMPurify
删除，它之后的所有节点就完全跳过属性消毒**。加个 `<unknowntag></unknowntag>` 前缀，
`onclick`、`javascript:` href、`style`、`<form action>`、`<img>` **全部原样存活**：

```text
happy-dom          baseline onclick        <span>X</span>          ← 正确
happy-dom          after unknown tag       <span onclick="alert(1)">X</span>   ← 逃逸
happy-dom          js: href after removal  <a href="javascript:alert(1)">X</a> ← 逃逸
真实 Chromium      after unknown tag       <span>X</span>          ← 正确
真实 Chromium       js: href after removal  <a>X</a>                ← 正确
```

成因是 DOMPurify 依赖 live `NodeIterator`，而 happy-dom 的 iterator 在当前节点被 removeChild
后失效——**是 happy-dom 一致性缺口，不是生产漏洞**（真实 Chromium 全部正确消毒）。但后果是：
**这套测试的绿取决于 payload 在文档里的位置，不取决于 config 是否生效**，所以那三条新测试证明的
是「config 字面量改了」，不是「sanitizer 剥掉了」。提示词已预告 happy-dom 陷阱并写明「做不到就改用
真实浏览器 e2e 并说明理由」；`chromium-1217` + playwright 1.59.1 是装好的，本次审批就是用它两分钟
测出上表的。**要求**：这三条断言在真实浏览器里钉一遍，并补「payload 不在文档首位」的变体，
让这套测试具备真正失败的能力。

【必改，非阻塞】

1. **新引入 Prettier 漂移**：`packages/schema/src/credential-scan.ts` 基线上是干净的、改后变脏
   （`SECRET_PATTERN_LIST` 的类型标注超 printWidth 120）。已用 stash 比对确认。
   `message-part.tsx`/`.css` 基线上就脏，属存量，**不要动**。
2. **凭据模式仍有第三份副本**：`packages/http-recorder/src/redaction.ts:30` 自带
   `SECRET_PATTERNS: ReadonlyArray<{label, pattern}>`。形状与用途都不同（cassette env 脱敏），
   可以判定为独立 owner，但 S1 的目标就是单一真源，报告里一个字没提。要么归并，要么写明为何不归并。
3. **报告口径**：「手动 light/dark 视觉检查未执行（本环境无浏览器）」——浏览器是装好的。
   如实写「未做」，不要归因于环境。

【S1 经验补丁（S2 起追加遵守）】

1. **happy-dom 的 sanitize 测试只在 payload 位于文档首位、且其前无任何元素被删除时可信。**
   任何「危险东西被剥掉了」的断言，若跑在 happy-dom 上，必须同时给出真实浏览器证据，
   或至少补一条「同 payload 挪到删除节点之后」的变体证明测试会失败。
2. **申报风险 ≠ 可以不测。** 落在在用功能上的风险必须实测后再申报，并给出量化后果
   （本例：10 个内联 style → 0，不是「布局降级」）。风险栏里写着未实测的推测，
   等于把验证责任推给审批人。
3. **提示词要求的验收标准与提示词给的修法清单冲突时，停下报告，不要靠扩张范围凑绿。**
   B2 就是这样被夹住的——正确动作是把冲突交回来，而不是自行加一个 `FORBID_TAGS` 项。
4. **改了跨包导出的函数，就要跑下游包的测试。** `sanitizeMarkdown` 被
   `packages/app/src/pages/session/assistant-citation.test.ts` 消费，交付报告的命令表里没有 app。
   （本次审批补跑：app 958 pass + browser 225 pass，恰好没坏。）
5. **新增/改动文件必须过 Prettier**，即使该文件所在目录有存量漂移。用 stash 比对区分存量与新增。

【S1 已确立、后续批次直接可用的契约事实】

- `CredentialScan.ScanResult` **没有 HTTP 暴露面**（唯一消费方是 `core/src/credential-scanner.ts`），
  所以扩 type literals 不触发 SDK 重生成。
- `SECRET_TYPES` → `SECRET_PATTERN_LIST` → `SECRET_PATTERNS` 已构成派生链，core 的 `Hit["type"]`
  取自 `(typeof SECRET_PATTERN_LIST)[number]["type"]`，**结构上不可能再次漂移**。这比提示词要求的
  「两处 literals 手工同步」更强，予以采纳。
- `DOMPurify.FORBID_TAGS` 是**去壳留芯且跳过子树检查**：`form` 被剥后 `input`/`button` 原样留下，
  必须同时进 `FORBID_CONTENTS` 才整树删除。（S1 实测，已写进 `markdown-cache.tsx` 注释。）
- `afterSanitizeAttributes` hook 注册在 **DOMPurify 单例**上，`mermaid.ts` 的 sanitize 也会命中；
  但 hook 的 `instanceof HTMLAnchorElement` 判断会过滤掉 SVG 里的 `SVGAElement`，所以 mermaid 图内
  链接不受影响（也拿不到 noopener，属存量）。
- `message-part.css` 的 mono 代码块规格是 `--font-family-mono` + `font-feature-settings` +
  `font-size: 13px`，与 `[data-slot="bash-pre"] code`（:438-441）一致，该 13px 在本文件有 7 处先例。
- 真实浏览器验证路径：playwright 1.59.1 + `~/.cache/ms-playwright/chromium_headless_shell-1217/`，
  `chromium.launch({ executablePath })` 直接指过去即可（根目录 `bunx` 会解析到 1.62.1 并索要 build 1234，
  必须显式给 executablePath）。

## S1 返工结果（2026-08-29，审批人直接修复，通过）

三个阻塞项按 B1/B2/B3 逐条闭环，改动叠在原交付之上（未推翻其四条根因修法）。

| 项  | 修法                                                                                                                                                                                                                                                                                     | 证据                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | 删掉 `FORBID_ATTR: ["style"]`，改为**只摘出流能力**：hook 里用 CSSOM 判 `position ∈ {absolute,fixed,sticky}` 就 `removeProperty`（大小写自己 `toLowerCase()` 兜，不依赖实现归一化），并顺手摘 `transform`；结构层在 `markdown.css` 给 `[data-component="markdown"]` 加 `contain: layout` | 真机反向验证：加回 `FORBID_ATTR: ["style"]` → KaTeX 用例红（`styledCount` 0 vs >0）；还原到 S1 前 → 遮罩用例红（`inlinePosition` 得到 `"fixed"`） |
| B2  | `"img"` 从 `FORBID_TAGS` 去掉；信标测试改成「图片必须保留」并注明是刻意决定，外泄面记入 `technical-debt.md` §4                                                                                                                                                                           | 还原到 S1 前 → form 用例红（`form` count 1 vs 0），图片用例仍绿（图片本就该保留）                                                                 |
| B3  | 新增 `packages/app/e2e/regression/markdown-sanitize.spec.ts`：真实 Chromium，一条消息同时带遮罩/公式/图片/表单，用**真实几何**断言（`getBoundingClientRect` + `getComputedStyle`），并在单测文件头写清 happy-dom 缺口                                                                    | 3 passed；且上表两次反向验证证明它会红                                                                                                            |

选 `position` 而不是整条禁 `style`，依据是实测的 KaTeX 内联属性表：13 种构造只用到
`height / top / margin-left|right / vertical-align / border-bottom-width / min-width / width /
padding-left`，`position` **只出现 relative**（`\sum`、`\int` 各一次）。所以摘掉出流三值对 KaTeX
零影响，而 `position` 一去 `top/left/inset/z-index` 全部失效——一处删除同时关掉四个杠杆。

【非阻塞三项】`credential-scan.ts` 与新文件已过 Prettier（`ui.ts`/`message-part.*` 的漂移是存量，
未动）；http-recorder 的第三份副本与 markdown 远程资源外泄面已各记一行 §4 债；报告口径问题
本节即更正——真实浏览器一直是可用的。

【已运行】session-ui 114 / ui 10 / schema 159 / core 69（scanner + mcp-connection + workflow-runner）/
aigcfroge httpapi-ui 15 / app 958 + 3，全 0 fail；schema·core·session-ui·ui·aigcfroge·app 六包
typecheck 全 OK；`LINT_BASE_REF=origin/main bun run script/lint-changed.ts` → passed（11 files）。
lint 抓到并已修一处 `no-unsafe-type-assertion`（e2e 里 `node as HTMLElement`，改为形参标注 +
`if (!container) throw`，同时消掉两个 `!`）。

【剩余风险】① markdown 容器新增 `contain: layout` 会建立独立格式化上下文与层叠上下文；
容器首/末子元素外边距本来就被 `markdown.css` 归零，且 e2e 三条用例含真实几何断言未见异常，
但长会话下的视觉回归只有人工看过才算数。② `contain: layout` 不裁剪绘制，`position:absolute`
若将来被放行仍能画到容器外（当前被属性层挡住）；要硬边界得上 `contain: paint`，代价是裁剪
合法溢出，未采纳。③ 本次未做人工 light/dark 巡检。

---

## S2 审批结果（2026-08-29，条件通过：4 项问题已由审批方就地整改）

三项审批重点：**根因 ✅**（没去动 `.oxlintrc.json:56-65` 的 override，按要求做了文本门禁）、
**红证 ✅**（29 处清单是真的，补的都是真 `await`，无一处弱化断言）、
**范围 ⚠**（顺着门禁自己的输出扩到 core/tui 是对的；但生产代码被加了断言、desktop fixture 被裁剪）。

【整改 1 · 门禁太弱，漏了 4 处真缺陷 —— 真实总数是 33 不是 29】
交付的正则 `^\s*expect\(.*\)\.(rejects|resolves)` 要求 `expect(` 与 `.rejects` 在同一行。
全仓这类链共 **76** 条，其中 **13** 条是多行形态：

```text
await expect(
  doThing(),
).rejects.toThrow("boom")
```

门禁只看见 63 条，13 条隐形，其中 **4 条是真的没 await**：

- `packages/aigcfroge/test/cli/run/stream.transport.test.ts:2258 / :2306 / :2347` ——
  包在 `try { … } finally { await transport.close() }` 里，三个用例什么都没断言，
  而且未等待的 Promise 与 `close()` 抢跑。
- `packages/core/test/database-migration.test.ts:302` —— `test(...)` 回调**根本不是 async**，
  「rejects a non-empty database without a session table」这条迁移守卫断言从未执行。

门禁已重写为从 `.rejects` 位置**向前跨平衡括号**定位链首 `expect`，多行形态因此覆盖；
并跳过注释里引用的 `.rejects`（交付版需要为 `openai-ws.test.ts:813` 单独开口子）。
同时删掉交付版里：整个从未被调用的 `collectTestFiles()`、空的
`try { const entries = Bun.file(base) } catch {}`、把每个文件重读一遍只为重算同一个数字的
第二趟扫描、4 组 `as any` + `oxlint-disable`（`Bun.Glob` 的类型不是问题所在，
换成 `readdirSync` 递归后一个断言都不需要）、以及留在代码里的推理草稿注释。
现在：0 违例 / 75 条链（76 减 1 条注释）。4 处补齐后实测全绿，未暴露新 bug。

【整改 2 · 生产代码被塞 `as unknown as`，只为迁就测试用的 tsconfig 改动】
`packages/desktop/tsconfig.json` 加 `types: ["bun"]` 是必需的（去掉则 12 个测试文件
`Cannot find module 'bun:test'`，已实测），但它把 Bun 的 `fetch`（带 `preconnect`）带进了
renderer 的类型环境，于是 `Platform.fetch?: typeof fetch`（`app/src/context/platform.tsx:71`）
不再被满足 —— 报 `TS2741: Property 'preconnect' is missing`。交付的处置是在
`packages/desktop/src/renderer/index.tsx:229` 写 `as unknown as typeof fetch` 加两条
`oxlint-disable-next-line`。已改为 `Object.assign(wrapper, { preconnect: fetch.preconnect })`：
**真的提供了那个属性，而不是用断言假装提供**，零断言、零 disable、typecheck 通过。

【整改 3 · desktop fixture 被裁剪去迎合过窄的形参类型】
`servers.test.ts` 的两处 fixture 被删了字段来消掉多余属性检查：
`{ id, distro }` → `{ id }`、`{ available, version, error }` → `{ available }`。
但生产类型是 `WslServerConfig = { id, distro }`（`app/src/wsl/types.ts:35`，
`servers.ts:365` 构造的就是它）与 `WslRuntimeCheck = { available, version, error }`
（`types.ts:1`，`probeWslRuntime` 的返回值）—— **原 fixture 本来是忠于生产形状的**，
报错只是因为 `startup.ts` 的形参写成了结构最小类型 `{ id: string }` / `{ available: boolean }`，
而对象字面量会触发多余属性检查（生产传的是变量，所以不报）。删字段等于把 fixture 与生产解耦：
将来函数开始读 `distro`/`error`，测试照样绿。已改为把 fixture 声明成真实的
`WslServerConfig[]` / `WslRuntimeCheck` 再传入 —— 形参保持最小契约，测试反而钉住了
「真实类型满足这个契约」。

【整改 4 · `waitFor` 的 `?.()` 等于给测试装了静音开关】
`releaseAigcfrogeResolve?.()` 报 `TS2349: Type 'never' has no call signatures`（CFA 把只在
回调里赋值的 `let` 收窄成 `undefined`，`?.` 再剔掉 `undefined` 就剩 `never`）。交付的处置是
写 `(x as (() => void) | undefined)?.()`。已改为让 `waitFor` **返回等到的值**：
`const release = await waitFor(() => pendingAigcfrogeCheck.release)` → `release()`。
零断言，而且更强 —— 原来的 `?.()` 在时序变化后会静默什么都不做，测试照样绿。

【必须知道的既有缺口（未修，已记入 docs/technical-debt.md §4）】
`bun turbo test` 只跑 5 个包（`bunx turbo test --dry=json` 实测），**desktop（57，且根本没有
`test` script）· tui（211）· schema（159）· llm（308）· http-recorder（33）·
effect-drizzle-sqlite（7）共 775 个用例在 CI 从不执行**。所以 S2 报告里
「picker-token 隔离断言由从未执行变为真实执行」在本地成立、在 CI 不成立。
六包本地全绿，补齐不会因存量失败变红，但那是 CI 配置决定，不并入本批。
**静态面已覆盖全部包** —— 新门禁在 `bun run lint` 链路里（`ci.yml:27`）。

【S2 经验补丁（S3 起追加遵守）】

1. **新建门禁必须先证明它能看见"没写在同一行"的形态。** 交付前用一次与门禁无关的手段
   （raw grep 计数）交叉核对总量：本例 76 vs 63 的差额就是全部漏检。
   报告里必须给出「门禁看到的总量 = 独立手段数到的总量」这一条等式。
2. **类型环境改动（tsconfig 的 types / include）如果迫使生产代码加断言，说明改动放错了层或收尾没做完。**
   先问"能不能真的提供那个属性"，`Object.assign` 往往就够；断言是最后手段。
3. **为了让 typecheck 过而删测试 fixture 的字段，是让 fixture 与生产形状脱钩。**
   正确顺序：先查生产构造的是什么类型（`grep "const x: T ="`），再决定是改形参还是标注 fixture。
4. **`?.()` / `?? []` 出现在测试的关键动作上，等于装了静音开关。** 让辅助函数返回确定存在的值，
   而不是在调用点用可选链把"没等到"这件事咽下去。
5. **门禁进了 lint 链路 ≠ 它保护的测试会被执行。** 交付涉及某包的测试时，顺手确认
   `bunx turbo test --dry=json` 里有那个包。

【S2 已确立、后续批次直接可用的契约事实】

- `script/check-unawaited-assertions.ts` 已在 `package.json` 的 `lint` 链路末位，CI 经 `ci.yml:27`
  的 `bun run lint` 执行；它扫 `packages/*/{src,test}` 下全部 `*.test.ts(x)`，多行链与注释都已处理。
- `packages/desktop` **没有 `test` script**，标准命令 `bun --cwd packages/desktop test` 会报
  `Script not found "test"`；跑它的测试要 `cd packages/desktop && bun test --timeout 30000`。
- `packages/desktop/tsconfig.json` 现在把 `src/**/*.test.ts` 纳入 typecheck（原 `exclude` 已删），
  代价是 `types` 必须含 `"bun"`；这与 `packages/session-ui/tsconfig.json` 的既有做法一致
  （`types: ["vite/client", "bun"]` + dom lib）。
- `packages/core/test/database-migration.test.ts` 在 `origin/main` 上就未过 Prettier（已 stash 比对），
  本批新增行不构成新漂移；不要顺手格式化整个文件。

---

## S3 审批结果（2026-08-29，通过）

三项审批重点全过。两处修法与提示词一字不差：`event-reducer.ts:195` 判空提前成
`const existing = result.found ? … : undefined`，`sessionTotal` 的减量进了 `result.found`
（:212 与 :256 两处都改了）；`directory-sync.ts` 抽出 `pickTarget(ownDirectory, requestedDirectory)`
并改名形参，遮蔽因此在结构上不可能再犯。

红证复验（我自己 stash 还原 `event-reducer.ts` 跑的）：

```text
Error name: "TypeError"
(fail) does not throw when archiving a session not in local list and does not decrement total
Expected: 2  Received: 1
(fail) does not decrement sessionTotal when deleting a session not in local list
 17 pass / 2 fail
```

两条都因正确的原因失败。`bun --cwd packages/app test` 962 + 3 pass，typecheck 干净。

顺手核了一件提示词没提的事：`target()` 的跨目录分支从死代码变成活代码后，
`serverSync.child(effective)` 不带 `{ mcp: true }`、且会走 `pinForOwner`。
查过 `child-store.ts:81-99`：`pinForOwner` 按 reactive owner 去重且注册了 `onCleanup`，
在无 owner 的回调里直接 no-op，所以既不泄漏 pin 也不会重复 enableMcp。无新问题。

【留作记录，未要求改】`directory-sync.test.ts` 只测 `pickTarget` 本身，
`pickTarget("/a","/b") === "/b"` 近乎恒等式 —— 它不覆盖这个 bug 的真实影响
（跨目录乐观写入落到哪个 store）。因为抽函数已让遮蔽不可复现，接受现状；
但若以后有 solid-testing-library，补一条 store 路由断言才算真正钉住。

---

## S4 审批结果（2026-08-29，条件通过：1 项假测试与 3 项已由审批方就地整改）

**根因方向 ✅**：KB 确实改成了复用 `FileMutation`，裸 `fs.writeWithDirs` 归零；
artifact 换成 `FileMutation.create` 让存在判定进锁；grep/glob 用 `ToolFailure` 而不是
`Effect.die`（按提示词的明确要求，没照抄 `read.ts` 的 die）；权限 deny 落在
`AgentV2.defaultID` 与 `general` 两个 ruleset 内，没有外溢。
`fs.ensureDir` 被删掉是安全的 —— 已核 `writeAtomic` 自带
`catchReason("PlatformError","NotFound") → makeDirectory(recursive)` 兜底（file-mutation.ts:211-222）。

【整改 1（阻塞）· `tool-path-containment.test.ts` 是假测试】
交付的版本整个文件只测 `FSUtil.contains("/tmp/project", path.resolve(…, "../.."))`，
**一次都没调用 grep/glob**。我把 `grep.ts` 里那八行守卫整段删掉，它照样 **3 pass / 0 fail**。
它测的是一个本来就正确、也不是本批改动的工具函数，命名却让人以为它守着这个修复。
已重写为经 `ToolRegistry` 真调工具，并用 `Layer.mock(Ripgrep.Service)` 记录每次搜索的 `cwd`：
判别式是 **越界时 ripgrep 根本没被调用**（`expect(searched).toEqual([])`），
而不只是"返回了失败"。同时补了两条正向用例（`path: "src"` 仍能搜、省略 `path` 落在 Location 根）。
复验：守卫在 → 5 pass；把 grep 与 glob 的守卫都删掉 → **3 fail**。

【整改 2 · 笔记标题进了 defect 消息（Clean Logs）】
新增的四处 `Effect.die(new Error(\`Note with title "${input.title}" already exists…\`))`把标题
写进了错误消息，而**同一个文件 :253 的既有注释明确写着 "Clean Logs: no title in the message"**。
defect 会带完整消息进日志。已改为`A note with this title already exists in scope "…"`，
四处都不再回显标题。
**未改、需要单独一批**：重名是用户可触发的预期条件，用 `Effect.die`表达它意味着 HTTP 边界
仍然吐 500（改动前撞唯一索引`orDie`也是 500，所以不是回归）。改成`Schema.TaggedErrorClass` 要动 interface 错误通道 + HTTP handler + SDK 错误面，属独立改动。

【整改 3 · 两把互斥锁，"单一 owner"没真正达成】
提示词的裁定里我写了「FileMutation 已具备全部所需原语 —— `locks.withLock(target.canonical)`」，
**这句是错的**：`locks` 是 `file-mutation.ts:92` 的内部变量，`Service.of({ create, write,
writeTextPreservingBom, writeIfUnchanged, remove, writeAtomic })` 没有暴露它。所以「查重 + 写」
在同一临界区这个要求，用现有 Service 表面确实做不到 —— 执行方按提示词的规矩本该停下报告，
而不是自带一把 `KeyedMutex`。
实际后果（要说清，别高估也别忽略）：`kbLocks` 序列化了 KB 自己的写，
**不覆盖** `write`/`edit`/`apply-patch` 对同一个 `.md` 的写（那些走 FileMutation 内部的锁）。
失败形态是 KB 查到"文件不存在"→ write 工具建了它 → KB 的 writeAtomic 覆盖掉。
窗口很窄（kb\_\* 现在对默认 agent 已 deny，write 要审批），所以没有强行返工。
已在 `kbLocks` 声明处写清这把锁保护什么、不保护什么，并指出真正的修法：
FileMutation 需要一个「在锁内跑调用方前置检查」的组合子 ——
**直接把 `writeAtomic` 包进外层同键锁会重入死锁**（KeyedMutex 非重入），所以这是一个
设计任务而不是搬代码。已记入 `docs/technical-debt.md`。

【整改 4 · 启动 sweep 阻塞启动，且只覆盖 global】
提示词点名了 `scheduled-job.ts:203-235` 的 `SchedulerCore.daemon({ startupSweep })` 范式。
交付的 `startupLayer` 用 `Layer.effectDiscard` 直接 `yield*` 了同步扫描 ——
`effectDiscard` 的 effect 跑在 layer **构建期**，等于让服务端启动阻塞在一次文件系统扫描上；
另有 `Effect.catch(...)` 后再 `Effect.ignore` 的双重吞掉与 `String(e)` 丢结构。
已改为 `Effect.forkIn(scope)`（照 `reference.ts:112` 的既有形状，AGENTS.md 禁 `Effect.fork`）

- `catchCause` 传 cause。
  **未改的局限已写进代码注释**：只扫 global 目录。project 作用域的镜像在
  `<directory>/.aigcfroge/knowledge-base` 下，而启动时不存在"当前项目"这个概念（目录由每个
  Location 决定），所以 project 侧的收敛得挂在 Location 建立时。而本批三条 KB 新测试用的全是
  `scope: "project"` —— 也就是说测试覆盖的那个作用域恰好没有兜底。这一条本该在交付时报告。

【留作记录，未改】

1. `create` 的 `db.insert(...).values({...})` 在 `if (input.baseDir)` 与 `else` 两支各抄一份，
   `update` 的 `db.update(...).set({...})` 抄了**三份**。Reusability：两份/三份一定会漂移。
2. 三条新 deny 规则没有理由注释，而同一段里每一组 deny 都带（"2026-08-06 裁决"、
   "Mirror the V1 subagent defaults"）。理由是有的（KB 写路径是 UI 确认后的服务端 API，
   见 agent.ts:460-465 assistant-orchestrator 的注释），只是没写下来 —— 下一个读代码的人会想删它。
3. `plan` agent（agent.ts:294）仍从 `defaults` 继承 kb 写权限。提示词只要求 default + general，
   不算违约，但这是同型缺口。
4. `error instanceof ToolFailure`（grep/glob 的 mapError 守卫）跨包时不如判 `_tag` 稳；
   `artifact.test.ts` 用 `String(failureCause)).toContain("WorkArtifact.Conflict")` 是字符串断言。
5. `grep.ts` / `glob.ts` 在基线上过 Prettier、改后不过（新加的 realPath 行超 120 列），
   已 `prettier --write` 这两个文件修掉；`kb-service.ts` 与 `artifact.ts` 基线就脏，未动。

【S3/S4 经验补丁（后续批次遵守）】

1. **一个测试如果删掉被测守卫还能全绿，它就不是测试。** 交付前对每个新测试做一次反向验证：
   把它声称守着的那几行删掉，跑一遍，必须变红 —— 并把这次红贴进报告。
   S1 补丁 1 要求的是"门禁能看见多行形态"，这一条更基本：**测试必须调用被测代码**。
2. **提示词里的"既有原语可复用"是断言，不是事实**，先去 Service 的导出上核一眼。
   核不上就停下报告 —— 自带一把平行原语正是批次要消除的东西。
3. **`Layer.effectDiscard` 里的 effect 跑在 layer 构建期。** 任何扫描/轮询/等待都要
   `Effect.forkIn(scope)`，否则是在给启动路径加阻塞。
4. **修完之后回头看一眼自己新写的测试用的是哪个作用域/分支**，兜底如果没覆盖那个作用域，
   要在报告里点名（S4 三条测试全是 project，兜底只有 global）。

---

## S5 提示词：让门禁真的执行、且真的判行为（CI / 测试基础设施）

> **排期约束**：S5 必须排在 `v2-architecture-governance-slice-0-3.md` 与 `v2-ux-trust-foundation.md`
> 两个 worktree **开工之前**。两个理由：① 它改的是根级配置（`turbo.json`、`package.json`、
> `.github/workflows/`）与全仓格式化，会与任何在飞分支冲突；② 后续每一批的「红→绿证据」都要靠
> 这一层门禁独立背书 —— 在门禁不可信之前，验收等于自证。

```text
任务：S5 — 修「门禁声明了但不执行，或执行了但不判行为」这一个根因下的 8 处缺口
（根配置 + packages/{desktop,aigcfroge,app}，TDD 红→绿）。

【本批的红证长什么样（先读这段，它决定整批做法）】
这批没有"会失败的业务测试"可写。门禁类缺陷的判别式是 **种红**：
往一个 CI 声称会跑的地方塞一条**必定失败**的断言，然后跑门禁 ——
门禁仍然绿，就是红证。种完立刻还原，不许留在交付里。
这条方法直接来自 S4 的经验补丁 1（删掉被测守卫还能全绿的测试不是测试），
在门禁层的等价表述是：**种一个必失败的断言还能全绿的门禁不是门禁。**

【背景事实（2026-08-29 实测核实，行号以实际代码为准）】
A. `bun turbo test` 只跑 5 个包
- `turbo.json` 的 `tasks` 里只有 `aigcfroge#test` / `@aigcfroge/core#test` / `@aigcfroge/app#test`
  / `@aigcfroge/ui#test` / `@aigcfroge/session-ui#test` 五个 `#test` 任务，没有通用 `"test": {}`。
  `bunx turbo test --dry=json` 实测 18 个任务里只有这 5 个是 test。
- 于是 **desktop(57) · tui(211) · schema(159) · llm(308) · http-recorder(33) ·
  effect-drizzle-sqlite(7) = 775 个用例在 CI 从不执行**。六包本地 2026-08-29 全绿。
- `packages/desktop` **连 `test` script 都没有**：`bun --cwd packages/desktop test` 报
  `Script not found "test"`；跑它要 `cd packages/desktop && bun test --timeout 30000`。
- 直接后果：S2 修好的 `attachment-picker.test.ts` picker-token 跨 renderer 隔离断言
  （`attachment-picker.ts:20` 那道安全控制的唯一断言）本地跑、CI 不跑。

B. exerciser 的硬门禁不判行为
- `test/server/httpapi-exercise/routing.ts:37-39` 的 `coverageResult` **无条件**返回
  `{ status: "pass", scenario }`；`index.ts:3409-3410` 让 `--mode coverage` 走它。
  ⇒ coverage 模式**从不发出任何请求**，`.json(409, …)` 里的状态断言在该模式下不执行。
- 真判断言的 `--mode effect` 在 `.github/workflows/test.yml:86` 挂着
  `continue-on-error: true`，步骤名自述 "pre-existing runtime failures on main"。
- ⇒ `docs/testing.md` §3 列为硬门禁的那两条，实际保证的是「每条路由都有 scenario + 认证边界」，
  **不是**「响应状态与响应体正确」。
- **未复核项（必须自己重测，不要照抄）**：债表记录 effect 模式在 main 上有 3 条既有失败 ——
  `agent-asset.apply` / `session.workflow.run`（期望 202 实得 500）/ `session.task.get`，
  日期 2026-08-28。这个集合我这次没有重跑，你必须先跑一遍拿到当前真实集合。
- 另有两处「已注册但恒绿」的场景：workflow 的 `cancelRun`/`cancelStep`/`retryStep` 只注册了
  404 路径；`v2.permission.grant.list` 的 seed 从不签发 grant，断言恒在空列表上为真。

C. `packages/app/e2e` 不在 typecheck 项目内
- `packages/app/tsconfig.json` 的 `include` 是 `["src", "package.json"]`；
  `e2e/tsconfig.json` 从不被 `tsgo -b` 或 CI 执行。
- 今日实测 `bunx tsgo --noEmit -p e2e/tsconfig.json` = **恰好 29 个错误**，全为存量
  （S1 新增的 `markdown-sanitize.spec.ts` 贡献 0）。

D. 网络依赖与负载敏感把门禁变成随机数
- `test/server/httpapi-reference.test.ts:23/66/71` 真的把 `Effect-TS/effect` 克隆进
  `Global.Path.repos/github.com/...` 再 `pollWithTimeout` 等就绪 ⇒ 整个 `test/server/`
  门禁网络依赖，github.com 不通时以超时形式变红，失败现场（`test/lib/effect.ts` 的
  `orElse` 栈）看不出是网络问题。
- spawn 密集的 4 个文件在并行负载下集体 `TimeoutError`、空载单跑全绿：
  `test/project/instance-bootstrap.test.ts`、`test/cli/acp/initialize-auth.test.ts`、
  `test/cli/acp/skills.test.ts`、`test/cli/run/run-process.test.ts`。

E. Prettier 无门禁
- 全仓 **436** 个文件未过 `prettier --check`（`packages/**/*.{ts,tsx,css}` + `script/**` + `*.json`），
  其中 `packages/core/src` 106 个。`bun run lint` = `oxlint && lint-changed.ts &&
  check-unawaited-assertions.ts`，**不含 format 检查**；CLAUDE.md 明确「无 pre-commit hook」。
- 债表把这一条登记了两次（§3.2 与 §4），且计数会随每次改动漂移 —— 本批要合并成一条，
  并把「计数」换成「有无门禁」。
```

```text
【Phase A（红）】五组种红，每组都要贴出「门禁仍然绿」的原始输出，种完立刻还原：
1. 在 `packages/desktop/src/main/attachment-picker.test.ts` 里塞一条 `expect(1).toBe(2)`，
   跑 `bun turbo test` —— 必须仍然全绿。这就是 775 个用例不执行的红证。
   同样在 tui / schema / llm / http-recorder / effect-drizzle-sqlite 各塞一条，一次跑完，
   报告里给出「6 个包都塞了红、turbo test 依然 0 fail」。
2. 把某个 exerciser 场景的期望状态改成 `.json(599, …)`（一个不可能的状态码），
   跑 `--mode coverage` —— 必须仍然 PASS。这是 coverage 模式不发请求的红证。
3. 跑 `--mode effect` 拿到**当前真实**的失败集合，逐条列出（名字 + 期望 vs 实得）。
   不要引用债表里 2026-08-28 那三条，要给今天的数字。
4. 在 `packages/app/e2e/regression/` 任一 spec 里写一处必定报错的类型
   （如 `const x: number = "s"`），跑 `bun --cwd packages/app typecheck` 与 `bun turbo typecheck`
   —— 必须都绿。这是 e2e 不在 typecheck 项目内的红证。
5. 跑 `bunx prettier --check` 全仓拿到当前未过计数，再跑 `bun run lint` —— lint 必须绿。
   这是 format 无门禁的红证。

【Phase B（绿）】按下面的顺序做，顺序本身有依赖，不要重排：
1. **turbo test 补 6 包**（最便宜、且让 S2 的成果真正生效）：
   给 `packages/desktop/package.json` 加 `"test": "bun test --timeout 30000 --only-failures"`
   （照 tui/llm/http-recorder 的既有形式，不要自创）；`turbo.json` 补 6 个
   `@aigcfroge/<name>#test`，`dependsOn: ["^build"]` 与既有 5 条对齐。
   跑 `bunx turbo test --dry=json` 确认 test 任务从 5 变 11。
2. **exerciser 的 coverage 模式不再伪装成断言结果**：
   根因不是「coverage 模式漏了断言」，而是**它的产出形状撒谎** —— 它只知道「场景是否注册」，
   却报成 pass/fail。修法是让它输出覆盖率而不是通过状态（`routing.ts:37` 的 `coverageResult`
   改成不产出 `status:"pass"` 的形状，`report.ts` 相应区分「覆盖统计」与「行为结果」），
   **行为门禁一律由 `--mode effect` 承担**。
   **明确禁止**在 coverage 模式里补断言 —— 那是把两个语义塞回同一个模式，下次还会有人误读。
3. **修掉 effect 模式的既有失败，然后摘掉 `test.yml:86` 的 `continue-on-error: true`**。
   顺序不能反：先摘 flag 会让 CI 立刻红。若某条失败的根因超出 exerciser 本身
   （例如 `session.workflow.run` 的 500 来自 runner），**停下报告**，不要为了让门禁绿而
   弱化场景断言或把它移出 exerciser。
4. **补两处恒绿场景**：workflow 的 `cancelRun`/`cancelStep`/`retryStep` 各补 200/202 成功路径
   与一条 409 stale revision；`v2.permission.grant.list` 的 seed 先签发一个 grant 再断言投影字段，
   并补 HTTP 层 409（CAS miss）/404/400。
5. **e2e 进 typecheck**：修完那 29 个存量错误，把 `e2e` 纳入 `packages/app` 的 `tsgo -b`
   项目引用（或让 CI 显式跑 `-p e2e/tsconfig.json`）。29 条全是存量，逐条修，
   **不许用 `as any` / `@ts-ignore` 消灭它们** —— 那只是把类型缺口换个地方藏。
6. **网络依赖用例移出硬门禁**：`httpapi-reference.test.ts` 改用本地 fixture 仓库
   （`git init` 一个临时裸仓库再指过去），或把它标为 advisory 并从 `test/server/` 硬门禁里摘出。
   选哪种在代码注释里写清理由。
7. **spawn 敏感的 4 个文件**：给独立更宽的超时，或在 CI 中与重负载步骤串行化。
   两种都可以，但报告里要说明选择依据（不要两个都加）。
8. **Prettier**：本批内**两个独立提交** ——
   提交 A：`prettier --write` 全仓（format-only，零语义改动）；
   提交 B：`bun run lint` 链路加 `prettier --check`。
   两者必须同批（否则立刻再漂），但必须分提交（否则 400+ 文件的格式化会淹掉门禁改动）。
   同时把债表里重复登记的两条 Prettier 债合并成一条，措辞从「计数」改成「有无门禁」。

【Phase C（回归）】
bunx turbo test --dry=json（确认 11 个 test 任务）
bun turbo test（全量，这次真的会跑 775 个多出来的用例）
bun turbo typecheck
bun run lint（现在含 prettier --check）
bun --cwd packages/aigcfroge test test/server --timeout 30000（确认 reference 用例不再依赖网络）
cd packages/aigcfroge && bun run script/httpapi-exercise.ts --mode effect（必须 0 fail）
bun --cwd packages/app test:e2e（只跑受影响的 spec）
跑门禁时不要并行跑其他重任务 —— 本批第 7 项修的就是这个现象。

【验收】
- `bunx turbo test --dry=json` 的 test 任务从 5 变 11，且六包的种红实验能让 `bun turbo test` 变红
  （交付时把种红→变红的对照贴出来，这是本批唯一有意义的验收证据）
- `--mode coverage` 不再产出 pass/fail 形状；`--mode effect` 0 fail 且 `continue-on-error` 已摘
- 把 `.json(599)` 塞进任一场景，`--mode effect` 必须红（证明行为门禁真的在判）
- e2e 进入 typecheck，且在 spec 里种一个类型错误能让 `bun turbo typecheck` 变红
- `bun run lint` 含 prettier --check，且改坏一个文件的格式能让它变红
- `test/server/` 在断网环境下仍能全绿（拔网或设 `HTTPS_PROXY=http://127.0.0.1:1` 实测一次）

【显式不做（各自另立专项）】
- **e2e 矩阵（dark / zh|zht / 窄视口 / 键盘）**：实测 21 个 regression spec 里 dark 0、
  zh|zht 0、keyboard 1，`playwright.config.ts:43` 只有单个 chromium project。
  在 config 加 theme/locale/viewport project 会**一次照亮全部 21 个既有 spec**，
  需要配套的修复预算，量级不可预估 —— 塞进本批会让整批无法收口。
- 债表里 9 条明确「需产品裁定 / 需设计输入 / 需人类裁定」的条目（`timeoutSeconds` 缺省无超时、
  Credential 静态加密、未知 API 路径 404 还是 SPA、浏览器 auto-accept 通配键、
  markdown 远程资源 CSP 收窄、once grant 归属、960px 主列、`layout.tsx` Suspense fallback、
  `credential.active` 采纳还是删除）—— 这些要人先答，不要在批次里替人做决定。
- 54 处历史文档里的 `bun --cwd <pkg> run <script>`（改动量大收益低，已登记）。
- 全仓 legacy import 债（249 star + 123 alias，AGENTS.md 明确存量不迁移）。
```
