# **OpenAI Codex Harness 架构设计与开源生态深度调研报告**

## **核心定位与技术范式演进**

在大语言模型驱动的软件工程体系中，自主智能体的效能瓶颈已逐渐从单一的模型单轮推理能力，转移到外层运行时的编排精度与系统控制力1。OpenAI 将现代化智能体架构解构为清晰的三元模型：![][image1]2。在此体系中，Model 专注于符号逻辑与代码生成，Surfaces 覆盖终端、集成开发环境（IDE）与云端仪表盘等交互形态，而作为核心中间件的 Harness（执行套件），则统一接管状态机持久化、上下文生命周期修剪、多平台系统级沙箱隔离、确定性工具执行以及人机协同（Human-in-the-Loop, HITL）审批流1。  
OpenAI 将 Codex Harness 核心执行引擎以 Apache-2.0 协议开源，标志着软件工程方法论由依赖经验性提示的“Prompt Engineering”向依赖确定性运行时的“Harness Engineering”实质性转变1。从模型演进视角审视，先进代码模型并非孤立训练，而是在 Harness 所定义的工具交互和沙箱验证循环中联合优化而成，二者形成了互为约束、协同演进的共生结构2。这种软硬件与运行时协同的设计在基准测试中展现出显著优势：在 ARC-AGI-3 复杂基准评估中，在完全不改变底层 GPT-5.6 Sol 权重的条件下，仅通过 Harness 引入保留推理（Retained Reasoning）与上下文动态压缩（Context Compaction）机制，模型得分便从 13.3% 大幅提升至 38.3%，并将端到端 Token 消耗压缩至原先的六分之一1。

| 评估维度           | 传统无状态 Prompt 驱动模式                                        | 现代化 Codex Harness 架构模式                                          |
| :----------------- | :---------------------------------------------------------------- | :--------------------------------------------------------------------- |
| **会话状态管理**   | 基于 HTTP 单轮无状态请求，多轮交互需全量重传历史上下文9           | 基于 WebSocket / JSON-RPC 维护有状态线程，仅增量流式同步变更9          |
| **环境安全隔离**   | 依赖外部单体容器或无隔离宿主环境，缺乏细粒度行为拦截11            | 内核级原生沙箱（macOS Seatbelt、Linux Bubblewrap、Windows 专有令牌）10 |
| **上下文预算分配** | 静态载入所有上下文与工具描述，极易引发上下文窗口饱和与注意力衰减9 | 实施技能 2% 窗口硬限制截断、延迟工具检索（Tool Search）与动态压缩9     |
| **越权审批与治理** | 静态规则阻断或频繁弹窗阻塞用户，易导致人工审批疲劳9               | 内置只读 Auto-Review 审查子代理评估风险并实现自治放行9                 |
| **开源交付形态**   | 闭源专有云端黑盒 API1                                             | Apache-2.0 / MIT 双开源架构，支持企业本地化与私有云部署4               |

## **系统架构与 Rust 运行时实现机制**

Codex Harness 的底层工程实现采用 Rust 构建高性能运行时核心（codex-rs），外部辅以轻量级 TypeScript 封装（codex-cli）实现跨平台分发与快速引导13。其整体架构由 60 余个解耦的 Crate 构成，自底向上构建起清晰的执行层次：顶层交互界面层（Surfaces）承接 CLI、TUI 或 IDE 的用户意图，经由 JSON-RPC 2.0 协议注入中间集成层（codex-app-server），核心逻辑层（codex-core）负责驱动模型推理与任务规划，最终将文件读写与命令执行分派给底层操作系统沙箱引擎与开放的 Responses API 接口1。

| 核心 Crate 名称  | 代码物理路径 | 核心设计职责与底层依赖技术                                                                          |
| :--------------- | :----------- | :-------------------------------------------------------------------------------------------------- |
| codex-core       | core/        | 状态机中枢，封装 ThreadManager、模型客户端调用、工具调度、上下文生命周期与 apply_patch 补丁逻辑13。 |
| codex-app-server | app-server/  | 提供符合 JSON-RPC 2.0 规范的通信服务，支持 stdio、Unix Socket 与 WebSocket 传输协议1。              |
| codex-cli        | cli/         | 顶级命令行分发器，管理参数解析、子命令路由及功能开关配置13。                                        |
| codex-tui        | tui/         | 基于 Ratatui 与 Crossterm 构建的纯终端交互界面，集成 Tree-sitter 语法高亮与剪贴板图像流式载入13。   |
| codex-exec       | exec/        | 面向 CI/CD 与批处理场景的无头非交互式执行器，支持标准输出重定向与结构化 JSON Lines 事件捕获1。      |
| codex-mcp        | codex-mcp/   | Model Context Protocol（MCP）客户端实现，基于 rmcp 管理外部工具进程派生与 OAuth 鉴权生命周期13。    |
| codex-config     | config/      | 多层级配置解析与合并引擎，负责处理系统默认、项目本地、用户全局及 CLI 覆盖参数13。                   |

