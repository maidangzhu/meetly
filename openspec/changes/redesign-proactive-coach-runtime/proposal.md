# Proposal: redesign-proactive-coach-runtime

## Why

Meetly 已经有 TypeScript Agent runtime、会议信号检测和自动 Coach 输出，但
“主动式”仍然被压缩成了 `final transcript -> detectSttWake -> AgentRuntime`：

- 原始观察、语义信号、Wake 决策和可见输出没有独立状态；
- 当前全局 cooldown 会让 `session_start` 抑制会议开场后的真实问题；
- prompt 禁止 `SILENT`，导致“值得观察”和“必须打扰”无法区分；
- proactive Wake 与 Enter/Ask 同时发生时，没有完整的抢占和迟到结果失效协议；
- 当前 replay/log 脚本可能测试旧策略或解析旧日志，无法证明真实运行时健康；
- 会议模式的默认音频源可能与飞书、Zoom 的真实声音来源不一致。

这会产生最难排查的产品失败：用户只看到 Coach 没反应，但无法判断是没有
听到、被 gate 跳过、Agent 选择沉默、请求失败、被用户操作抢占，还是迟到
结果被 UI 丢弃。

## What Changes

新增一套本地事件驱动的 Proactive Coach runtime：

- 在策略前记录 typed Coach event journal；
- 从最近事件生成 bounded activity window；
- 用纯函数 Signal Detector 和 Wake Policy 输出稳定的 `wake/ignore reason`；
- 把运行结果统一为 `spoken/silent/failed/superseded`；
- 引入 `interactionEpoch`、abort propagation 和 commit guard；
- 规定 User Ask/Enter 永远抢占 proactive run；
- 同一 transcript 同时触发 Wake 和 Enter 时只产生一个用户优先答案；
- cooldown 只由 `spoken` 消耗，并按 signal/evidence 分桶；
- session lifecycle 不再自动制造 Coach 发言或消耗 transcript cooldown；
- proactive 低优先级观察恢复 `SILENT` 能力；
- 电脑会议默认系统音频，并要求 capture ready 后才评估 transcript wake；
- replay、日志诊断和应用使用同一套 detector/policy/runtime；
- 将每次事件和状态转换写入本地结构化日志。

本变更学习 `maidang-cli` Hat 的理念：观察先落事件、确定性 gate、Agent 可
沉默、用户操作抢占、结果可审计。但不复制服务端 Prisma、HTTP/SSE、10 秒
batch 或 60 秒 cooldown。Meetly 保持本地优先和实时会话延迟边界。

## Product Behavior

主动式 Coach 的定义是：

> 持续观察会议现场，在关键时刻无需用户点击即可低声提醒；普通观察可以
> 保持沉默；用户一旦明确操作，后台观察立即让路。

用户可见结果必须短、具体、可以直接使用。内部事件、signal、cooldown、
`SILENT` 和取消原因不进入可见 Coach 文案。

## Scope

### In scope

- Meeting 和 Interview 共用的事件、策略、运行与并发协议；
- P0 meeting signal：问题、异议、承诺、范围/责任、时间线、决策窗口；
- 用户抢占和 stale result rejection；
- 本地 JSONL 事件日志和 canonical replay；
- 会议默认音频源与 capture-ready 前置条件；
- 当前 TS Agent runtime 的渐进迁移。

### Out of scope

- 多智能体系统；
- 服务端活动数据库或远程遥测；
- 自动操作会议软件或写入长期记忆；
- 双音源混音和完整 speaker diarization；
- 用小模型替换 P0 deterministic gate；
- 主动联网搜索；
- 重写 Rust 音频/provider 架构。

## Success Criteria

- 每段 final transcript 在策略判断前都有结构化 observation trace；
- 每次没有可见输出都能归因到 `ignored/silent/failed/superseded`；
- session start 后 10 秒内的 P1 会议事件不会被生命周期 cooldown 吞掉；
- Wake 和 Enter 同时发生时只有用户请求结果能写入 UI；
- provider 忽略 abort 并迟到返回时，旧结果仍不能污染 UI；
- P3 观察可返回 `SILENT` 且不新增 Coach card；
- 飞书/Zoom 会议默认捕获系统音频；
- replay 脚本导入当前生产 detector、policy 和 runtime protocol；
- 至少三个真实或模拟会议 trace 能完整解释 Coach 行为。

## Related Documents

- `docs/PROACTIVE_COACH_BEHAVIOR.md`
- `docs/PROACTIVE_COACH_RUNTIME_DESIGN.md`
- `docs/AGENT_WAKE_STRATEGY.md` (historical)
- `openspec/changes/add-coach-wake-policy/` (superseded implementation path)
