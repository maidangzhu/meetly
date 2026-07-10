import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";

const AUTO_ASSIST_MIN_CONFIDENCE = 0.68;
const AUTO_ASSIST_PREFETCH_CONFIDENCE = 0.88;
const FULL_SESSION_SEGMENT_LIMIT = 500;
const PI_OBSERVER_TIMEOUT_MS = 8_000;

const SYSTEM_PROMPT = [
  "你是 Meetly 的 PI 旁观者 agent，正在辅助用户进行实时面试或重要对话。",
  "你不是答题机器。你像一个冷静、专业、站在用户这边的朋友，只在有价值时给很短的提示。",
  "输出必须像聊天消息：一到三句话，少用 Markdown，不要长篇分析。",
  "如果当前上下文不值得打扰，严格输出 SILENT。",
  "你可以提示：面试官真实考察点、回答方向、该补充的例子、风险点、如何把话题拉回优势。",
].join("\n");

const INTERVIEW_PROMPT =
  "You are helping a job candidate answer an interviewer's question in real time, during a live interview. Speak in the candidate's voice: steady, structured, first person. Do not coach the user in third person (\"you could say...\") — write the actual words the candidate should say.";

const JSON_OUTPUT_CONTRACT =
  "Respond with a JSON object only, matching exactly this shape: {\"answer\": string, \"bullets\": string[] (max 3 items), \"clarifyingQuestion\": string or null}. The answer must be short: one or two sentences the user can say directly. No text outside the JSON object.";

const scenario = [
  "你好，我们先开始。你简单介绍一下自己。",
  "我主要做前端和一些 AI 产品工程，最近在做一个实时面试辅助工具。",
  "你能讲一下你做过最复杂的一个项目吗？",
  "这个项目里我负责从音频采集、转写到大模型建议的整条链路。",
  "如果线上突然出现延迟很高，你会怎么定位？",
];

function loadRuntimeConfig() {
  const secretsPath = path.join(os.homedir(), ".meetly", "secrets.json");
  const configPath = path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "com.maidang.meetly",
    "provider_config.json"
  );
  const secrets = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const llm = config.llm;
  if (!secrets.llm_api_key || !llm?.base_url || !llm?.model) {
    throw new Error("Missing local LLM config or API key.");
  }
  return {
    apiKey: secrets.llm_api_key,
    baseUrl: llm.base_url,
    model: llm.model,
  };
}

function createSegment(text, index) {
  return {
    id: `sim-${index}`,
    source: "microphone",
    speaker: index % 2 === 0 ? "interviewer" : "user",
    text,
    startMs: index * 3_000,
    endMs: index * 3_000 + 2_200,
  };
}