在通信协议层面，随着专用推理硬件使得模型生成速率突破每秒 1,000 Token，传统的无状态 HTTP 与 Server-Sent Events（SSE）传输链路成为系统瓶颈9。Codex Harness 彻底重构了网络传输层，采用全双工 WebSocket 建立长连接，使得会话轮次仅需增量回传工具调用结果与状态差分，大幅减轻了网络传输对高频交互的拖累9。同时，Harness 处于双重开放协议之间：北向面向各类宿主应用暴露标准化的 App Server JSON-RPC 协议（包含生命周期握手、会话启动、轮次推进及流式通知），南向通过由 OpenAI、Nvidia、Ollama 及 LM Studio 共同治理的开放 Responses API 规范与底层模型进行流式交互，确保了技术架构在多厂商生态中的互操作性1。

## **上下文生命周期管理与长程执行策略**

在复杂单体仓库与跨模块工程任务中，智能体极易因冗余的日志输出、巨量文件列表扫描及重复的探索过程而发生上下文污染与注意力涣散18。Codex Harness 放弃了全量上下文静态装载的策略，转而构建了一套确定性与按需动态检索相结合的上下文预算调控机制9。  
为了防止 MCP 工具与扩展技能无限膨胀并侵占推理有效载荷，Harness 实施了严格的技能上限控制：可用技能描述所消耗的 Token 被硬性限制在当前模型最大上下文窗口的 2% 以内，一旦超出阈值，系统将自动对低频技能的元数据进行渐进式摘要与截断9。在此基础上，Harness 引入了延迟工具（Deferred Tools）与工具搜索（Tool Search）机制，非核心工具在初始阶段并不挂载至提示词上下文，而是以索引形式暂存，仅在模型执行到特定阶段主动调用检索工具时，才动态将目标工具的定义载入执行环境，实现了工具集的按需即时展开9。  
在长程多轮会话的流转过程中，Harness 的压缩算法（Compaction）自动将过往轮次的工具调用明细、临时调试日志与环境输出聚类为高信息密度的结构化摘要，同时保留关键架构决策与断言结果（Retained Reasoning），确保长程任务在经过数十轮交互后仍能维持稳定的逻辑连贯性1。  
对于项目级规范的注入，Codex Harness 建立了确定性的配置发现与解析流水线。系统启动时自当前工作目录向上递归查找 AGENTS.md（或配置的备用文件名如 CLAUDE.md），并通过 project_doc_max_bytes（默认限制 32 KiB）施加强制截断，避免无效规范撑爆上下文20。配置系统严格遵循分层覆盖机制，即“系统默认 ![][image2] 全局配置（\~/.codex/config.toml）![][image2] 项目配置（.codex/config.toml）![][image2] CLI 参数”，且项目级配置必须在用户显式确认项目信任后方能激活，在保证项目规则灵活性的同时杜绝了未授权的隐式配置篡改11。

## **操作系统级原生沙箱与自治安全治理**

针对代码生成与命令执行的安全风险，Codex Harness 确立了“将安全防线锚定于操作系统内核”的设计哲学11。其核心逻辑在于，模型层面的拒绝执行仅属于概率性对齐，容易受到提示词注入等对抗攻击的绕过，而操作系统级的沙箱拦截则是确定性的强安全保障11。

| 操作系统平台     | 沙箱底层核心隔离机制                      | 关键技术实现与安全特性                                                                                                                                      |
| :--------------- | :---------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **macOS**        | Apple Seatbelt (sandbox-exec)             | 基于内核扩展拦截非法系统调用，限制进程对工作区外文件系统的读写与网络绑定；需预先静态展开通配符以防快照失效10。                                              |
| **Linux / WSL2** | Bubblewrap (bwrap) \+ Landlock \+ Seccomp | 利用非特权用户命名空间隔离文件系统挂载点，配合 Landlock LSM 控制访问路径，结合 Seccomp 实施底层网络系统调用过滤11。                                         |
| **Windows**      | 专有四层令牌隔离架构（Custom Sandbox）    | 自研 codex.exe ![][image2] setup.exe ![][image2] command-runner.exe ![][image2] 目标子进程四层架构，绕过传统 Windows Sandbox 无法无缝对接本地目录的局限10。 |

