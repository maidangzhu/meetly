import { invoke } from "@tauri-apps/api/core";
import { Agent } from "@earendil-works/pi-agent-core";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import type { Api, Model } from "@earendil-works/pi-ai";

export type PiObserverTrigger = "session_started" | "question_detected" | "manual_ask_done" | "heartbeat";

export type PiObserverRequest = {
  sessionId: string;
  trigger: PiObserverTrigger;
  prompt: string;
  onDelta?: (delta: string) => void;
  onReset?: () => void;
};

export type PiObserverResult = {
  text: string;
};

type LlmRuntimeConfig = {
  baseUrl: string;
  model: string;
  apiKey: string;
};

const PI_OBSERVER_TIMEOUT_MS = 8_000;
const PI_OBSERVER_PROMPT_LOG_CHARS = 1_200;
const PI_OBSERVER_RESPONSE_LOG_CHARS = 260;

const SYSTEM_PROMPT = [
  "你是 Meetly 的场边教练 agent，正在辅助用户进行实时面试或重要对话。",
  "你像一个站在用户身边的面试教练。你要主动帮用户抓住问题、追问和卡住的时刻。",
  "你的思考顺序是：先判断局势，再判断风险，最后给最小帮助。",
  "局势包括：对方在提问、用户正在回答、用户卡住、用户答偏、用户说太散、对方在追问、当前无需打扰。",
  "风险包括：没回答问题本身、只有概念没有经历、没有结论、被追问带偏、错过展示优势、沉默太久。",
  "最小帮助包括：一句开口语、一个回答骨架、一个补充角度、一句自然收尾、一个反问问题、或者一句提醒用户补强的短句。",
  "你的输出不是状态播报，不要说“检测到问题”“注意收束”“这是技术问题”这类标签化文案。",
  "你的默认行为是帮用户说下一句话。",
  "每次被唤醒，你都必须输出一到三句给用户看的帮助。哪怕上下文很少，也给一句低打扰的开口、补充角度或收尾句。",
  "如果上下文里出现了问题、追问、解释不清、答偏、卡顿、或用户可以更好地接一句，你必须给出具体可说的话。",
  "直接给用户可以开口说的话，或者给一个很短的答案骨架。不要只讲原则。",
  "输出必须像聊天消息：一到三句话，不用 Markdown，不要长篇分析。",
  "好的输出例子：可以先说“我会先确认影响面，再用指标定位是哪一层变慢”。然后补一个你做过的排查例子。",
  "坏的输出例子：这是一个技术问题。先给一句明确结论，再补一个例子。",
].join("\n");

let cachedAgent: Agent | null = null;
let cachedSessionId: string | null = null;

export async function runPiObserver(request: PiObserverRequest): Promise<PiObserverResult> {
  const config = await invoke<LlmRuntimeConfig>("get_llm_runtime_config_for_pi");
  const model = buildOpenAiCompatibleModel(config);
  const agent = getOrCreateAgent(request.sessionId, model, config.apiKey);
  const prompt = buildObserverPrompt(request.trigger, request.prompt);
  const messageCountBefore = agent.state.messages.length;
  let text = "";

  const unsubscribe = agent.subscribe((event: any) => {
    if (event.type !== "message_update") {
      return;
    }

    const assistantEvent = event.assistantMessageEvent;
    if (assistantEvent?.type !== "text_delta" || !assistantEvent.delta) {
      return;
    }

    text += assistantEvent.delta;
    request.onDelta?.(assistantEvent.delta);
  });

  try {
    debugLog(
      `[pi-runtime] prompt trigger=${request.trigger} messages_before=${messageCountBefore} chars=${prompt.length} preview=${compactForLog(prompt, PI_OBSERVER_PROMPT_LOG_CHARS)}`
    );
    text = "";
    await withTimeout(agent.prompt(prompt), PI_OBSERVER_TIMEOUT_MS);
    let trimmed = text.trim();
    let messageCountAfter = agent.state.messages.length;
    if (isInvalidCoachOutput(trimmed)) {
      pruneSilentTurn(agent, messageCountBefore);
      request.onReset?.();
      debugLog(
        `[pi-runtime] retry trigger=${request.trigger} reason=invalid_output messages_reset_to=${agent.state.messages.length} first_text=${compactForLog(trimmed, PI_OBSERVER_RESPONSE_LOG_CHARS)}`
      );
      text = "";
      await withTimeout(agent.prompt(buildNoSilentRetryPrompt(request.trigger, request.prompt)), PI_OBSERVER_TIMEOUT_MS);
      trimmed = text.trim();
      messageCountAfter = agent.state.messages.length;
      if (isInvalidCoachOutput(trimmed)) {
        pruneSilentTurn(agent, messageCountBefore);
      }
    }
    debugLog(
      `[pi-runtime] result trigger=${request.trigger} messages_before=${messageCountBefore} messages_after=${messageCountAfter} messages_kept=${agent.state.messages.length} chars=${trimmed.length} text=${compactForLog(trimmed, PI_OBSERVER_RESPONSE_LOG_CHARS)}`
    );
    return { text: trimmed };
  } catch (error) {
    if (error instanceof Error && error.message === "PI_OBSERVER_TIMEOUT") {
      cachedAgent = null;
      cachedSessionId = null;
      return { text: text.trim() };
    }
    throw error;
  } finally {
    unsubscribe();
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error("PI_OBSERVER_TIMEOUT"));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  });
}

