# Design: add-coach-wake-policy

## 1. 核心决定

叫醒机制分两层：

```text
规则层
  便宜、可解释、可测试
  决定要不要叫醒旁观者

场边教练
  只在规则层认为值得看时运行
  判断这次是否真的需要提示
  输出短提示或 SILENT
```

也就是说，强事件由规则层叫醒旁观者；10 秒心跳是低优先级观察。只要会话已有转写且旁观者空闲，心跳可以调用 PI，但 PI 可以返回 `SILENT`，界面不展示内容。

这里要区分两个概念：

```text
观察调用：让 PI 看一次上下文
可见提示：PI 认为值得打扰用户，真的输出内容
```

P0 允许每 10 秒有一次观察调用，但不允许每 10 秒都刷一条可见提示。

## 2. 系统架构

目标架构：

```text
STT final segment
  -> useAutoAssist.addTranscriptSegment
  -> transcriptHistoryRef
  -> coachWakePolicy.evaluateTranscriptEvent
       -> wake / skip + reason
  -> usePiCoach.runPiCoach
       -> buildPiCoachPrompt
       -> runPiObserver
       -> coachMessages / SILENT

10s timer
  -> coachWakePolicy.evaluateHeartbeat
       -> wake / skip + reason
  -> usePiCoach.runPiCoach({ trigger: "heartbeat" })
```

新增模块：

```text
src/app/coachWakePolicy.ts
```

推荐类型：

```ts
export type CoachWakeSignal =
  | "new_question"
  | "followup_cluster"
  | "silence_after_question"
  | "long_answer"
  | "answer_drift"
  | "fresh_context"
  | "none";

export type CoachWakeDecision =
  | {
      shouldWake: true;
      trigger: "question_detected" | "heartbeat" | "manual_ask_done";
      signal: CoachWakeSignal;
      reason: string;
      priority: number;
      candidateId?: string;
    }
  | {
      shouldWake: false;
      signal: CoachWakeSignal;
      reason: string;
    };
```

需要的运行状态：

```ts
export type CoachWakeState = {
  lastObservedSegmentId: string | null;
  lastObservedEndMs: number;
  lastWakeAt: number;
  lastVisibleCoachAt: number;
  lastQuestionCandidateId: string | null;
  lastQuestionAt: number;
  lastUserSpeechAt: number;
  lastInterviewerSpeechAt: number;
};
```

这些状态先放在 React ref 里，不需要进持久化存储。

## 3. 叫醒规则

### 3.1 新问题

输入：

- 当前转写段；
- `detectQuestionCandidate` 的结果；
- 最近 2 分钟转写；
- 最近候选问题列表。

规则：

- 置信度大于等于 `0.68`；
- 不是 45 秒内的相似重复问题；
- 当前旁观者没有正在运行。

输出：

- `shouldWake=true`
- `signal="new_question"`
- `trigger="question_detected"`

### 3.2 连续追问

输入：

- 最近 2 分钟问题候选；
- 问题类型；
- 文本相似度；
- 时间间隔。

规则：

- 2 分钟内至少两个问题；
- 问题类型相同，或者关键词重合较高；
- 最近一次旁观者没有已经针对这个问题组提示过。

输出：

- `shouldWake=true`
- `signal="followup_cluster"`
- `trigger="heartbeat"`

### 3.3 沉默救场

输入：

- 最近一次面试官问题时间；
- 最近一次用户说话时间；
- 当前时间；
- 最近是否已经提示过。

规则：

- 问题后 6-10 秒没有用户回答；
- 没有正在预生成或旁观者运行；
- 这次问题没有触发过沉默救场。

输出：

- `shouldWake=true`
- `signal="silence_after_question"`
- `trigger="heartbeat"`

### 3.4 回答过长

输入：

- 最近一次问题后用户连续说话时长；
- 用户回答段数；
- 是否已经出现总结或结论类表达。

规则：

- 用户回答持续超过 20 秒；
- 没有明显结论词，比如“所以”“总结一下”“核心是”；
- 最近 15 秒没有旁观者提示。

输出：

- `shouldWake=true`
- `signal="long_answer"`
- `trigger="heartbeat"`

### 3.5 答偏风险

第一版不做复杂语义模型，只做弱规则：

- 最近问题关键词和用户最近回答关键词重合很低；
- 用户回答持续超过 12 秒；
- 最近问题是技术/系统设计/产品题。

输出：

- `shouldWake=true`
- `signal="answer_drift"`
- `trigger="heartbeat"`

这个规则风险较高，P0 可以只记录日志，不展示提示；P1 再打开。

### 3.6 10 秒低优先级观察

规则：

