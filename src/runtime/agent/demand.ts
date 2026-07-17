import type { SessionKind, TranscriptSegment } from "../../app/types";
import { createSttQuestionWake, createSttSignalWake, type WakeEvent } from "./wake";

const CHINESE_QUESTION_KEYWORDS = [
  "吗",
  "呢",
  "什么",
  "为什么",
  "怎么",
  "怎样",
  "如何",
  "能不能",
  "可不可以",
  "有没有",
  "多少",
  "哪",
];

const ENGLISH_QUESTION_KEYWORDS = [
  "what",
  "why",
  "how",
  "can you",
  "could you",
  "would you",
  "tell me about",
  "walk me through",
  "explain",
  "describe",
];

export function detectSttWake(
  segment: TranscriptSegment,
  sessionKind: SessionKind = "remote"
): WakeEvent | null {
  const text = segment.text.trim();
  if (!text) return null;

  const lower = text.toLowerCase();
  const isQuestion =
    text.endsWith("?") ||
    text.endsWith("？") ||
    CHINESE_QUESTION_KEYWORDS.some((keyword) => text.includes(keyword)) ||
    ENGLISH_QUESTION_KEYWORDS.some((keyword) => lower.includes(keyword));

  if (isQuestion) {
    return createSttQuestionWake(text);
  }

  if (sessionKind === "remote" || sessionKind === "in_person") {
    const negotiationSignal = detectMeetingSignal(text);
    if (negotiationSignal) {
      return createSttSignalWake(text, negotiationSignal);
    }
  }

  if (needsExternalContext(text)) {
    return createSttSignalWake(text, "external_context_needed");
  }

  if (looksLikeWeakOrUnclearAnswer(text)) {
    return createSttSignalWake(text, "answer_needs_coaching");
  }

  return null;
}

function detectMeetingSignal(text: string) {
  const signals: Array<[RegExp, string]> = [
    [/(价格|费用|预算|报价|折扣|成本|付款|合同|price|budget|cost|discount|payment|contract)/i, "meeting_commercial_terms"],
    [/(时间|日期|本周|下周|月底|上线|交付|周期|deadline|timeline|deliver|launch)/i, "meeting_timeline_commitment"],
    [/(范围|边界|包含|不包含|负责|责任|谁来|scope|responsib|owner|ownership)/i, "meeting_scope_or_ownership"],
    [/(但是|不过|担心|顾虑|风险|问题是|很难|不行|不能接受|objection|concern|risk|cannot|can't)/i, "meeting_objection"],
    [/(可以考虑|可以接受|没问题|同意|让步|折中|那就|agree|acceptable|concession|compromise)/i, "meeting_concession_or_agreement"],
    [/(下一步|后续|确认一下|结论|决定|拍板|follow.?up|next step|decision|confirm)/i, "meeting_closing_window"],
  ];

  return signals.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

function needsExternalContext(text: string) {
  const lower = text.toLowerCase();
  return (
    /(公司|上一家|前司|主营|业务|产品|客户|行业|市场|融资|竞品|商业模式|这家公司|他们公司|候选人简历|简历里|项目产品|工作流)/.test(text) ||
    /\b(company|business|product|market|industry|competitor|startup|funding|customer|workflow)\b/i.test(text) ||
    /\b[A-Z][A-Za-z0-9-]{2,}\b/.test(text) ||
    /https?:\/\/|www\.|\.com|\.ai|\.io|\.cn/.test(lower)
  );
}

function looksLikeWeakOrUnclearAnswer(text: string) {
  return /(不知道|不太清楚|没了解|我想一下|怎么说呢|有点卡|卡住|大概就是|反正就是|然后就是|可能就是)/.test(text) ||
    /\b(i don't know|not sure|let me think|kind of|sort of)\b/i.test(text);
}
