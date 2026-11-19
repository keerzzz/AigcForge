# MC05 同小节修复：后加入参与者的失败结算

2026-11-05。原MC05工程与真实运行结果保持；本任务处理该真实运行暴露的内部协作恢复缺口。MC04a已完整接受，不重验。工作区仍为`/home/keer/workspace/aigcfroge-v2`、`v2-dev@9e2c6577ef6dd65c8f01ff94d46da0142bcb877c`，全部WIP保护。

## 事实与范围

原库`mc05-internal-bht4jbnh`只读发现General child已failed，但delivery/turn仍running、父Task仍in_progress；BackgroundJob持久错误为`Invalid delegation transition from approved to failed`。首个Build成功使Delegation approved；新增General后completion barrier不满足。`packages/core/src/delegation/fold.ts:275`选择回到running，`state.ts:12`却不允许；后续`fold.ts:745`失败转换随之被拒绝。`execution.ts:841`又按仍running的delivery拒绝retry。

目的：后加入内部参与者使原已approved但未关闭的Delegation重新反映未完成工作；真实失败可由原settle/recover记录，显式retry仍沿原来源和attempt机制。不得重播成功Build、伪造原前台Tool成功或改写旧库。原prompt的失败停止指令、前台父Task的既有通知语义及真实续接预算仍须单独明确。

## 文件与阶段

- `/root/mc05_resume_prepare`只写`packages/core/test/delegation-execution.test.ts`：复用既有setup/真实Service/Execution/TestLLM，增加先成功再加第二participant后失败的keeper，证明首个成功保持；必要时核正式retry的后继结果。不复制fold算法、不改共享fixture、不运行命令。
- Root是`packages/core/src/delegation/state.ts`唯一写者：可信RED后，只补使现有deriveApprovalStatus生效的必要合法转换。不直接新增approved到failed，不修改closed/terminal限制。
- Root独占测试、typecheck与格式/lint槽；其它源码、fold/service/execution、Schema/Protocol/Server/Client、现有Native包、原DB/ledger/stop均保护。确需增加文件必须先补具体理由与归属。

修改前逐文件字节见[分配与baseline](/home/keer/.codex/outputs/2026-11-05/mc04a-mc05-engineering-v1/mc05/recovery-state-repair-v1/allocation.json)。本任务是原MC05新暴露失败的追加修复，不否定旧两文件限定keeper已经通过。

## 验证与退出

先运行新增named keeper记录实际RED，再修复；必要受影响验证为Core delegation execution/state/fold三个既有测试文件及Core typecheck。命令由Root用`script/bun run --cwd=packages/core test --timeout 30000`及包typecheck执行；不裸bun test、不全仓重跑。原失败和后继green分账。只读原事件回放可说明修后解释，不能称原DB已恢复或原模型链已完成。

方案比较：复用现有fold状态推导并补必要转换，修改面小且继续使用原恢复owner。另建恢复Driver、手改delivery/Task或直接允许任意approved失败都会增加第二规则，拒绝采用。实际技术边界是前台已中断Tool不会被历史改写；同Session后续模型消费仍需正式指令/恢复方案，不能凭此keeper宣布四请求计划可执行。

工程冻结交监督侧原必要差异复核；不另建评审链。尚无新Native/retry授权，预算仍physical3/7、Source准入4/7、Native1/1；MC05Complete=false、MC06ProductionUnlocked=false。未交付状态归原技术债账本及原Root/Delegation/Task/Meta owner。

## 工程签收

[监督Root接受](/home/keer/.codex/outputs/2026-11-05/mc04a-mc05-engineering-v1/review/supervisor-root-mc05-recovery-state-acceptance.json)已确认state.ts与keeper冻结字节、RED0/1/2、focused1/0/23、受影响57/0/426及Core类型/格式/限定lint/diff结果。原12事件的pure-fold只读解释可回到running；旧DB投影仍approved，未reconcile。原Tool失败事实不因本修复改写。

后续仅按[新七请求完整包](/home/keer/.codex/outputs/2026-11-05/mc04a-mc05-engineering-v1/mc05/full-native-candidate-v2/root-runtime-freeze-handoff-v1.json)准备原场景重验，弃用四请求操作方转交与五请求绕过守卫方案。修复本身已接受，无须重开独审或重跑绿组；新provider/Native未获批准，MC05原退出和MC06依赖仍开放。