在缺乏原生轻量级单进程隔离机制的 Windows 环境下，OpenAI 自主研发了基于 NT 安全子系统的沙箱方案10。该方案首先为沙箱环境动态生成专用合成安全标识符（Synthetic SID），在文件系统访问控制列表（ACL）层面对每一次写操作实施双重鉴权：既要求宿主用户具备相应权限，又必须满足限制性 SID 的写入许可22。随后，利用 Win32 API CreateRestrictedToken 剥离高危权限，通过 CreateProcessAsUserW 派生受限子进程24。在网络隔离方面，系统创建了由 Windows 数据保护接口（DPAPI）加密的隔离用户域，并在 Windows 高级防火墙层面针对离线执行环境施加底层出站流量阻断，兼顾了安全性与本地工程文件的读写流畅度22。  
在权限管理维度，Codex Harness 预设了三种隔离模式：read-only 模式严格禁止写操作与网络交互；workspace-write 作为生产推荐的默认模式，允许在当前工作区及其配置的白名单路径内读写，但系统会自动将 .git/ 内部钩子与 .codex/ 配置目录锁定为只读子路径，防止智能体破坏版本控制或实施权限提升；danger-full-access 模式则彻底移除所有隔离屏障，仅限在一次性沙箱容器中运行1。  
为了解决长周期自主开发中高频人机交互审批导致的“审批疲劳”问题，Codex Harness 引入了自治审查机制9。当主执行智能体尝试触发沙箱权限升级（例如修改工作区外部文件或请求外部网络资源）时，Harness 会自动派生一个只读运行且被剥夺子代理派生能力的 **Auto-Review 审查子代理**9。该审查子代理结合当前会话的上下文记录、用户原始指令意图及预设风险分类学进行综合裁决：对于逻辑自洽且符合用户授权意图的操作实施自治批准放行，仅在检测到越权操作或破坏性行为时才向终端用户发起阻塞式人工确认，从而在安全审查与开发流畅度之间取得了平衡9。

## **多层级接入模型与开源社区生态扩展**

Codex Harness 提供了覆盖从自动化脚本到深度 IDE 集成的阶梯式接入方案，使不同开发场景均能获得标准化的运行时支撑1。对于一次性检查、CI/CD 门禁与代码审查任务，开发者可通过 codex exec 以无头非交互模式运行，并利用标准输入管道与结构化 JSON 事件输出无缝对接现有流水线1。对于需要以编程方式编排会话的应用系统，官方提供了支持 TypeScript 与 Python 的 SDK（@openai/codex-sdk 与 openai-codex），提供强类型的会话生命周期控制1。而对于需要深度嵌入宿主软件的产品，codex app-server 则通过 WebSocket 或 Unix Socket 维持常驻守护进程，提供双向事件多路复用、执行动态打断、MCP 工具按需挂载及定制化审批注入等全套控制能力1。  
依托清晰的协议规范与开源架构，围绕 Codex Harness 已迅速发展出覆盖全栈开发、治理审计与多智能体协作的生态体系18。

| 生态开源项目                                      | 技术实现路径与集成机制                                                                                                        | 核心解决痛点与典型适用场景                                             |
| :------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------- |
| **Vercel AI SDK** (@ai-sdk/harness-codex)         | 通过 @openai/codex-sdk 在隔离环境（如 Vercel Sandbox）内运行 WebSocket 桥接器，将底层事件流转换为前端 HarnessAgent 数据流25。 | 云端无服务器环境中的动态沙箱代码执行与全栈 Agent 快速搭建25。          |
| **VS Code Agent Harnesses**                       | 深度集成于 VS Code 会话目标体系，支持在本地工作区或隔离的 Git Worktree 中无缝切换 Claude、Copilot 与 Codex 运行时27。         | 多智能体无缝切换、环境隔离开发与会话上下文状态传递（Handoff）27。      |
| **OpenClaw Codex Plugin** (@openclaw/codex)       | 嵌入 codex app-server，自动将工作区规范（AGENTS.md、SOUL.md、TOOLS.md 等）动态注入至线程指令集20。                            | 将企业级智能体运行平台无缝迁移到底层 Codex Harness 执行栈上28。        |
| **Codex Harness MCP** (chapzin/codex-harness-mcp) | 引入契约式工作流（Contracts）、持久化 RAG 记忆库与本地治理审计策略（PASS/FLAG/BLOCK 评估门禁）18。                            | 治理长程任务中的静默失败、证据丢失、无约束上下文膨胀与虚假完工声明18。 |
| **Ralph Harness** (yoshpy-dev/ralph)              | 提供确定性生命周期钩子（Deterministic Hooks）、证据链代码审查及多 Worktree 自治并行执行引擎（Ralph Loop）26。                 | 跨 Claude Code 与 Codex 的标准化开发脚手架与自动化团队并行编码26。     |
| **My-Codex** (sehoon787/my-codex)                 | 构建“Boss”元编排器，整合 17+ 专用智能体专家角色与 123 项预设技能，实现动态运行时意图分发与四阶段 QA 校验29。                  | 复杂软件工程中架构设计、代码实现、安全审查与缺陷诊断的多角色分工29。   |
| **Codex Harness Handbook** (Trhova/Codex_harness) | 结合 RTK（Rust Tooling Kit）与 Graphify 代码知识图谱，通过代码拓扑摘要大幅降低初次扫描的 Token 消耗19。                       | 超大型代码仓库的低噪声上下文注入与可逆式架构变更实验19。               |