- 如果 `transcriptHistory` 为空，跳过；
- 如果旁观者正在运行，跳过；
- 否则以 `fresh_context` 叫醒 PI 做一次观察；
- 是否展示内容由 PI 判断，普通情况应该返回 `SILENT`。

输出：

- `shouldWake=true`
- `signal="fresh_context"`
- `reason="heartbeat_observe_new"` 或 `reason="heartbeat_observe_repeat"`

这个规则来自产品判断：旁观者应该像现场教练一样定期看一眼，但不能定期刷存在感。

## 4. 状态更新

叫醒成功开始时：

- 更新 `lastWakeAt`；
- 标记本次候选问题或转写范围；
- 日志记录 `wake start`。

PI 返回可见提示时：

- 更新 `lastVisibleCoachAt`；
- 更新 `lastObservedSegmentId` 和 `lastObservedEndMs`；
- 日志记录 `wake visible`。

PI 返回 `SILENT` 时：

- 仍然更新 `lastObservedSegmentId` 和 `lastObservedEndMs`；
- 日志记录 `wake silent`；
- 下一次心跳仍可做低优先级观察，但提示词会要求 PI 没有价值就继续 `SILENT`。

跳过时：

- 不更新 `lastObservedSegmentId`；
- 只记录 `skip reason`。

## 5. 日志

每次判断都写结构化日志，格式类似：

```text
[coach-policy] decision=wake signal=new_question trigger=question_detected reason=explicit_question candidate=q-123 segments=18
[coach-policy] decision=wake signal=fresh_context trigger=heartbeat reason=heartbeat_observe_repeat candidate=none
[coach-policy] decision=wake signal=silence_after_question trigger=heartbeat reason=question_idle_8200ms candidate=q-123
[coach-policy] result=silent trigger=heartbeat signal=fresh_context duration_ms=1430
```

日志不能包含 API key、完整 Authorization header、完整长转写。

## 6. 测试机制

### 6.1 纯规则单元测试

目标：

不用 STT，不用真实大模型，只测 `coachWakePolicy`。

覆盖：

- 新问题会叫醒；
- 重复问题会跳过；
- 没有任何转写时心跳会跳过；
- 已有转写且旁观者空闲时，心跳会用 `fresh_context` 观察；
- 问题后沉默会叫醒；
- 用户回答太长会叫醒；
- 旁观者运行中会跳过；
- 返回 `SILENT` 后会标记已观察，但 10 秒心跳仍可再次做低优先级观察。

### 6.2 回放测试

新增脚本：

```text
scripts/replay-coach-wake-policy.mjs
```

输入是一个场景文件：

```json
{
  "name": "technical-followup",
  "segments": [
    {
      "atMs": 0,
      "speaker": "interviewer",
      "text": "你能讲一下你做过最复杂的一个项目吗？"
    },
    {
      "atMs": 7000,
      "speaker": "user",
      "text": "这个项目里我负责音频采集和转写链路。"
    }
  ],
  "expected": [
    {
      "timeRangeMs": [0, 2500],
      "decision": "wake",
      "signal": "new_question"
    }
  ]
}
```

脚本输出：

```json
{
  "scenario": "technical-followup",
  "wakeCount": 2,
  "skipCount": 8,
  "expectedWakeHitRate": 1,
  "falseWakeCount": 0,
  "missedWakeCount": 0,
  "medianDecisionDelayMs": 120,
  "events": []
}
```

第一版回放只跑规则层，不跑 PI。这样稳定、便宜、适合每次提交都跑。

### 6.3 端到端模拟

沿用现有：

```text
pnpm test:flow
```

后续扩展为：

```text
pnpm test:wake
pnpm test:wake:e2e
```

区别：

- `test:wake`：只跑规则和回放，不访问网络；
- `test:wake:e2e`：用真实 PI/LLM，验证提示质量和流式速度。

### 6.4 人工复盘测试

真实面试/模拟面试后，查看：

- 旁观者提示是否出现在正确时刻；
- 是否有明显废话；
- 是否有错过关键问题；
- 用户是否觉得被打扰；
- Enter 路径是否仍然比旁观者优先。

人工复盘结果要写入会话报告或 debug summary，形成可回看样本。

## 7. 测试用例

P0 必须覆盖：

