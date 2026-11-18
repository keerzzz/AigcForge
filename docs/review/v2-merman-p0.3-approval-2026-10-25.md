# P0.3 Merman Claude / 固定上游 V2 限定审批

批准冻结G的Merman路由子范围。主智能体按用户授权于2026-10-25 18:30:50 UTC完成审批；[机器记录](evidence/v2-desktop-p0.3-2026-10-25/protocol-approval-merman-g.json)锁定routing b3a764…、layout7cf26b…、固定上游46172108…及[独立复审](evidence/v2-desktop-p0.3-2026-10-25/merman-routing-candidate-g-review.md)。P0.3整项与最终CLI/Desktop/native PTY产物尚未验收。

完整Merman实测505 pass / 0 fail / 23929 expect，15 snapshots、23 files；317来源/321次审计为0结构违规，33.196s<35s、bends p95=11、routeLength p95=361、crossings34/max2，原预算、所有golden与后续代表family确定性断言通过。单包typecheck与两文件lint均exit0，lint为0 warnings/errors、1 rule。四份full/type/lint/12case记录各91个Merman输入和日志SHA匹配当前源，27个保护输入保持原值。没有累加诊断与full用例。

[同角色共享端口规则](../../packages/merman/src/flowchart/routing.ts:945)在普通refinement保留原fan-out/fan-in精确坐标固定；同Node已有跨角色续接由独立endpoint检查允许。原子source cohort复用既有标签避障与完整几何校验，接受前要求当前trial的length/bends/crossings Pareto、bounds/ink/真实最大行宽、terminal/parallel条件通过；拒绝不会部分写回。局部Map只缓存本次文本宽度，零宽也命中，不跨图保存。没有放宽预算、删fixture/golden、按图族或viewport特判，也未新增第二路由器。

F的完整失败504/1、bends15/length372与[阻断复审](evidence/v2-desktop-p0.3-2026-10-25/merman-routing-candidate-f-review.md)保留。G五处PortRole消融与七个选定回退的真实候选数据支持角色范围原因；12case中七例恢复E、五尾保持F改善。并不保证全部E→G每case更优：rl/bt长度160→192，而弯折/交叉改善；G worst decision lr-long80仍23 bends，对E为22。全量预算通过与这些权衡分别记账。G321只有full真实console派生summary，未声称存在未运行的逐行诊断。

Owner：Merman/Client/Desktop/Release负责人、主智能体。AUDIT-V2-DESKTOP-CLOSURE继续开放：最终同源完整CLI/App/Desktop/Linux packaged、Session/auth/native PTY/handoff、service复用和源/产物身份需运行新验收入口；其他平台、installer/release/updater范围仍按既有账本。现有development17和packaged17使用旧CLI，保留历史。未提交、推送、合并或发布，本审批的git log生成commit列表为空。
