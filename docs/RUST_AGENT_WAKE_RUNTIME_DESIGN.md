# Frontend Agent Wake Runtime Design

> 文件名暂时保留 `RUST_AGENT_WAKE_RUNTIME_DESIGN.md`，但本设计已经改为前端 TS agent runtime。后续可以单独重命名，避免和代码改动混在一起。

## 1. 结论

Meetly 第一版 agent wake runtime 放在前端 TypeScript 层，不放 Rust。

正确链路是：

```text
STT final transcript
  -> TS ContextStore
  -> TS DemandDetector
  -> WakeEvent
  -> TS AgentRuntime
  -> LLM transport/provider adapter
  -> React 展示

用户在前端发起 Ask（Enter 快捷键或按钮点击）
  -> TS WakeEvent
  -> TS AgentRuntime
  -> LLM transport/provider adapter
  -> React 展示
```

这里的 Enter 不是系统级键盘监听，也不是 Rust/native 读取键盘事件。它只是 React UI 中的用户意图：当前窗口里按 Enter，或点击同一个 Ask 入口。

Rust 不负责：

- 监听 Enter；
- 持有 wake queue；
- 持有 agent runtime；
- 持有 demand detector；
- 决定什么时候跑 agent；
- 实现前端 PI agent loop。

Rust 可以继续负责 native/provider 边界：

- STT/LLM API key 和本地 provider 配置；
- `transcribe_audio` 这类 native command；
- 必要时提供一个“完成一次 LLM 请求”的 command，作为 TS runtime 的 transport adapter。

如果 TS runtime 通过 Rust command 调 LLM，那只是 provider transport，不是 Rust agent runtime。

## 2. 第一版范围

第一版只监听两个唤醒源：

1. `STT final transcript`：每段最终转写进入 TS ContextStore。TS demand detector 判断像问题时，发出 `SttQuestion` wake。
2. 用户前端 Ask：React 里的 Enter 快捷键或按钮点击直接发出 `Enter` wake。

第一版不做：

- cron / heartbeat；
- 每 10 秒主动观察；
- Rust wake queue；
- Rust AgentRuntime；
- 前端 PI agent loop；
- `SILENT` 协议；
- 屏幕 context；
- 长期 memory；
- 工具调用。

## 3. 为什么 agent 放 TS

当前产品的主交互和状态都在前端：

- 麦克风主路径在 `src/app/useMicMeeting.ts`：`getUserMedia + MediaRecorder -> transcribe_audio`。
- transcript UI、session state、assistant suggestion 展示都在 React state/hooks。
- 用户 Ask 的意图来自前端窗口：快捷键或按钮。
- 旧自动 coach 在 `src/app/usePiCoach.ts` 和 `src/runtime/piObserver.ts`，本质也是前端 runtime。

所以第一版应该先把旧前端 PI runtime 收敛成新的 TS runtime，而不是把 wake/runtime 状态搬进 Rust。

Rust 继续作为 Tauri/native/provider 能力层。这样边界更清楚：

- React/TS：用户意图、会话上下文、wake policy、agent runtime、UI 展示。
- Rust：本机能力、密钥读取、provider 请求、日志和文件系统能力。

## 4. 模块边界

新增或收敛为 TS 模块：

```text
src/runtime/agent/
  wake.ts
  contextStore.ts
  demand.ts
  prompt.ts
  runtime.ts
```

也可以放在 `src/app/agent/`，但不要继续把核心 runtime 写进 `usePiCoach.ts`。hook 只负责把 runtime 接到 React 生命周期和 UI state。

### 4.1 wake.ts

定义 wake event。

```ts
export type WakeKind = "enter" | "stt_question";

export type WakeEvent = {
  kind: WakeKind;
  priority: number;
  reason: string;
  evidence: string[];
  createdAtMs: number;
};

export function createEnterWake(): WakeEvent {
  return {
    kind: "enter",
    priority: 100,
    reason: "user_frontend_ask",
    evidence: [],
    createdAtMs: Date.now(),
  };
}
```

优先级：

```text
Enter       100
SttQuestion  90
```

第一版不需要复杂 priority queue。TS runtime 可以串行消费，确保同一时间只跑一轮。

### 4.2 contextStore.ts

保存最近 transcript，不持久化原始音频。