## **结论**

对 OpenAI Codex Harness 架构机制与开源生态的综合调研表明，自主编码智能体的工业化落地重心已全面转向运行时基础设施的工程化建设1。Codex Harness 通过三项关键架构决策建立了其在智能体运行时领域的技术壁垒：  
首先，在安全架构上，Harness 彻底摒弃了脆弱的应用层字符过滤与盲目的用户审批，通过 macOS Seatbelt、Linux Bubblewrap 以及 Windows 定制化限制性令牌机制，将执行边界下沉至操作系统内核，辅以只读 Auto-Review 子代理化解审批疲劳，实现了兼具确定性与流畅度的本地执行环境10。  
其次，在能效与状态管理上，Harness 依托全双工 WebSocket 传输、2% 技能上限截断、延迟工具按需检索（Tool Search）以及动态上下文压缩算法，成功解决了长程复杂任务中的上下文退化与注意力分散难题，在成倍降低 Token 消耗的同时显著提升了任务求解的准确率1。  
最后，在生态扩展性上，Harness 采用双协议解耦设计，北向开放基于 JSON-RPC 的 App Server 协议以赋能多样化前端宿主，南向协同多厂商标准化的 Responses API 规范，使企业与开发者既能直接复用工业级的高性能执行回路，又能对自身的交互界面、数据安全策略与领域工具链保持完全的自主控制权1。对于寻求构建高可靠自主编程智能体或在复杂企业环境中落地 AgentOps 的工程团队而言，基于 Codex Harness 及其开源标准进行扩展与定制，已构成兼具工程确定性与演进前瞻性的技术选型基准1。

#### **引用的著作**