| 用例 | 输入 | 期望 |
|---|---|---|
| 明确问题 | “你会怎么定位线上延迟？” | 新问题叫醒 |
| 行为问题 | “讲一下你做过最复杂的项目。” | 新问题叫醒 |
| 填充词 | “嗯嗯，好的，可以。” | 不叫醒 |
| 无任何转写 | 心跳时会话里还没有转写 | 不叫醒 |
| 已有转写的心跳 | 心跳时已有上下文且旁观者空闲 | `fresh_context` 观察 |
| 重复问题 | 45 秒内同一问题重复识别 | 不重复叫醒 |
| 沉默救场 | 问题后 8 秒没有用户回答 | 叫醒 |
| 回答过长 | 用户连续回答超过 20 秒 | 叫醒 |
| 旁观者忙 | `coachInFlight=true` | 不叫醒 |
| SILENT 标记 | PI 对一段内容返回 `SILENT` | 标记已观察，后续心跳仍按低优先级观察 |

P1 增加：

| 用例 | 输入 | 期望 |
|---|---|---|
| 连续追问 | 2 分钟内同一主题 3 个问题 | 叫醒追问归因 |
| 答偏风险 | 问性能，用户一直讲 UI | 记录或提示拉回问题 |
| 中英混合 | “Can you explain 你怎么做 tradeoff？” | 正确识别 |
| 说话人未知 | 没有 speaker 标签 | 不因标签缺失崩溃，保守判断 |

P2 增加：

| 用例 | 输入 | 期望 |
|---|---|---|
| 长会话 | 30 分钟转写回放 | 调用次数稳定，不随时长线性失控 |
| 噪声 STT | 错字、重复、半句话 | 不频繁误叫醒 |
| 真实 PI | 真实模型输出 | 可见提示短、准、少废话 |

## 8. 如何衡量好坏

规则层指标：

| 指标 | 解释 | P0 目标 |
|---|---|---|
| 应叫醒命中率 | 标注为该叫醒的事件，有多少被叫醒 | >= 85% |
| 误叫醒数 | 不该叫醒却叫醒 | 每 10 分钟 <= 2 次 |
| 重复叫醒数 | 同一事件短时间重复叫醒 | 每场 <= 1 次 |
| 空会话跳过率 | 没有任何转写时跳过比例 | 100% |
| 心跳观察率 | 已有转写且空闲时心跳是否观察 | 100% |
| 判断延迟 | 转写进来后多久做出 wake/skip | p95 < 100ms |

端到端指标：

| 指标 | 解释 | P0 目标 |
|---|---|---|
| 首字延迟 | 叫醒后到旁观者流式首字 | p50 < 1.5s |
| 完整提示延迟 | 叫醒后到提示完成 | p50 < 3s |
| 有效提示率 | 人工复盘认为有用的提示比例 | >= 60% |
| 打扰率 | 人工复盘认为多余/烦的提示比例 | <= 20% |
| Enter 不回归 | 用户按 Enter 仍可正常得到答案 | 100% 通过核心用例 |

产品层指标：

- 用户是否能在压力场景下更快开口；
- 用户是否觉得旁观者“懂现场”；
- 是否减少“我按了 Enter 才来得及”的尴尬；
- 是否避免把界面变成信息噪音。

## 9. 如何评估测试机制本身

测试机制要回答两个问题：

1. 能不能还原机制行为？
2. 能不能预测真实体验？

判断标准：

- 同一份回放输入，多次运行输出一致；
- 每个 `wake` / `skip` 都有原因；
- 用例能覆盖真实触发路径，而不是只测孤立函数；
- 回放结果能定位到具体转写段和时间点；
- 人工复盘发现的问题，可以补成新的回放用例；
- 改规则后能用旧用例回归，避免修一个场景坏另一个场景。

所以答案是：可以用测试用例还原“规则层机制”，但不能完全还原“模型输出质量”。模型输出质量必须结合真实 PI/LLM 的端到端测试和人工复盘。

## 10. 分阶段目标

### P0：可解释叫醒

实现：

- `coachWakePolicy.ts`
- 10 秒心跳先过规则；
- 新问题、沉默、长回答、心跳观察、忙碌跳过；
- 结构化日志；
- 规则单元测试和回放测试。

验证：

- `pnpm test:wake`
- `pnpm build`
- 一场 5 分钟模拟面试人工测试。

### P1：更像真人旁观者

实现：

- 连续追问；
- 回答过长；
- 答偏风险先只记录，再逐步展示；
- 回放场景扩充到 15 个以上；
- 会后报告里记录旁观者触发原因。

验证：

- 回放命中率和误叫醒数达标；
- 真实 PI 测试提示有效率达到目标；
- 不影响 Enter 路径。

### P2：智能路由

实现：

- 小模型或本地判断器；
- 长会话记忆；
- 和问屏幕、工具调用联动。

验证：

- 和 P1 规则基线做对比；
- 只有在误叫醒更少、漏叫醒更少、延迟可接受时才替换规则。