```ts
export type ContextSnapshot = {
  recentTranscript: TranscriptSegment[];
  latestSegment: TranscriptSegment | null;
};

export class ContextStore {
  private segments: TranscriptSegment[] = [];

  pushTranscript(segment: TranscriptSegment) {
    this.segments.push(segment);
    this.evictOldSegments(180_000);
  }

  snapshot(windowMs: number): ContextSnapshot {
    const latest = this.segments.at(-1) ?? null;
    if (!latest) {
      return { recentTranscript: [], latestSegment: null };
    }

    return {
      latestSegment: latest,
      recentTranscript: this.segments.filter(
        (segment) => latest.endMs - segment.endMs <= windowMs
      ),
    };
  }

  private evictOldSegments(maxAgeMs: number) {
    const latest = this.segments.at(-1);
    if (!latest) return;
    this.segments = this.segments.filter(
      (segment) => latest.endMs - segment.endMs <= maxAgeMs
    );
  }
}
```

可以先复用 `ctx.transcriptHistoryRef` 的数据，但 runtime 层应该有明确的 `ContextStore` 接口，不要让 demand/runtime 直接散落读取多个 React refs。

### 4.3 demand.ts

第一版只做新问题检测。

```ts
export function detectSttWake(segment: TranscriptSegment): WakeEvent | null {
  const text = segment.text.trim();
  if (!text) return null;

  const isQuestion =
    text.endsWith("?") ||
    text.endsWith("？") ||
    containsQuestionKeyword(text);

  if (!isQuestion) return null;

  return {
    kind: "stt_question",
    priority: 90,
    reason: "stt_question_detected",
    evidence: [text],
    createdAtMs: Date.now(),
  };
}
```

中文关键词第一版先够用：

```text
吗、呢、什么、为什么、怎么、怎样、如何、能不能、可不可以、有没有、多少、哪
```

英文关键词第一版：

```text
what, why, how, can you, could you, would you, tell me about, walk me through, explain, describe
```

`demand.ts` 只产 `WakeEvent`，不调用 LLM，不展示 UI。

### 4.4 runtime.ts

`AgentRuntime` 是唯一消费 wake event 的地方。

第一版每个 wake event 只跑一轮。不要让 agent 自己循环思考。

```ts
export class AgentRuntime {
  private inFlight = false;
  private queue: WakeEvent[] = [];
  private pendingSttWake: WakeEvent | null = null;

  constructor(
    private context: ContextStore,
    private transport: AgentTransport,
    private callbacks: AgentRuntimeCallbacks
  ) {}

  wake(event: WakeEvent) {
    if (event.kind === "stt_question" && this.inFlight) {
      this.pendingSttWake = event;
      return;
    }

    if (!passesWakeGate(event)) {
      return;
    }

    this.queue.push(event);
    void this.drain();
  }

  private async drain() {
    if (this.inFlight) return;
    this.inFlight = true;

    try {
      while (this.queue.length > 0) {
        const wake = this.queue.shift()!;
        const snapshot = this.context.snapshot(120_000);
        const prompt = buildAgentPrompt(wake, snapshot);
        const suggestion = await this.transport.complete(prompt);
        this.callbacks.onMessage(suggestion);
      }
    } catch (error) {
      this.callbacks.onError(error instanceof Error ? error.message : String(error));
    } finally {
      this.inFlight = false;
    }
  }
}
```

### 4.5 wake gate

STT final 可能非常频繁，所以不能每段 transcript 都输出 coach message。

第一版 gate 规则：

- `Enter` 永远通过，用户明确叫醒 coach。
- 普通陈述句不产生 wake。
- STT wake 在 coach in-flight 时只保留最新一条 pending wake。
- STT wake 有冷却时间，例如 10 秒内不重复输出。
- 最近 60 秒处理过的相似问题不重复输出。

核心原则：

```text
频繁 STT -> 大部分被 detector/gate 掉 -> 少数 wake 进入 runtime -> 一旦进入 runtime 就必须输出
```

不要用 `SILENT` 解决频繁 STT。

### 4.6 prompt.ts

根据 `WakeEvent + ContextSnapshot` 生成 prompt。

第一版 transport 可以临时复用现有 `AssistantSuggestion` 结构承载返回值，但 UI 语义是 coach message：

```json
{
  "answer": "string",
  "bullets": ["string"],
  "clarifyingQuestion": "string or null"
}
```

prompt 目标：

- `Enter`：用户明确求助，给更完整但仍短的可说出口回答。
- `SttQuestion`：检测到对方问题，给一句可以立刻开口的回答骨架。

不要再使用 `SILENT`。如果不该唤醒，前面的 detector 就不应该发 wake event。

## 5. React 接入

### 5.1 STT final

当前主路径：

```text
useMicMeeting.ts
  getUserMedia
  MediaRecorder
  safeInvoke("transcribe_audio")
  autoAssist.addTranscriptSegment(segment)
```

第一版改成：

```text
STT 成功
  -> 本地 transcript UI 更新
  -> agentContextStore.pushTranscript(segment)
  -> detectSttWake(segment)
  -> agentRuntime.wake(wake)
```