function normalizeTranscriptText(text) {
  return text
    .toLowerCase()
    .replace(/[\s，。！？,.!?;；:：'"“”‘’、（）()[\]{}<>《》-]+/g, "")
    .trim();
}

function questionConfidence(text) {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return 0;

  const hasExplicitQuestion =
    /[?？]\s*$/.test(normalized) ||
    /(吗|呢|么|嘛|什么|为什么|怎么|怎样|如何|哪|多少|能不能|可不可以|有没有)/.test(normalized);
  if (hasExplicitQuestion) return 0.9;

  const interviewPrompt =
    /\b(tell me about|walk me through|talk me through|explain|describe|how would you|what do you think|what is your|why should|can you|could you|have you|design a|time complexity|space complexity|tradeoff|trade-off)\b/i.test(text) ||
    /(讲一下|说一下|介绍一下|解释一下|聊聊|谈谈|你怎么看|你怎么理解|你会怎么|设计一个|系统设计|复杂度|权衡|取舍)/.test(text);

  return interviewPrompt ? 0.75 : 0;
}

function detectQuestionCandidate(segment, recentTranscript) {
  const text = segment.text.trim();
  const normalized = normalizeTranscriptText(text);
  const isShortFollowUp =
    /^(why|how|what|怎么说|为什么|什么意思|然后呢|还有呢)$/i.test(text.trim()) ||
    /^(为什么|怎么说|什么意思)$/.test(normalized);

  if (normalized.length < 4 && !(isShortFollowUp && recentTranscript.length > 1)) return null;

  const kind = classifyQuestionKind(text);
  const baseConfidence = questionConfidence(text);
  const hasInterviewPrompt =
    /(讲一下|说一下|介绍一下|解释一下|聊聊|谈谈|你怎么看|你怎么理解|你会怎么|设计一个|系统设计|复杂度|权衡|取舍|tell me about|walk me through|explain|describe|how would you|what do you think|design a|time complexity|space complexity|tradeoff|trade-off)/i.test(text);
  const explicitQuestion =
    /[?？]\s*$/.test(text) || /(吗|呢|么|什么|为什么|怎么|如何|哪|多少|能不能|可不可以|有没有)/.test(text);
  const confidenceBoost =
    kind === "system_design" || kind === "technical" ? 0.04 : kind === "behavioral" ? 0.02 : 0;
  const confidence = Math.min(
    0.96,
    Math.max(baseConfidence, explicitQuestion ? 0.9 : 0, hasInterviewPrompt ? 0.78 : 0, isShortFollowUp ? 0.72 : 0) +
      confidenceBoost
  );

  if (confidence < AUTO_ASSIST_MIN_CONFIDENCE) return null;

  return {
    id: `question-${segment.id}`,
    segmentId: segment.id,
    text,
    confidence,
    reason: explicitQuestion ? "explicit_question" : isShortFollowUp ? "short_follow_up" : hasInterviewPrompt ? "interview_prompt" : "question_signal",
    kind,
    createdAt: Date.now(),
  };
}

function classifyQuestionKind(text) {
  if (/(系统设计|架构|高并发|扩展|缓存|队列|分布式|design a system|system design|scalab|cache|queue|distributed)/i.test(text)) return "system_design";
  if (/(复杂度|算法|数据结构|react|vue|rust|typescript|javascript|数据库|索引|事务|api|性能|time complexity|space complexity|algorithm|database|index|transaction|延迟)/i.test(text)) return "technical";
  if (/(经历|项目|冲突|失败|优点|缺点|压力|合作|leadership|conflict|failure|strength|weakness|tell me about yourself|behavioral)/i.test(text)) return "behavioral";
  if (/(产品|用户|指标|增长|留存|转化|需求|商业|customer|user|metric|growth|retention|conversion|product)/i.test(text)) return "product";
  return "general";
}

function detectLatestQuestion(segments) {
  for (const segment of [...segments].reverse()) {
    const text = segment.text.trim();
    const confidence = questionConfidence(text);
    if (confidence > 0) {
      return {
        text,
        confidence,
        reason: confidence >= 0.85 ? "explicit_question_signal" : "interview_prompt_signal",
      };
    }
  }

  const latest = segments[segments.length - 1]?.text.trim();
  return latest ? { text: latest, confidence: 0.35, reason: "fallback_latest_transcript" } : null;
}

function buildInterviewAskContext(segments) {
  const ordered = [...segments].sort((left, right) => left.endMs - right.endMs);
  const newestEndMs = ordered[ordered.length - 1]?.endMs ?? 0;
  const recentSegments = ordered.filter((segment) => newestEndMs - segment.endMs <= 120_000);
  const latest = detectLatestQuestion(recentSegments);
  if (!latest) return null;

  const fullSegments = ordered.slice(-FULL_SESSION_SEGMENT_LIMIT);
  const recentTranscript = formatTranscriptBlock(recentSegments);
  const fullTranscript = formatTranscriptBlock(fullSegments);
  const userMessage = [
    "The user is in a live interview. The app has been continuously transcribing microphone audio.",
    "Help the user answer the interviewer clearly and naturally. The latest question block is the highest-priority context. Recent transcript is primary context. Full session transcript is background only.",
    "",
    `Latest question or latest transcript:\n${latest.text}`,
    "",
    `Recent transcript:\n${recentTranscript}`,
    "",
    `Full session transcript:\n${fullTranscript}`,
  ].join("\n");

  return { latest, recentSegments, fullSegments, userMessage };
}

function formatTranscriptBlock(segments) {
  return segments.map((segment) => `[${Math.round(segment.endMs / 1000)}s] ${segment.text}`).join("\n");
}

function buildPiCoachPrompt({ trigger, transcript, candidate, latestAnswer }) {
  const recentSegments = transcript.slice(-10);
  const questionLike = transcript
    .filter((segment) => questionConfidence(segment.text) >= 0.68)
    .slice(-4)
    .map((segment) => segment.text)
    .join("\n");

  return [
    `Trigger: ${trigger}`,
    candidate
      ? `Detected question: ${candidate.text}\nQuestion kind: ${candidate.kind}\nConfidence: ${candidate.confidence.toFixed(2)}`
      : "Detected question: none",
    questionLike ? `Recent question-like lines:\n${questionLike}` : "Recent question-like lines: none",
    latestAnswer ? `Latest answer shown to user:\n${latestAnswer.slice(0, 700)}` : "Latest answer shown to user: none",
    "",
    `Recent transcript:\n${formatTranscriptBlock(recentSegments)}`,
  ].join("\n");
}

function buildObserverPrompt(trigger, prompt) {
  return [
    `触发原因：${trigger}`,
    "",
    "下面是产品侧整理过的实时上下文。判断是否值得打扰用户。",
    "值得就给短提示；不值得就只输出 SILENT。",
    "",
    prompt,
  ].join("\n");
}

function buildModel(config) {
  return {
    id: config.model,
    name: config.model,
    api: "openai-completions",
    provider: "meetly-llm",
    baseUrl: config.baseUrl.replace(/\/chat\/completions\/?$/i, "").replace(/\/$/, ""),
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

function createPiRunner(config) {
  const agent = new Agent({
    sessionId: `sim-${Date.now().toString(16)}`,
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model: buildModel(config),
      tools: [],
      messages: [],
      thinkingLevel: "off",
    },
    getApiKey: () => config.apiKey,
    streamFn: (directModel, context, options) =>
      streamSimple(directModel, context, {
        ...options,
        apiKey: config.apiKey,
        temperature: 0.25,
        maxTokens: 700,
      }),
    toolExecution: "parallel",
  });

  return async function runPiObserver(trigger, prompt) {
    let text = "";
    const started = performance.now();
    let firstDeltaAt = null;
    const unsubscribe = agent.subscribe((event) => {
      if (event.type !== "message_update") return;
      const assistantEvent = event.assistantMessageEvent;
      if (assistantEvent?.type !== "text_delta" || !assistantEvent.delta) return;
      if (firstDeltaAt === null) firstDeltaAt = performance.now();
      text += assistantEvent.delta;
    });
    try {
      await withTimeout(agent.prompt(buildObserverPrompt(trigger, prompt)), PI_OBSERVER_TIMEOUT_MS);
      return {
        text: text.trim(),
        firstDeltaMs: firstDeltaAt ? Math.round(firstDeltaAt - started) : null,
        totalMs: Math.round(performance.now() - started),
        timedOut: false,
      };
    } catch (error) {
      if (error instanceof Error && error.message === "PI_OBSERVER_TIMEOUT") {
        return {
          text: text.trim(),
          firstDeltaMs: firstDeltaAt ? Math.round(firstDeltaAt - started) : null,
          totalMs: Math.round(performance.now() - started),
          timedOut: true,
        };
      }
      throw error;
    } finally {
      unsubscribe();
    }
  };
}

function withTimeout(promise, timeoutMs) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("PI_OBSERVER_TIMEOUT")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function completeAssistant(config, question, stream = false) {
  const started = performance.now();
  let firstChunkAt = null;
  const response = await fetch(config.baseUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: `${INTERVIEW_PROMPT}\n\n${JSON_OUTPUT_CONTRACT}` },
        { role: "user", content: question },
      ],
      temperature: 0.3,
      stream,
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM request failed: ${response.status} ${await response.text()}`);
  }

  if (!stream) {
    const json = await response.json();
    return {
      text: json.choices?.[0]?.message?.content?.trim() ?? "",
      firstChunkMs: null,
      totalMs: Math.round(performance.now() - started),
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (firstChunkAt === null) firstChunkAt = performance.now();
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const value = JSON.parse(data);
        text += value.choices?.[0]?.delta?.content ?? "";
      } catch {}
    }
  }

  return {
    text: text.trim(),
    firstChunkMs: firstChunkAt ? Math.round(firstChunkAt - started) : null,
    totalMs: Math.round(performance.now() - started),
  };
}

function parseSuggestion(raw) {
  try {
    return JSON.parse(stripJsonCodeFence(raw));
  } catch {
    return { answer: raw, bullets: [], clarifyingQuestion: null };
  }
}

function stripJsonCodeFence(raw) {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json|JSON)?\s*/, "")
    .replace(/\s*```$/, "")
    .trim();
}

async function main() {
  const config = loadRuntimeConfig();
  const runPiObserver = createPiRunner(config);
  const transcript = [];

  console.log(`provider=${config.baseUrl}`);
  console.log(`model=${config.model}`);
  console.log(`api_key_length=${config.apiKey.length}`);

  console.log("\n[start] PI session_started");
  const startPrompt = buildPiCoachPrompt({ trigger: "session_started", transcript });
  const startResult = await runPiObserver("session_started", startPrompt);
  console.log(`pi session_started timeout=${startResult.timedOut} first=${startResult.firstDeltaMs}ms total=${startResult.totalMs}ms text=${startResult.text || "(empty)"}`);

  let latestCandidate = null;
  for (const [index, text] of scenario.entries()) {
    const segment = createSegment(text, index);
    transcript.push(segment);
    console.log(`\n[transcript] ${segment.text}`);

    const recentTranscript = transcript.filter((item) => segment.endMs - item.endMs <= 120_000);
    const candidate = detectQuestionCandidate(segment, recentTranscript);
    if (!candidate) {
      console.log("candidate=none");
      continue;
    }

    latestCandidate = candidate;
    console.log(`candidate=${candidate.kind} confidence=${candidate.confidence.toFixed(2)} reason=${candidate.reason}`);

    const piPrompt = buildPiCoachPrompt({ trigger: "question_detected", transcript, candidate });
    const piResult = await runPiObserver("question_detected", piPrompt);
    console.log(`pi question_detected timeout=${piResult.timedOut} first=${piResult.firstDeltaMs}ms total=${piResult.totalMs}ms text=${piResult.text || "(empty)"}`);

    if (candidate.confidence >= AUTO_ASSIST_PREFETCH_CONFIDENCE) {
      const askContext = buildInterviewAskContext(transcript);
      const prefetch = await completeAssistant(config, askContext.userMessage, false);
      const suggestion = parseSuggestion(prefetch.text);
      console.log(`prefetch total=${prefetch.totalMs}ms answer=${suggestion.answer ?? prefetch.text}`);
    }
  }

  console.log("\n[heartbeat] simulate 10s passive wake-up without pressing Enter");
  const heartbeatPrompt = buildPiCoachPrompt({ trigger: "heartbeat", transcript, candidate: latestCandidate });
  const heartbeat = await runPiObserver("heartbeat", heartbeatPrompt);
  console.log(`pi heartbeat timeout=${heartbeat.timedOut} first=${heartbeat.firstDeltaMs}ms total=${heartbeat.totalMs}ms text=${heartbeat.text || "(empty)"}`);

  console.log("\n[manual ask] simulate pressing Enter after transcript has accumulated");
  const askContext = buildInterviewAskContext(transcript);
  const manual = await completeAssistant(config, askContext.userMessage, true);
  const manualSuggestion = parseSuggestion(manual.text);
  console.log(`manual ask first=${manual.firstChunkMs}ms total=${manual.totalMs}ms answer=${manualSuggestion.answer ?? manual.text}`);
}

main().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exit(1);
});