function getOrCreateAgent(sessionId: string, model: Model<Api>, apiKey: string) {
  if (cachedAgent && cachedSessionId === sessionId) {
    cachedAgent.state.systemPrompt = SYSTEM_PROMPT;
    cachedAgent.state.model = model;
    cachedAgent.getApiKey = () => apiKey;
    return cachedAgent;
  }

  cachedSessionId = sessionId;
  cachedAgent = new Agent({
    sessionId,
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model,
      tools: [],
      messages: [],
      thinkingLevel: "off",
    },
    getApiKey: () => apiKey,
    streamFn: (directModel, context, options) =>
      streamSimple(directModel as Model<"openai-completions">, context, {
        ...options,
        apiKey,
        temperature: 0.25,
        maxTokens: 700,
      }),
    toolExecution: "parallel",
  });

  return cachedAgent;
}

function pruneSilentTurn(agent: Agent, messageCountBefore: number) {
  if (agent.state.messages.length <= messageCountBefore) {
    return;
  }
  agent.state.messages = agent.state.messages.slice(0, messageCountBefore);
}

function buildOpenAiCompatibleModel(config: LlmRuntimeConfig): Model<"openai-completions"> {
  return {
    id: config.model,
    name: config.model,
    api: "openai-completions",
    provider: "meetly-llm",
    baseUrl: normalizeOpenAiBaseUrl(config.baseUrl),
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4096,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsStrictMode: false,
      supportsStore: false,
      supportsUsageInStreaming: false,
      maxTokensField: "max_tokens",
    },
  };
}

function normalizeOpenAiBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/chat\/completions\/?$/i, "").replace(/\/$/, "");
}

function buildObserverPrompt(trigger: PiObserverTrigger, prompt: string) {
  return [
    `触发原因：${trigger}`,
    "",
    "下面是产品侧整理过的实时上下文。你要以场边教练身份给用户一到三句短帮助。",
    "本轮必须输出给用户看的内容。上下文少时，也给一句低打扰的开口、补充角度、反问或收尾句。",
    "不要依赖产品侧识别的问题。你自己从转写里判断当前问题、追问、用户是否卡住、以及下一句该怎么接。",
    "Wake reason: transcript_update 表示刚刚有新转写。你要快速看最近几行；如果新内容包含问题、追问、卡顿、解释不清或弱回答，就给一句帮助。",
    "Wake signal: new_question 表示对方刚问出问题。你可以给一个短答案、开口句、或回答结构，但不要输出分类标签。",
    "Wake signal: silence_after_question 表示用户可能卡住。优先给一句可以立刻开口的话。",
    "Wake signal: long_answer 表示用户可能说散了。不要说“注意收束”，而是直接给一句能自然收尾的话。",
    "Wake signal: fresh_context 表示主动观察。最近几行有明确问题、追问、弱回答、卡住迹象、或有可补充的下一句话时，直接给可用话术。",
    "不要复述内部字段名，不要解释你为什么被唤醒。",
    "先在心里完成判断：当前局势是什么、用户会不会失分、最短可用帮助是什么。最终只输出给用户看的那句话。",
    "",
    prompt,
  ].join("\n");
}

function buildNoSilentRetryPrompt(trigger: PiObserverTrigger, prompt: string) {
  return [
    `触发原因：${trigger}`,
    "",
    "上一轮输出无效。你现在必须给用户一到三句真正可用的场边教练提示。",
    "不要输出占位词，不要解释规则，不要复述内部字段名。",
    "如果信息不足，就给一句保守但可用的接话，例如帮用户先确认问题、承认需要拆解、或者给一个回答骨架。",
    "",
    prompt,
  ].join("\n");
}

function isInvalidCoachOutput(text: string) {
  const normalized = text.trim().toUpperCase();
  return !normalized || normalized === "SILENT";
}

function compactForLog(text: string, maxChars: number) {
  const compacted = text.replace(/\s+/g, " ").trim();
  if (compacted.length <= maxChars) {
    return compacted;
  }
  return `${compacted.slice(0, maxChars)}...`;
}

function debugLog(message: string) {
  void invoke("append_debug_log", { message }).catch((error) => {
    console.error("Failed to write PI debug log:", error);
  });
}
