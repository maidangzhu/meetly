import { invoke } from "@tauri-apps/api/core";
import { Agent } from "@earendil-works/pi-agent-core";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import type { Api, Model } from "@earendil-works/pi-ai";

export type PiObserverTrigger = "session_started" | "question_detected" | "manual_ask_done";

export type PiObserverRequest = {
  sessionId: string;
  trigger: PiObserverTrigger;
  prompt: string;
  onDelta?: (delta: string) => void;
};

export type PiObserverResult = {
  text: string;
};

type LlmRuntimeConfig = {
  baseUrl: string;
  model: string;
  apiKey: string;
};

const SYSTEM_PROMPT = [
  "你是 Meetly 的 PI 旁观者 agent，正在辅助用户进行实时面试或重要对话。",
  "你不是答题机器。你像一个冷静、专业、站在用户这边的朋友，只在有价值时给很短的提示。",
  "输出必须像聊天消息：一到三句话，少用 Markdown，不要长篇分析。",
  "如果当前上下文不值得打扰，严格输出 SILENT。",
  "你可以提示：面试官真实考察点、回答方向、该补充的例子、风险点、如何把话题拉回优势。",
].join("\n");

let cachedAgent: Agent | null = null;
let cachedSessionId: string | null = null;

export async function runPiObserver(request: PiObserverRequest): Promise<PiObserverResult> {
  const config = await invoke<LlmRuntimeConfig>("get_llm_runtime_config_for_pi");
  const model = buildOpenAiCompatibleModel(config);
  const agent = getOrCreateAgent(request.sessionId, model, config.apiKey);
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
    await agent.prompt(buildObserverPrompt(request.trigger, request.prompt));
    return { text: text.trim() };
  } finally {
    unsubscribe();
  }
}

function getOrCreateAgent(sessionId: string, model: Model<Api>, apiKey: string) {
  if (cachedAgent && cachedSessionId === sessionId) {
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
        maxTokens: 220,
      }),
    toolExecution: "parallel",
  });

  return cachedAgent;
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
    "下面是产品侧整理过的实时上下文。判断是否值得打扰用户。",
    "值得就给短提示；不值得就只输出 SILENT。",
    "",
    prompt,
  ].join("\n");
}