> 1. Codex as a platform: build on the open agent harness, [https://developers.openai.com/blog/codex-as-a-platform](https://developers.openai.com/blog/codex-as-a-platform)
> 2. How I think about Codex \- Simon Willison's Weblog, [https://simonwillison.net/2026/Feb/22/how-i-think-about-codex/](https://simonwillison.net/2026/Feb/22/how-i-think-about-codex/)
> 3. What Codex Is Missing: It's the Harness, Not the Model \#18940, [https://github.com/openai/codex/issues/18940](https://github.com/openai/codex/issues/18940)
> 4. OpenAI Open-Sources Codex Harness: What It Means for Enterprise, [https://www.eneralabs.com/blog/openai-codex-harness-open-source-enterprise-2026/](https://www.eneralabs.com/blog/openai-codex-harness-open-source-enterprise-2026/)
> 5. OpenAI Open Sources Codex Harness Framework, [https://www.opensourceforu.com/2026/08/openai-open-sources-codex-harness/](https://www.opensourceforu.com/2026/08/openai-open-sources-codex-harness/)
> 6. OpenAIが実践するAgent-First時代の開発アプローチ — Harness, [https://zenn.dev/jiro526/articles/harness-engineering](https://zenn.dev/jiro526/articles/harness-engineering)
> 7. OpenAI {bot} (@openaibot.bsky.social) — Bluesky, [https://bsky.app/profile/openaibot.bsky.social](https://bsky.app/profile/openaibot.bsky.social)
> 8. Don't limit Codex to an AI coding app. Viewing it as an agent ... \- note, [https://note.com/gtminami/n/n2a03866ff9fa?hl=en](https://note.com/gtminami/n/n2a03866ff9fa?hl=en)
> 9. Codex, Behind the Harness — Dominik Kundel, OpenAI \- YouTube, [https://www.youtube.com/watch?v=shRR1e2HXMk](https://www.youtube.com/watch?v=shRR1e2HXMk)
> 10. Dominik Kundel: The Codex Harness Is OpenAI's Open-Source, [https://finance.biggo.com/news/24adf3fd195fb798](https://finance.biggo.com/news/24adf3fd195fb798)
> 11. OpenAI Codex .codexignore: How to Block Sensitive Files, [https://www.qwe.edu.pl/tutorial/openai-codex-exclude-sensitive-files/](https://www.qwe.edu.pl/tutorial/openai-codex-exclude-sensitive-files/)
> 12. AIエージェントを安全に動かすための技術——サンドボックス, [https://zenn.dev/layerx/articles/a99cd11af487fc](https://zenn.dev/layerx/articles/a99cd11af487fc)
> 13. openai/codex \- DeepWiki, [https://deepwiki.com/openai/codex](https://deepwiki.com/openai/codex)
> 14. OpenAI Codex CLI \-- Sandbox Analysis Report | Agent Safehouse, [https://agent-safehouse.dev/docs/agent-investigations/codex](https://agent-safehouse.dev/docs/agent-investigations/codex)
> 15. OpenAI Codex CLI: Terminal AI Coding Agent (Open Source), [https://openapps.pro/apps/openai-codex](https://openapps.pro/apps/openai-codex)
> 16. codex-codes \- crates.io: Rust Package Registry, [https://crates.io/crates/codex-codes](https://crates.io/crates/codex-codes)
> 17. codexにcodexの徹底解説をしてもらった \- Zenn, [https://zenn.dev/dokusy/articles/99af2fae0f1291](https://zenn.dev/dokusy/articles/99af2fae0f1291)
> 18. Local Codex MCP harness: contracts, persistent RAG ... \- GitHub, [https://github.com/chapzin/codex-harness-mcp](https://github.com/chapzin/codex-harness-mcp)
> 19. Practical Codex guide and reversible RTK \+ Graphify harness for, [https://github.com/Trhova/Codex_harness](https://github.com/Trhova/Codex_harness)
> 20. Codex harness system prompt does not include SOUL.md \#76273, [https://github.com/openclaw/openclaw/issues/76273](https://github.com/openclaw/openclaw/issues/76273)
> 21. AGENTS.mdでリポジトリに規律を与える｜OpenAI Codex ... \- Zenn, [https://zenn.dev/zapabob/books/openai-codex-design-book/viewer/agents-md-design](https://zenn.dev/zapabob/books/openai-codex-design-book/viewer/agents-md-design)
> 22. Why is Codex so amazing?｜えんぞう \- note, [https://note.com/en2enzo/n/n9a497f195100?hl=en](https://note.com/en2enzo/n/n9a497f195100?hl=en)
> 23. awesome-architecture/en/templates/codex/README.md at main, [https://github.com/study8677/awesome-architecture/blob/main/en/templates/codex/README.md](https://github.com/study8677/awesome-architecture/blob/main/en/templates/codex/README.md)
> 24. OpenAI Codex が Windows 向けサンドボックスを自社実装, [https://liberators.co.jp/building-codex-windows-sandbox/](https://liberators.co.jp/building-codex-windows-sandbox/)
> 25. Codex Harness \- AI SDK, [https://ai-sdk.dev/providers/ai-sdk-harnesses/codex](https://ai-sdk.dev/providers/ai-sdk-harnesses/codex)
> 26. yoshpy-dev/ralph: Claude Code \+ Codex harness engineering, [https://github.com/yoshpy-dev/ralph](https://github.com/yoshpy-dev/ralph)
> 27. Choose and use an agent harness \- Visual Studio Code, [https://code.visualstudio.com/docs/agents/run/agent-harnesses](https://code.visualstudio.com/docs/agents/run/agent-harnesses)
> 28. Codex harness \- OpenClaw Docs, [https://docs.openclaw.ai/plugins/codex-harness](https://docs.openclaw.ai/plugins/codex-harness)
> 29. GitHub \- sehoon787/my-codex: All-in-one agent harness for OpenAI, [https://github.com/sehoon787/my-codex](https://github.com/sehoon787/my-codex)
> 30. Shocking, OpenAI has fully open-sourced Codex Harness \- 36氪, [https://eu.36kr.com/en/p/3948952877661575](https://eu.36kr.com/en/p/3948952877661575)

[image1]: data:image/png;base64,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
[image2]: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAAWCAYAAADNX8xBAAAAa0lEQVR4XmNgGAWjgGQQgC5ALtgAxILoguQAFyCuQBckF/QAsRW6IDmAGYhXAnElELPCBBcC8W4y8AUgfgfEiQwUAFEgXg/EYugSpAAmIN4KxJLoEqSCYCCORhckB4C8BA9gSoAeusAoIAwAoNMTN4QjjlsAAAAASUVORK5CYII=
