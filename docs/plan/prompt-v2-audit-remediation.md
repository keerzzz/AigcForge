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



