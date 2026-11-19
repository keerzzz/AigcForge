# 1899 条 lint 警告根因调查

2026-11-15，工作区 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`。本轮完成规则机制调查、代表性回放和可复现缺陷定位。

结论：1899 条是20个规则产生的语法诊断，混合了排版与表达偏好、规则对合法边界的过宽匹配，以及真实类型合同缺口。诊断数量不是独立缺陷数量。当前不能给出全部条目的误报率。

## fact：可执行观测

- 本轮运行 `./script/bun x oxlint --format json`，exit0，1899 warnings、0 errors、398文件；与上一轮按文件、规则、位置和消息逐项比较，新增0、删除0。见 [summary.json](/home/keer/.codex/outputs/2026-11-15/lint-root-cause/summary.json) 和 [warnings-current.json](/home/keer/.codex/outputs/2026-11-15/lint-root-cause/warnings-current.json)。
- 按路径分类：生产源码1080、测试722、脚本68、stories29。五包为App1143、SessionUI277、UI215、Desktop134、GUI extensions130；分类规则保存在 [scope-breakdown.json](/home/keer/.codex/outputs/2026-11-15/lint-root-cause/scope-breakdown.json)。
- 空行523、断言说明528，共1051条，占55.3%；加上 `no-runtime-typeof` 的283条，前三类共1334条，占70.2%。20个规则的决定机制均已检查，逐项业务语义尚未全部审核。
- [配置](/home/keer/workspace/aigcfroge-v2/.oxlintrc.json:27)将规则限定五个GUI包并设为warn；[安装说明](/home/keer/workspace/aigcfroge-v2/script/oxlint/anti-slop/UPSTREAM.md:17)明确逐包清理存量。完整lint允许警告，而 [lint-changed.ts](/home/keer/workspace/aigcfroge-v2/script/lint-changed.ts:41)将所选变更文件中的任意诊断转为exit1；文件选择由第19行决定，扫描范围是整文件。

### 排版与断言说明：1051条

[空行规则](/home/keer/workspace/aigcfroge-v2/script/oxlint/anti-slop/rules/require-readable-spacing.ts:5)按语法边界要求空行。复制实际 `selection.test.ts` 和 `profile-by-source.ts` 到仓外，原规则 `--fix` 消除207条；非空白字节相等，第二次修复字节不变。该实验解释排版警告，不能授予功能安全状态。

[checkAssertion](/home/keer/workspace/aigcfroge-v2/script/oxlint/anti-slop/rules/require-safety-comment-for-type-assertion.ts:112)除 `as const` 外寻找 `SAFETY:` 注释，不验证被断言值。可执行fixture中合法的null、空数组、字符串断言均报警，类型检查通过；带注释的JSON解析断言可以不报警。528条包含合法初始化、边界强转和嵌套断言的重复计数，不能靠批量添加注释判断安全。详见 [排版与断言回放](/home/keer/.codex/outputs/2026-11-15/provider-warning-rca/spacing-assertion-rca.md)；fixture首次重名失败及修后通过均保留。

### 类型与边界规则：603条

- `no-runtime-typeof` 283条：[visitor](/home/keer/workspace/aigcfroge-v2/script/oxlint/anti-slop/rules/no-runtime-typeof.ts:60)没有业务来源分析，默认也报告完整类型谓词。
- `no-known-value-widening` 110条：[reportFlow](/home/keer/workspace/aigcfroge-v2/script/oxlint/anti-slop/rules/no-known-value-widening.ts:277)经匿名对象分类命中精确的light/dark返回类型；该命中不能证明类型信息丢失。
- `no-unknown-parameters` 93条：[checkParameters](/home/keer/workspace/aigcfroge-v2/script/oxlint/anti-slop/rules/no-unknown-parameters.ts:41)豁免名称为cause的参数，实际Promise catch的error参数仍会报警，命名会改变判定而不改变边界语义。
- `no-unsafe-dictionary-type` 87条：[shouldReportType](/home/keer/workspace/aigcfroge-v2/script/oxlint/anti-slop/rules/no-unsafe-dictionary-type.ts:91)识别unknown等值类型，不能判定通用序列化层之后是否有owning codec。
- `no-unknown-returns` 30条：[checkReturnType](/home/keer/workspace/aigcfroge-v2/script/oxlint/anti-slop/rules/no-unknown-returns.ts:56)也命中只等待完成、不消费返回值的回调；可精确化完成合同，但不等于已发现运行故障。

代表性样本和消费路径见 [边界规则报告](/home/keer/.codex/outputs/2026-11-15/lint-root-cause/boundary-review.md)。这些样本证明规则存在过宽匹配，不能外推成603条全部误报。

### 其余规则：245条

条件spread84、shape命名38、Effect Match25，共147条主要检查表达形式；字段省略与Match的规范修订已在原账本登记。双重断言44需要按实际adapter/setter合同复核。手写标签9条全部在测试夹具，服务构造器导入3条按makeX名称匹配，实际调用仍处于Effect generator。

filter/map30条是遍历候选；菜单的2次slice与1次spread来自同一插入函数，确有反复复制列表，实际耗时未测。CDP object参数2条可复用协议类型收紧；MediaValue的1条是冗余命名。唯一Reflect.get属于Proxy receiver转发，可执行对照证明直接属性访问会改变getter行为。完整13规则决定函数及样例见 [其余规则报告](/home/keer/.codex/outputs/2026-11-15/lint-root-cause/remainder-review.md) 和 [receiver对照](/home/keer/.codex/outputs/2026-11-15/lint-root-cause/remainder-probe.json)。

### 已复现的真实错误展示缺口

修复前，两个命名错误的浅检查只验证名称及 data 是对象，消费者随后对未验证字段调用 trim。原始输入与抛错记录见下方复现日志。

对真实导出的formatServerError调用两个畸形输入：模型错误的data为空对象、配置错误的message为数字42，均抛TypeError；字符串及原生Error两个对照正常返回。根智能体复跑同样结果，见 [boundary-probe-verified.log](/home/keer/.codex/outputs/2026-11-15/lint-root-cause/boundary-probe-verified.log)。probe exit0表示修复前成功复现预期抛错。

既有errors.test.ts定向运行13 pass、0 fail、15 expects；没有覆盖上述畸形输入。一次误触发的App整包测试为807 pass、1 fail、2387 expects，失败是normalizeAgentList夹具缺少当前输出字段，见 [原始失败日志](/home/keer/.codex/outputs/2026-11-15/lint-root-cause/errors-existing-tests.log)。该失败与畸形错误展示分别记录。

## hypothesis：候选原因

H1：现有GUI代码与语法排版、断言说明规则的风格不一致。若为真，空白修复即可消除一部分诊断，合法初始化仍可能命中断言规则。

H2：部分规则使用语法或名称代理业务安全性，缺少输入来源、消费方式和协议语义。若为真，完整类型谓词、错误catch、wire fixture、字段省略和receiver转发会同时报警。

H3：少数边界把浅检查升级成强类型承诺。若为真，满足浅检查的畸形输入会在内部字段操作再次抛错。

## inference：证据连接

H1由207条空白修复回放和合法断言fixture支持。H2由具体规则决定函数与消费者、receiver差分支持。H3由真实formatServerError的两个畸形输入复现支持。这三个来源共同解释警告构成；不存在把全部诊断归为代码缺陷或规则错误的证据。

警告存量还与门禁语义有关：普通lint保留warn，变更检查针对整文件拒绝诊断。区别由配置和第41行退出条件直接决定，不能用一次完整check通过表示告警已清偿。

## recommendation：按收益和证据处理

1. 已修复 formatServerError 原边界：复用 Schema 在入口验证消费者实际需要的字段，畸形命名错误回退为可读错误。既有错误测试表扩展后 18 pass、0 fail、20 expects，定向 lint 0 条诊断；见 [修复验收](/home/keer/.codex/outputs/2026-11-16/ui-attempt-context-fix/error-boundary-final-v1/acceptance.json) 与 [Schema 入口](/home/keer/workspace/aigcfroge-v2/packages/app/src/runtime/server/errors.ts:23)。
2. 以已验证样例修订过宽规则，保留实际边界校验和wire/Proxy语义。按规则归属维护，无需统一关闭插件或新增通用豁免框架。
3. 523条排版可单独复用现有fix；断言优先区分合法初始化、已有证明的适配和未知外部值。注释记录真实不变量。
4. 其余合同和性能候选按owner处理；菜单优化先测实际规模及耗时，未测前不宣称性能提升。App夹具失败单独沿normalizeAgentList合同修订。

简单实现继续复用现有规则、Schema、测试与账本；新增统一规则豁免或边界框架没有两个已验证用例支撑。技术债为尚未逐项判定的诊断及夹具漂移，owner与解除条件见 [技术债账本](/home/keer/workspace/aigcfroge-v2/docs/technical-debt.md)。

## 工作树清理状态

536个变更路径在目标工作区均存在；527个字节和执行位相同，2个文档是目标侧后续更新，7个仅执行位不同。原273任务文件在源工作树均匹配最终交付哈希；比较关系由 [compare_files](/home/keer/.codex/outputs/2026-11-15/provider-worktree-cleanup/preflight-verification.py:27)决定，见 [preflight-verification.json](/home/keer/.codex/outputs/2026-11-15/provider-worktree-cleanup/preflight-verification.json)。

已保存源码、暂存状态、补丁、独有Effect参考仓库和Web产物；备份逐项核对16754项，缺失0、不匹配0，见 [backup-manifest.json](/home/keer/.codex/outputs/2026-11-15/provider-worktree-cleanup/backup-manifest.json)。Desktop产物已在仓外，当前窗口及Source不依赖待清理目录。

清理未完成：attach_worktree返回 `This worktree is owned by another task.`；原聊天仍持有该工作树，现有工具无法接管。当前保留原目录及分支，待应用解除原聊天的工作区归属后，通过受支持的归档操作移除。