这里不需要 Rust `push_transcript_final` command。

### 5.2 用户 Ask / Enter

当前前端已经有 Ask 入口：

```text
useAssistantAsk.ts
  window keydown Enter
  askAssistant()
```

第一版应该改成：

```ts
agentRuntime.wake(createEnterWake());
```

这不是系统 Enter。它只是 React 前端收到用户 Ask 意图。

按钮点击、auto assist chip 点击，也应该走同一个 `askAssistant()` / `createEnterWake()` 入口，不要分裂成另一条 runtime。

### 5.3 展示

runtime callback 直接写 coach UI state：

```text
onWakeStart -> setIsCoachThinking(true), setCoachDraft(...)
onMessage   -> append coachMessages, setCoachDraft(null), setIsCoachThinking(false)
onError     -> setCoachDraft(null), setIsCoachThinking(false)
```

不要写 `assistantSuggestion`。左侧建议区是手动 LLM 辅助，右侧「场边教练」才是 agent 输出位置。

## 6. 停用旧路径

第一版要停用或绕开：

- `usePiCoach` heartbeat；
- `src/runtime/piObserver.ts`；
- 每段 transcript 直接 `runPiCoach`；
- `manual_ask_done` 后再触发 coach；
- `SILENT` 判断和 retry 协议。

可以先保留文件，但运行路径不能依赖它们。

## 7. LLM transport

`AgentRuntime` 不应该关心 LLM 具体从哪里来。定义一个 transport 接口：

```ts
export type AgentTransport = {
  complete(prompt: AgentPrompt): Promise<AssistantSuggestion>;
};
```

第一版实现：

1. Tauri provider transport：调用现有 Rust provider command 完成一次 LLM 请求。
2. Rust 只作为 provider adapter，不持有 wake queue、ContextStore、DemandDetector、AgentRuntime。

如果使用 Tauri provider transport，Rust 仍然只是 provider adapter：

```text
TS AgentRuntime
  -> invoke("complete_agent_prompt" or existing assistant command)
  -> Rust provider request
  -> AssistantSuggestion
  -> TS callback 写入 coachMessages
```

不要把 wake queue、ContextStore、DemandDetector、AgentRuntime 放进 Rust。

## 8. 验收标准

### 8.1 用户 Ask / Enter

用户在前端按 Enter，或点击同一个 Ask 入口。

预期：

- 不需要系统级键盘监听；
- 不调用 Rust `wake_agent_enter`；
- TS 创建 `Enter` wake event；
- TS AgentRuntime 消费 wake event；
- 右侧「场边教练」展示真实 coach message；
- 录音不被中断。

### 8.2 STT final 唤醒

输入一段转写：

```text
你能讲一下这个项目里 Agent 是怎么做上下文管理的吗？
```

预期：

- transcript 出现在 UI；
- TS ContextStore 写入 segment；
- `detectSttWake` 产出 `SttQuestion`；
- TS AgentRuntime 消费 wake event；
- 右侧「场边教练」展示 agent message；
- 不需要按 Enter。

### 8.3 普通转写不唤醒

输入：

```text
好的我明白了这个部分主要是我们做了一个本地的桌面应用。
```

预期：

- transcript 出现在 UI；
- 不产生 wake event；
- 不调用 LLM；
- 不展示 coach message。

### 8.4 禁用旧 PI 路径

预期日志中不再出现：

```text
[pi] heartbeat
[pi-runtime]
coach silent
```

## 9. 推荐执行顺序

### Step 1：TS agent skeleton

- 新增 `src/runtime/agent/`。
- 定义 `WakeEvent`、`ContextStore`、`AgentRuntime`。
- `AgentRuntime` 使用 Tauri provider transport。
- `useAssistantAsk.ts` 的前端 Ask/Enter 保持走左侧建议区。
- 右侧「场边教练」能展示真实 coach message。

做完停下来。

### Step 2：停用旧 PI runtime

- `usePiCoach` 不再启动 heartbeat。
- `useAutoAssist` 不再每段 transcript 直接 `runPiCoach`。
- `assistant_done` 不再触发 `manual_ask_done` coach。
- 保留文件但运行路径不再依赖 `piObserver`。

做完停下来。

### Step 3：接 STT final

- STT 成功后写入 TS `ContextStore`。
- `detectSttWake` 只识别问题。
- 问题自动唤醒，陈述句不唤醒。

做完停下来。

### Step 4：接真实 LLM transport

- 用 TS `AgentTransport` 抽象真实 provider。
- 如果需要密钥/CORS，transport 可以调用 Rust provider command。
- Runtime 仍然留在 TS。

做完停下来。
